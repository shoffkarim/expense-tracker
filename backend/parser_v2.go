package main

import (
	"errors"
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"
)

type statementFormat int

const (
	statementUnknown statementFormat = iota
	statementV1
	statementV2
)

func detectStatementFormat(p page) statementFormat {
	lines := visualLines(p.Words)
	var texts []string
	v1Header := false
	for _, l := range lines {
		for _, w := range l.Words {
			texts = append(texts, w.Text)
		}
		c := columns(l)
		if c[2] == "Описание" && c[1] == "обработки" && c[3] == "операции" && c[4] == "в валюте счёта" {
			v1Header = true
		}
	}
	all := strings.Join(texts, " ")
	v1 := v1Header && strings.Contains(all, "Выписка по договору") && strings.Contains(all, "Операции по карте")
	v2 := v2HeaderEnd(lines) >= 0 && strings.Contains(all, "Справка о движении средств")
	if v1 && !v2 {
		return statementV1
	}
	if v2 && !v1 {
		return statementV2
	}
	return statementUnknown
}

func columnsV2(l line) [6]string {
	// Границы между колонками шаблона A4; номер карты не входит в описание.
	bounds := [...]float64{50, 122, 195, 290, 385, 496, 545}
	var parts [6][]string
	for _, w := range l.Words {
		for i := range parts {
			if w.X >= bounds[i] && w.X < bounds[i+1] {
				parts[i] = append(parts[i], w.Text)
				break
			}
		}
	}
	var result [6]string
	for i := range parts {
		result[i] = strings.Join(strings.Fields(strings.Join(parts[i], " ")), " ")
	}
	return result
}

var v2HeaderTop = [6]string{"Дата и время", "Дата", "Сумма в валюте", "Сумма операции", "Описание", "Номер"}
var v2HeaderBottom = [6]string{"операции", "списания", "операции", "в валюте карты", "операции", "карты"}

func v2HeaderEnd(lines []line) float64 {
	for i := 1; i < len(lines); i++ {
		if columnsV2(lines[i-1]) == v2HeaderTop && columnsV2(lines[i]) == v2HeaderBottom && lines[i].Y-lines[i-1].Y <= 15 {
			return lines[i].Y
		}
	}
	return -1
}

var datePatternV2 = regexp.MustCompile(`^\d{2}\.\d{2}\.\d{4}$`)

func parseDateV2(value string) (string, bool) {
	if !datePatternV2.MatchString(value) {
		return "", false
	}
	d, err := time.Parse("02.01.2006", value)
	if err != nil || d.Year() < 1900 {
		return "", false
	}
	return d.Format("2006-01-02"), true
}

func parseMoneyV2(value string) (int64, bool) {
	// В новом шаблоне знак обязателен для обоих направлений операции.
	if !strings.HasPrefix(value, "+") && !strings.HasPrefix(value, "-") && !strings.HasPrefix(value, "−") {
		return 0, false
	}
	return parseMoney(value)
}

func parseStatementV2(pages []page) (ParseResult, error) {
	result := ParseResult{Transactions: []Transaction{}, Warnings: []ParseWarning{}}
	var pending *Transaction
	pendingValid := false
	lastY, lastPage := 0.0, 0
	finished := false
	flush := func() {
		if pending != nil && pendingValid {
			result.Transactions = append(result.Transactions, *pending)
		}
		pending, pendingValid = nil, false
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
		if finished {
			continue
		}
		lines := visualLines(p.Words)
		headerY := v2HeaderEnd(lines)
		if headerY < 0 {
			return result, errors.New("Шаблон выписки не поддерживается: не распознаны колонки таблицы.")
		}
		rowNumber := 0
		firstBodyLine := true
		for _, l := range lines {
			// Нижний колонтитул нового шаблона начинается на Y=782.
			if l.Y <= headerY || l.Y >= 770 {
				continue
			}
			c := columnsV2(l)
			if c == [6]string{} || c == v2HeaderTop || c == v2HeaderBottom {
				continue
			}
			if c[0] == "Пополнения:" || c[0] == "Расходы:" {
				flush()
				finished = true
				break
			}
			isContinuation := (c[0] == "" || timePattern.MatchString(c[0])) && (c[1] == "" || timePattern.MatchString(c[1])) && c[2] == "" && c[3] == "" && c[5] == ""
			if !isContinuation {
				flush()
				rowNumber++
				date, dateOK := parseDateV2(c[0])
				_, processedOK := parseDateV2(c[1])
				amount, amountOK := parseMoneyV2(c[2])
				accountAmount, accountOK := parseMoneyV2(c[3])
				pending = &Transaction{SourcePage: pn, RowNumber: rowNumber, Date: date, Description: c[4], AmountMinor: amount}
				pendingValid = dateOK && processedOK && c[4] != "" && amountOK && accountOK && amount == accountAmount
				if !pendingValid {
					warn(pn, fmt.Sprintf("Операция %d пропущена: дата, описание или рублёвая сумма не распознаны однозначно.", rowNumber))
				}
				lastY, lastPage = l.Y, pn
			} else {
				adjacent := lastPage == pn && l.Y-lastY <= 15
				acrossPage := lastPage == pn-1 && lastY >= 690 && firstBodyLine && l.Y <= 60
				if pending != nil && (adjacent || acrossPage) {
					if c[4] != "" {
						separator := " "
						if strings.HasSuffix(pending.Description, "-") {
							separator = ""
						}
						pending.Description += separator + c[4]
					}
					lastY, lastPage = l.Y, pn
				} else {
					warn(pn, "Строка продолжения не связана с операцией и пропущена.")
				}
			}
			firstBodyLine = false
		}
	}
	flush()
	if len(result.Transactions) == 0 && len(result.Warnings) == 0 {
		return result, errors.New("В выписке не найдены операции поддерживаемого формата.")
	}
	return result, nil
}
