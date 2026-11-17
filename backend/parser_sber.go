package main

import (
	"errors"
	"fmt"
	"math"
	"strings"
)

func columnsSber(l line) [4]string {
	bounds := [...]float64{40, 150, 360, 470, 580}
	var parts [4][]string
	for _, w := range l.Words {
		for i := range parts {
			if w.X >= bounds[i] && w.X < bounds[i+1] {
				parts[i] = append(parts[i], w.Text)
				break
			}
		}
	}
	var out [4]string
	for i := range parts {
		out[i] = strings.Join(strings.Fields(strings.Join(parts[i], " ")), " ")
	}
	return out
}
func sberHeaderEnd(lines []line) float64 {
	for i := 0; i+2 < len(lines); i++ {
		a, b, c := columnsSber(lines[i]), columnsSber(lines[i+1]), columnsSber(lines[i+2])
		if a == [4]string{"ДАТА ОПЕРАЦИИ (МСК)", "КАТЕГОРИЯ", "СУММА В ВАЛЮТЕ СЧЁТА", "ОСТАТОК СРЕДСТВ"} && b[1] == "Описание операции" && b[2] == "Сумма в валюте" && c[2] == "операции 2" && lines[i+2].Y-lines[i].Y < 30 {
			return lines[i+2].Y
		}
	}
	return -1
}

// A long statement can end with a separate page of bank notes, without a table.
// Recognize that page explicitly; an unknown page must still fail the import.
func isSberNotesPage(lines []line) bool {
	var texts []string
	for _, l := range lines {
		c := columnsSber(l)
		for _, field := range strings.Fields(c[0]) {
			if datePatternV2.MatchString(field) || timePattern.MatchString(field) {
				return false
			}
		}
		for _, value := range c[2:] {
			if _, ok := parseMoney(value + " ₽"); ok {
				return false
			}
		}
		for _, w := range l.Words {
			texts = append(texts, w.Text)
		}
	}
	text := strings.Join(texts, " ")
	return strings.Contains(text, "Денежные средства списываются после получения банком подтверждения о проведении финансовой операции.") &&
		strings.Contains(text, "В выписке отображаются только обработанные в заданном периоде операции.") &&
		strings.Contains(text, "Скачать электронный формат подписи можно в веб-версии СберБанк Онлайн")
}

func parseStatementSber(pages []page) (ParseResult, error) {
	result := ParseResult{Transactions: []Transaction{}, Warnings: []ParseWarning{}}
	var pending *Transaction
	valid, processed := false, false
	lastY := 0.0
	flush := func() {
		if pending != nil {
			if valid && processed && pending.Description != "" {
				result.Transactions = append(result.Transactions, *pending)
			} else {
				result.Warnings = append(result.Warnings, ParseWarning{pending.SourcePage, fmt.Sprintf("Операция %d пропущена: дата, описание или рублёвая сумма не распознаны однозначно.", pending.RowNumber)})
			}
		}
		pending = nil
	}
	var firstText []string
	for _, l := range visualLines(pages[0].Words) {
		if l.Y < 260 {
			for _, w := range l.Words {
				firstText = append(firstText, w.Text)
			}
		}
	}
	if !strings.Contains(strings.Join(firstText, " "), "Российский рубль") {
		return result, errors.New("Поддерживаются только выписки Сбера по рублёвому счёту.")
	}
	for pi, p := range pages {
		if math.Abs(p.Width-595) > 2 || math.Abs(p.Height-842) > 2 {
			return result, errors.New("Формат выписки не поддерживается: отличается размер страницы.")
		}
		lines := visualLines(p.Words)
		header := sberHeaderEnd(lines)
		if header < 0 {
			if pi > 0 && pi == len(pages)-1 && isSberNotesPage(lines) {
				flush()
				continue
			}
			return result, errors.New("Шаблон выписки не поддерживается: не распознаны колонки таблицы.")
		}
		row := 0
		firstBody := true
		for _, l := range lines {
			if l.Y <= header {
				continue
			}
			c := columnsSber(l)
			if c == [4]string{} {
				continue
			}
			fields := strings.Fields(c[0])
			if c[2] != "" && c[3] != "" && len(fields) > 0 && (datePatternV2.MatchString(fields[0]) || len(fields) == 2 && timePattern.MatchString(fields[1])) {
				flush()
				row++
				date, ok := parseDateV2(fields[0])
				amount, aok := parseMoney(c[2] + " ₽")
				_, bok := parseMoney(c[3] + " ₽")
				pending = &Transaction{SourcePage: pi + 1, RowNumber: row, Date: date, AmountMinor: amount}
				valid = ok && aok && bok && len(fields) == 2 && timePattern.MatchString(fields[1])
				processed = false
				lastY = l.Y
			} else if pending != nil && c[2] == "" && c[3] == "" && (l.Y-lastY <= 15 && l.Y >= lastY || firstBody && pending.SourcePage == pi && lastY >= 740) {
				if c[0] != "" {
					f := strings.Fields(c[0])
					_, ok := parseDateV2(f[0])
					if !ok {
						flush()
						continue
					}
					processed = true
				}
				if c[1] != "" {
					if pending.Description != "" {
						pending.Description += " "
					}
					pending.Description += c[1]
				}
				lastY = l.Y
			} else {
				flush()
			}
			firstBody = false
		}
	}
	flush()
	if len(result.Transactions) == 0 && len(result.Warnings) == 0 {
		return result, errors.New("В выписке не найдены операции поддерживаемого формата.")
	}
	return result, nil
}
