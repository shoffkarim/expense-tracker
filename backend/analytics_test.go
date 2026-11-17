package main

import "testing"

func TestAnalytics(t *testing.T) {
	s := testStore(t)
	a := account(t, s, "A", 0)
	b := account(t, s, "B", 0)
	c := categoryID(t, s, "expense")
	income := categoryID(t, s, "income")
	operation(t, s, OperationInput{Kind: "expense", Date: "2026-10-01", AmountMinor: 100, SourceAccountID: a, CategoryID: c, Tags: []string{"еда", "дом"}})
	operation(t, s, OperationInput{Kind: "expense", Date: "2026-09-30", AmountMinor: 200, SourceAccountID: b, CategoryID: c})
	deleted := operation(t, s, OperationInput{Kind: "expense", Date: "2026-10-01", AmountMinor: 900, SourceAccountID: a, CategoryID: c})
	if err := s.deleteOperation(testContext, deleted); err != nil {
		t.Fatal(err)
	}
	operation(t, s, OperationInput{Kind: "transfer", Date: "2026-10-01", AmountMinor: 500, SourceAccountID: a, DestinationAccountID: b})
	operation(t, s, OperationInput{Kind: "income", Date: "2026-10-01", AmountMinor: 700, DestinationAccountID: a, CategoryID: income})
	for _, tc := range []struct {
		f    HistoryFilter
		kind string
		want int64
	}{
		{HistoryFilter{}, "expense", 300},
		{HistoryFilter{From: "2026-10-01", To: "2026-10-01"}, "expense", 100},
		{HistoryFilter{AccountID: a, CategoryID: c, Tag: "еда"}, "expense", 100},
		{HistoryFilter{AccountID: b}, "expense", 200},
		{HistoryFilter{Tag: "нет"}, "expense", 0},
		{HistoryFilter{}, "income", 700},
	} {
		got, err := s.analytics(testContext, tc.f, tc.kind)
		if err != nil || got.TotalMinor != tc.want {
			t.Fatalf("%+v: %+v %v", tc, got, err)
		}
	}
	if _, err := s.analytics(testContext, HistoryFilter{From: "2026-11-01", To: "2026-10-01"}, "expense"); err == nil {
		t.Fatal("invalid dates accepted")
	}
}
