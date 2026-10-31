package main

import (
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

type Transaction struct {
	SourcePage  int    `json:"sourcePage"`
	RowNumber   int    `json:"rowNumber"`
	Date        string `json:"date"`
	Description string `json:"description"`
	AmountMinor int64  `json:"amountMinor"`
}
type ParseWarning struct {
	SourcePage int    `json:"sourcePage"`
	Message    string `json:"message"`
}
type ParseResult struct {
	Transactions []Transaction  `json:"transactions"`
	Warnings     []ParseWarning `json:"warnings"`
	FileHash     string         `json:"fileHash,omitempty"`
}
type word struct {
	X      float64 `xml:"xMin,attr"`
	Y      float64 `xml:"yMin,attr"`
	Right  float64 `xml:"xMax,attr"`
	Bottom float64 `xml:"yMax,attr"`
	Text   string  `xml:",chardata"`
}
type page struct {
	Width, Height float64
	Words         []word
}
type line struct {
	Y     float64
	Words []word
}

var datePattern = regexp.MustCompile(`^(\d{2}\.\d{2}\.\d{2})(?: (?:[01]\d|2[0-3]):[0-5]\d)?$`)
var moneyPattern = regexp.MustCompile(`^([+-]?)([0-9]{1,3}(?: [0-9]{3})*|[0-9]+)[.,]([0-9]{2}) ₽$`)
var timePattern = regexp.MustCompile(`^(?:[01]\d|2[0-3]):[0-5]\d$`)

func readPages(r io.Reader) ([]page, error) {
	d := xml.NewDecoder(r)
	var pages []page
	for {
		token, err := d.Token()
		if err == io.EOF {
			return pages, nil
		}
		if err != nil {
			return nil, errors.New("Не удалось прочитать текст PDF.")
		}
		start, ok := token.(xml.StartElement)
		if !ok {
			continue
		}
		switch start.Name.Local {
		case "page":
			p := page{}
			for _, a := range start.Attr {
				if a.Name.Local == "width" {
					p.Width, _ = strconv.ParseFloat(a.Value, 64)
				}
				if a.Name.Local == "height" {
					p.Height, _ = strconv.ParseFloat(a.Value, 64)
				}
			}
			pages = append(pages, p)
		case "word":
			var w word
			if err := d.DecodeElement(&w, &start); err != nil {
				return nil, errors.New("Не удалось прочитать текст PDF.")
			}
			if len(pages) > 0 {
				pages[len(pages)-1].Words = append(pages[len(pages)-1].Words, w)
			}
		}
	}
}

func visualLines(words []word) []line {
	sort.SliceStable(words, func(i, j int) bool {
		if words[i].Y == words[j].Y {
			return words[i].X < words[j].X
		}
		return words[i].Y < words[j].Y
	})
	var lines []line
	for _, w := range words {
		// У цифр, знаков и символа рубля немного разные метрики шрифта.
		// Допуск 2 пункта объединяет их, но не соседние строки с шагом около 11 пунктов.
		if len(lines) == 0 || math.Abs(lines[len(lines)-1].Y-w.Y) > 2 {
			lines = append(lines, line{Y: w.Y})
		}
		lines[len(lines)-1].Words = append(lines[len(lines)-1].Words, w)
	}
	for i := range lines {
		sort.SliceStable(lines[i].Words, func(a, b int) bool { return lines[i].Words[a].X < lines[i].Words[b].X })
	}
	return lines
}

func columns(l line) [5]string {
	var parts [5][]string
	for _, w := range l.Words {
		// Координаты в пунктах PDF для поддерживаемого шаблона 595 x 842.
		// Границы проходят в промежутках между пятью колонками, не по буквам.
		x := w.X
		switch {
		case x >= 50 && x < 130:
			parts[0] = append(parts[0], w.Text)
		case x >= 130 && x < 210:
			parts[1] = append(parts[1], w.Text)
		case x >= 210 && x < 395:
			parts[2] = append(parts[2], w.Text)
		case x >= 395 && x < 475:
			parts[3] = append(parts[3], w.Text)
		case x >= 475 && x < 545:
			parts[4] = append(parts[4], w.Text)
		}
	}
	var result [5]string
	for i := range parts {
		result[i] = strings.Join(strings.Fields(strings.Join(parts[i], " ")), " ")
	}
	return result
}

func parseMoney(value string) (int64, bool) {
	value = strings.ReplaceAll(value, "−", "-")
	value = strings.ReplaceAll(value, "+ ", "+")
	value = strings.ReplaceAll(value, "- ", "-")
	m := moneyPattern.FindStringSubmatch(value)
	if m == nil {
		return 0, false
	}
	whole, err := strconv.ParseInt(strings.ReplaceAll(m[2], " ", ""), 10, 64)
	// Ограничиваем и переполнение int64, и точность целых чисел на фронтенде.
	if err != nil || whole > 90071992547409 {
		return 0, false
	}
	cents, _ := strconv.ParseInt(m[3], 10, 64)
	amount := whole*100 + cents
	if amount > 9007199254740991 {
		return 0, false
	}
	// В этом шаблоне поступления помечены плюсом, расходы напечатаны без знака.
	if m[1] != "+" {
		amount = -amount
	}
	return amount, true
}

func parseStatement(r io.Reader) (ParseResult, error) {
	result := ParseResult{Transactions: []Transaction{}, Warnings: []ParseWarning{}}
	pages, err := readPages(r)
	if err != nil {
		return result, err
	}
	count := 0
	for _, p := range pages {
		count += len(p.Words)
	}
	if count == 0 {
		return result, errors.New("В PDF нет текстового слоя. Сканы пока не поддерживаются.")
	}
	switch detectStatementFormat(pages[0]) {
	case statementV1:
		return parseStatementV1(pages)
	case statementV2:
		return parseStatementV2(pages)
	default:
		return result, errors.New("Шаблон выписки не поддерживается. Используйте выписку одного из поддерживаемых форматов.")
	}
}

func parseStatementV1(pages []page) (ParseResult, error) {
	result := ParseResult{Transactions: []Transaction{}, Warnings: []ParseWarning{}}
	var pending *Transaction
	pendingValid := false
	lastY := 0.0
	lastPage := 0
	flush := func() {
		if pending != nil && pendingValid {
			result.Transactions = append(result.Transactions, *pending)
		}
		pending = nil
		pendingValid = false
	}
	warn := func(p int, message string) { result.Warnings = append(result.Warnings, ParseWarning{p, message}) }
	for pi, p := range pages {
		pn := pi + 1
		if len(p.Words) == 0 {
			flush()
			warn(pn, "На странице нет текста: проверьте её вручную, сканы не поддерживаются.")
			continue
		}
		if math.Abs(p.Width-595) > 2 || math.Abs(p.Height-842) > 2 {
			return result, errors.New("Формат выписки не поддерживается: отличается размер страницы.")
		}
		lines := visualLines(p.Words)
		startY := 30.0
		if pi == 0 {
			headerY := -1.0
			var texts []string
			for _, l := range lines {
				c := columns(l)
				if c[2] == "Описание" && c[1] == "обработки" && c[3] == "операции" && c[4] == "в валюте счёта" {
					headerY = l.Y
				}
				for _, w := range l.Words {
					texts = append(texts, w.Text)
				}
			}
			all := strings.Join(texts, " ")
			if headerY < 0 || !strings.Contains(all, "Выписка по договору") || !strings.Contains(all, "Операции по карте") {
				return result, errors.New("Шаблон выписки не поддерживается. Используйте выписку того же формата, что и образец.")
			}
			startY = headerY + 5
		}
		rowNumber := 0
		for _, l := range lines {
			if l.Y < startY || l.Y > 810 {
				continue
			}
			c := columns(l)
			// Повторные две строки шапки, если они присутствуют на следующей странице.
			if c[2] == "Описание" && c[1] == "обработки" && c[3] == "операции" {
				continue
			}
			if strings.HasPrefix(c[0], "Дата") && c[1] == "Дата" && c[3] == "Сумма" {
				continue
			}
			if c == [5]string{} {
				continue
			}
			if c[0] != "" && !timePattern.MatchString(c[0]) || c[1] != "" || c[3] != "" || c[4] != "" {
				flush()
				rowNumber++
				pending = &Transaction{SourcePage: pn, RowNumber: rowNumber, Description: c[2]}
				dateMatch := datePattern.FindStringSubmatch(c[0])
				dateOK := false
				if dateMatch != nil {
					// Годы текущего шаблона относятся к XXI веку, а не к окну двухзначных лет Go.
					d, e := time.Parse("02.01.2006", dateMatch[1][:6]+"20"+dateMatch[1][6:])
					if e == nil {
						pending.Date = d.Format("2006-01-02")
						dateOK = true
					}
				}
				amount, aOK := parseMoney(c[3])
				account, bOK := parseMoney(c[4])
				pending.AmountMinor = amount
				pendingValid = dateOK && c[2] != "" && aOK && bOK && amount == account && datePattern.MatchString(c[1])
				if !pendingValid {
					warn(pn, fmt.Sprintf("Операция %d пропущена: дата, описание или рублёвая сумма не распознаны однозначно.", rowNumber))
				}
				lastY = l.Y
				lastPage = pn
				continue
			}
			if c[2] != "" {
				// Перенос описания разрешён только на соседнюю строку либо с самого низа
				// предыдущей страницы в начало следующей. Страница операции не меняется.
				adjacent := lastPage == pn && l.Y-lastY <= 15
				acrossPage := lastPage == pn-1 && lastY >= 760 && l.Y <= 60
				if pending != nil && (adjacent || acrossPage) {
					pending.Description += " " + c[2]
					lastY = l.Y
					lastPage = pn
				} else {
					warn(pn, "Строка описания не связана с операцией и пропущена.")
				}
			}
		}
	}
	flush()
	if len(result.Transactions) == 0 && len(result.Warnings) == 0 {
		return result, errors.New("В выписке не найдены операции поддерживаемого формата.")
	}
	return result, nil
}
