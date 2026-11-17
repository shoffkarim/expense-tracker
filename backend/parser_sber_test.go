package main

import "testing"

func sberTestPage(body ...[]word) page {
	p := page{Width: 595, Height: 842}
	p.Words = append(p.Words, word{X: 45, Y: 15, Text: "СберБанк Выписка по платёжному счёту Российский рубль"})
	p.Words = append(p.Words, testCells(40, []float64{45, 152, 370, 490}, "ДАТА ОПЕРАЦИИ (МСК)", "КАТЕГОРИЯ", "СУММА В ВАЛЮТЕ СЧЁТА", "ОСТАТОК СРЕДСТВ")...)
	p.Words = append(p.Words, testCells(55, []float64{45, 152, 370, 490}, "Дата обработки 1", "Описание операции", "Сумма в валюте", "В валюте счёта")...)
	p.Words = append(p.Words, testCells(65, []float64{45, 152, 370}, "и код авторизации", "", "операции 2")...)
	for _, b := range body {
		p.Words = append(p.Words, b...)
	}
	return p
}
func sberCells(y float64, v ...string) []word {
	return testCells(y, []float64{45, 152, 370, 490}, v...)
}
func TestSberRows(t *testing.T) {
	p := sberTestPage(sberCells(90, "01.11.2026 12:30", "Банковская категория", "100,01", "500,00"), sberCells(101, "02.11.2026 123456", "Оплата"), sberCells(112, "", "магазина"), sberCells(150, "03.11.2026 11:00", "Категория", "+200,00", "700,00"), sberCells(161, "03.11.2026 654321", "Пополнение"))
	got, err := parseTestPages(t, p, p)
	if err != nil || len(got.Transactions) != 4 || len(got.Warnings) != 0 {
		t.Fatalf("synthetic parse failed: %v %+v", err, got)
	}
	if got.Transactions[0].Description != "Оплата магазина" || got.Transactions[0].AmountMinor != -10001 || got.Transactions[1].AmountMinor != 20000 || got.Transactions[2].SourcePage != 2 || got.Transactions[2].RowNumber != 1 {
		t.Fatal("wrong row fields")
	}
}
func TestSberInvalidRows(t *testing.T) {
	for _, v := range []string{"не сумма", "90071992547410,00"} {
		p := sberTestPage(sberCells(90, "01.11.2026 12:30", "Категория", v, "500,00"), sberCells(101, "02.11.2026 123456", "Описание"))
		got, err := parseTestPages(t, p)
		if err != nil || len(got.Transactions) != 0 || len(got.Warnings) != 1 {
			t.Fatal("invalid amount accepted")
		}
	}
	p := sberTestPage(sberCells(90, "31.02.2026 12:30", "Категория", "100,00", "500,00"), sberCells(101, "02.11.2026 123456", "Описание"))
	got, err := parseTestPages(t, p)
	if err != nil || len(got.Warnings) != 1 {
		t.Fatal("invalid date accepted")
	}
}
func TestSberAmbiguousFormat(t *testing.T) {
	p := sberTestPage()
	v2 := testV2Page(true)
	p.Words = append(p.Words, v2.Words...)
	if detectStatementFormat(p) != statementUnknown {
		t.Fatal("ambiguous format accepted")
	}
}

func TestSberFinalNotesPage(t *testing.T) {
	operations := sberTestPage(
		sberCells(90, "01.11.2026 12:30", "Категория", "100,01", "500,00"),
		sberCells(101, "02.11.2026 123456", "Покупка"),
	)
	notes := page{Width: 595, Height: 842, Words: []word{
		{X: 45, Y: 14, Text: "Выписка по платёжному счёту"},
		{X: 45, Y: 62, Text: "Денежные средства списываются после получения банком подтверждения о проведении финансовой операции."},
		{X: 45, Y: 74, Text: "В выписке отображаются только обработанные в заданном периоде операции."},
		{X: 45, Y: 176, Text: "Скачать электронный формат подписи можно в веб-версии СберБанк Онлайн в разделе «Выписки и справки»."},
	}}
	t.Run("accept final notes without losing the last operation", func(t *testing.T) {
		got, err := parseTestPages(t, operations, notes)
		if err != nil || len(got.Transactions) != 1 || len(got.Warnings) != 0 {
			t.Fatalf("unexpected result: %v %+v", err, got)
		}
		if got.Transactions[0].Description != "Покупка" || got.Transactions[0].AmountMinor != -10001 {
			t.Fatal("last operation changed")
		}
	})
	t.Run("reject unknown final page", func(t *testing.T) {
		if _, err := parseTestPages(t, operations, page{Width: 595, Height: 842}); err == nil {
			t.Fatal("unknown page accepted")
		}
	})
	t.Run("reject notes between operation pages", func(t *testing.T) {
		if _, err := parseTestPages(t, operations, notes, operations); err == nil {
			t.Fatal("intermediate page without header accepted")
		}
	})
	t.Run("do not skip operations on a page without header", func(t *testing.T) {
		withOperation := notes
		withOperation.Words = append(append([]word{}, notes.Words...), sberCells(40, "03.11.2026 12:30", "Категория", "100,00", "400,00")...)
		if _, err := parseTestPages(t, operations, withOperation); err == nil {
			t.Fatal("operation on notes page silently skipped")
		}
	})
}
