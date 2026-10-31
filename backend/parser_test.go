package main

import (
	"encoding/xml"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

// Synthetic layout fixtures contain no personal financial data.
func testCells(y float64, xs []float64, values ...string) []word {
	var words []word
	for i, value := range values {
		if value != "" {
			words = append(words, word{X: xs[i], Y: y, Text: value})
		}
	}
	return words
}

func testV2Cells(y float64, values ...string) []word {
	return testCells(y, []float64{56, 126, 199, 294, 389, 499}, values...)
}

func testV2Page(first bool, body ...[]word) page {
	p := page{Width: 595, Height: 842}
	y := 20.0
	if first {
		p.Words = append(p.Words, word{X: 56, Y: 100, Text: "Справка о движении средств"})
		y = 297
	}
	p.Words = append(p.Words, testV2Cells(y, v2HeaderTop[:]...)...)
	p.Words = append(p.Words, testV2Cells(y+11, v2HeaderBottom[:]...)...)
	for _, words := range body {
		p.Words = append(p.Words, words...)
	}
	return p
}

func parseTestPages(t *testing.T, pages ...page) (ParseResult, error) {
	t.Helper()
	var doc strings.Builder
	doc.WriteString("<doc>")
	for _, p := range pages {
		fmt.Fprintf(&doc, `<page width="%g" height="%g">`, p.Width, p.Height)
		for _, w := range p.Words {
			data, err := xml.Marshal(w)
			if err != nil {
				t.Fatal(err)
			}
			doc.Write(data)
		}
		doc.WriteString("</page>")
	}
	doc.WriteString("</doc>")
	return parseStatement(strings.NewReader(doc.String()))
}

func TestV2RowsAndTrailer(t *testing.T) {
	p := testV2Page(true,
		testV2Cells(324, "26.10.2026", "27.10.2026", "-249.35 ₽", "-249.35 ₽", "Оплата SANKT-", "1234"),
		testV2Cells(335, "19:58", "20:13", "", "", "PETERBU RUS"),
		testV2Cells(349, "25.10.2026", "25.10.2026", "+2 000,01 ₽", "+2 000,01 ₽", "Пополнение", "1234"),
		testV2Cells(360, "11:00", "11:01"),
		testV2Cells(374, "Пополнения:", "2 000,01 ₽"),
		testV2Cells(389, "Расходы:", "249,35 ₽"),
		testV2Cells(430, "С уважением,", "", "", "", "Подпись"),
		testV2Cells(782, "Реквизиты банка", "", "", "", "Колонтитул", "1"),
	)
	got, err := parseTestPages(t, p)
	want := []Transaction{
		{SourcePage: 1, RowNumber: 1, Date: "2026-10-26", Description: "Оплата SANKT-PETERBU RUS", AmountMinor: -24935},
		{SourcePage: 1, RowNumber: 2, Date: "2026-10-25", Description: "Пополнение", AmountMinor: 200001},
	}
	if err != nil || len(got.Warnings) != 0 || !reflect.DeepEqual(got.Transactions, want) {
		t.Fatalf("unexpected synthetic parse: %+v, %v", got, err)
	}
}

func TestV2PageContinuation(t *testing.T) {
	p1 := testV2Page(true,
		testV2Cells(710, "26.10.2026", "26.10.2026", "-100.00 ₽", "-100.00 ₽", "Описание", "1234"),
		testV2Cells(721, "12:00", "12:01", "", "", "на двух"),
		testV2Cells(782, "Реквизиты банка", "", "", "", "Колонтитул", "1"),
	)
	p2 := testV2Page(false,
		testV2Cells(47, "", "", "", "", "страницах"),
		testV2Cells(72, "25.10.2026", "25.10.2026", "+50.00 ₽", "+50.00 ₽", "Доход", "1234"),
	)
	got, err := parseTestPages(t, p1, p2)
	want := []Transaction{
		{SourcePage: 1, RowNumber: 1, Date: "2026-10-26", Description: "Описание на двух страницах", AmountMinor: -10000},
		{SourcePage: 2, RowNumber: 1, Date: "2026-10-25", Description: "Доход", AmountMinor: 5000},
	}
	if err != nil || len(got.Warnings) != 0 || !reflect.DeepEqual(got.Transactions, want) {
		t.Fatalf("unexpected continuation: %+v, %v", got, err)
	}
}

func TestV2InvalidRows(t *testing.T) {
	for _, tc := range []struct {
		name  string
		col   int
		value string
	}{
		{"invalid date", 0, "31.02.2026"},
		{"short year", 0, "26.10.26"},
		{"invalid processing date", 1, "31.02.2026"},
		{"foreign currency", 2, "-100.00 USD"},
		{"different amounts", 3, "-99.00 ₽"},
		{"different signs", 3, "+100.00 ₽"},
		{"missing sign", 2, "100.00 ₽"},
		{"missing amount", 2, ""},
		{"missing description", 4, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cells := []string{"26.10.2026", "26.10.2026", "-100.00 ₽", "-100.00 ₽", "Покупка", "1234"}
			cells[tc.col] = tc.value
			p := testV2Page(true, testV2Cells(324, cells...),
				testV2Cells(335, "12:00", "12:01", "", "", "продолжение"),
				testV2Cells(349, "25.10.2026", "25.10.2026", "+50.00 ₽", "+50.00 ₽", "Доход", "1234"))
			got, err := parseTestPages(t, p)
			if err != nil || len(got.Warnings) != 1 || len(got.Transactions) != 1 || got.Transactions[0].RowNumber != 2 || got.Transactions[0].Description != "Доход" {
				t.Fatalf("invalid row was not isolated: %+v, %v", got, err)
			}
		})
	}
}

func TestV2OrphanAndBlankPage(t *testing.T) {
	p1 := testV2Page(true, testV2Cells(324, "26.10.2026", "26.10.2026", "-1.00 ₽", "-1.00 ₽", "Покупка", "1234"),
		testV2Cells(400, "", "", "", "", "Посторонняя строка"))
	p2 := testV2Page(false, testV2Cells(47, "", "", "", "", "Оторванное продолжение"))
	got, err := parseTestPages(t, p1, page{Width: 595, Height: 842}, p2)
	if err != nil || len(got.Warnings) != 3 || len(got.Transactions) != 1 || got.Transactions[0].Description != "Покупка" {
		t.Fatalf("unexpected orphan handling: %+v, %v", got, err)
	}
}

func TestStatementDetection(t *testing.T) {
	v1 := page{Width: 595, Height: 842, Words: []word{{X: 55, Y: 70, Text: "Выписка по договору"}, {X: 60, Y: 380, Text: "Операции по карте"}}}
	xs := []float64{55, 135, 215, 410, 490}
	v1.Words = append(v1.Words, testCells(441, xs, "операции", "обработки", "Описание", "операции", "в валюте счёта")...)
	v1.Words = append(v1.Words, testCells(460, xs, "17.07.26 12:00", "17.07.26", "Покупка", "123.45 ₽", "123.45 ₽")...)
	v1.Words = append(v1.Words, testCells(471, xs, "", "", "в магазине")...)
	got, err := parseTestPages(t, v1)
	if err != nil || len(got.Warnings) != 0 || !reflect.DeepEqual(got.Transactions, []Transaction{{SourcePage: 1, RowNumber: 1, Date: "2026-07-17", Description: "Покупка в магазине", AmountMinor: -12345}}) {
		t.Fatalf("legacy regression: %+v, %v", got, err)
	}
	v2 := testV2Page(true, testV2Cells(324, "26.10.2026", "26.10.2026", "-1.00 ₽", "-1.00 ₽", "Покупка", "1234"))
	if detectStatementFormat(v1) != statementV1 || detectStatementFormat(v2) != statementV2 {
		t.Fatal("format not detected")
	}
	for _, name := range []string{"title only", "header only", "wrong size", "empty", "missing next header", "ambiguous"} {
		t.Run(name, func(t *testing.T) {
			p := v2
			p.Words = append([]word(nil), v2.Words...)
			pages := []page{p}
			switch name {
			case "title only":
				pages[0].Words = p.Words[:1]
			case "header only":
				pages[0].Words = p.Words[1:]
			case "wrong size":
				pages[0].Width = 612
			case "empty":
				pages[0].Words = nil
			case "missing next header":
				pages = append(pages, page{Width: 595, Height: 842, Words: testV2Cells(47, "26.10.2026")})
			case "ambiguous":
				pages[0].Words = append(pages[0].Words, v1.Words...)
			}
			if _, err := parseTestPages(t, pages...); err == nil {
				t.Fatal("unsupported statement accepted")
			}
		})
	}
}

func TestMoneyLimits(t *testing.T) {
	for _, tc := range []struct {
		input string
		want  int64
		ok    bool
	}{
		{"+1 234.56 ₽", 123456, true},
		{"− 12,03 ₽", -1203, true},
		{"-0.00 ₽", 0, true},
		{"+90071992547409.91 ₽", 9007199254740991, true},
		{"+90071992547409.92 ₽", 0, false},
		{"+999999999999999999999.00 ₽", 0, false},
		{"+1.2 ₽", 0, false},
		{"+1.00 USD", 0, false},
		{"1.00 ₽", 0, false},
	} {
		got, ok := parseMoneyV2(tc.input)
		if got != tc.want || ok != tc.ok {
			t.Errorf("%q: got %d, %v", tc.input, got, ok)
		}
	}
}
