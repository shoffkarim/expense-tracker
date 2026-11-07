package main

import (
	"fmt"
	"reflect"
	"testing"
)

func TestTagsLifecycle(t *testing.T) {
	s := testStore(t)
	a := account(t, s, "synthetic", 10000)
	cat := categoryID(t, s, "expense")
	in := OperationInput{Kind: "expense", Date: "2026-10-01", AmountMinor: 100, SourceAccountID: a, CategoryID: cat, Tags: []string{"  Кофе ", "кофе", "работа"}}
	id, err := s.saveOperation(testContext, 0, in)
	if err != nil {
		t.Fatal(err)
	}
	h, err := s.history(testContext, HistoryFilter{Page: 1, Tag: " КОФЕ ", AccountID: a, CategoryID: cat})
	if err != nil || h.Total != 1 || len(h.Transactions[0].Tags) != 2 {
		t.Fatal(h, err)
	}
	in.Tags = nil
	if _, err = s.saveOperation(testContext, id, in); err != nil {
		t.Fatal(err)
	}
	h, _ = s.history(testContext, HistoryFilter{Page: 1, Tag: "кофе"})
	if h.Total != 1 {
		t.Fatal("omission erased tags")
	}
	in.Tags = []string{}
	if _, err = s.saveOperation(testContext, id, in); err != nil {
		t.Fatal(err)
	}
	h, _ = s.history(testContext, HistoryFilter{Page: 1, Tag: "кофе"})
	if h.Total != 0 {
		t.Fatal("clear failed")
	}
	var balance int64
	s.db.QueryRow("SELECT balance_minor FROM accounts WHERE id=?", a).Scan(&balance)
	if balance != 9900 {
		t.Fatal(balance)
	}
	in.Tags = []string{"новый", " "}
	if _, err = s.saveOperation(testContext, id, in); err == nil {
		t.Fatal("invalid tag accepted")
	}
	tags, _ := s.tags(testContext)
	if len(tags) != 2 {
		t.Fatal("failed write leaked tags", tags)
	}
}
func TestTagRulePrecedence(t *testing.T) {
	rules := []Rule{}
	for i, tags := range [][]string{{"первый"}, {"пропущен"}, {"третий", "ПЕРВЫЙ"}} {
		r := Rule{Name: "rule", Available: true, Direction: "expense", Condition: "text", Text: "shop", Tags: tags}
		if i < 2 {
			r.CategoryID = int64(i + 1)
		}
		rules = append(rules, r)
	}
	cat, other, tags, _ := assignRules(rules, Transaction{Description: "shop", AmountMinor: -100}, 1)
	if cat != 1 || other != 0 || !reflect.DeepEqual(tags, []string{"первый", "третий"}) {
		t.Fatal(cat, other, tags)
	}
	rules = append([]Rule{rules[2]}, rules[:2]...)
	cat, _, tags, _ = assignRules(rules, Transaction{Description: "shop", AmountMinor: -100}, 1)
	if cat != 1 || len(tags) != 2 {
		t.Fatal(cat, tags)
	}
	s := testStore(t)
	r := Rule{Name: "only tags", Direction: "expense", Condition: "text", Text: "shop", Tags: []string{"кофе"}}
	if err := s.validRule(testContext, r); err != nil {
		t.Fatal(err)
	}
	r.Tags = nil
	if s.validRule(testContext, r) == nil {
		t.Fatal("empty result accepted")
	}
}
func TestTagsMigration(t *testing.T) {
	for _, version := range []int{1, 2} {
		t.Run(fmt.Sprint(version), func(t *testing.T) {
			s := testStore(t)
			a := account(t, s, "synthetic", 100)
			_, err := s.db.Exec("DROP TABLE transaction_tags; DROP TABLE tags")
			if err != nil {
				t.Fatal(err)
			}
			if version == 1 {
				s.db.Exec("DROP TABLE rules")
			}
			s.db.Exec(fmt.Sprint("PRAGMA user_version=", version))
			if err := s.migrate(); err != nil {
				t.Fatal(err)
			}
			var got int
			s.db.QueryRow("PRAGMA user_version").Scan(&got)
			if got != 4 {
				t.Fatal(got)
			}
			var balance int64
			s.db.QueryRow("SELECT balance_minor FROM accounts WHERE id=?", a).Scan(&balance)
			if balance != 100 {
				t.Fatal(balance)
			}
		})
	}
}

func TestImportTagsRetry(t *testing.T) {
	s := testStore(t)
	a := account(t, s, "synthetic", 10000)
	cat := categoryID(t, s, "expense")
	in := importInput(a, cat, "tagged")
	in.Rows[0].Tags = []string{"кофе"}
	result, err := s.saveImport(testContext, in)
	if err != nil {
		t.Fatal(err)
	}
	repeat, err := s.saveImport(testContext, in)
	if err != nil || repeat != result {
		t.Fatal(repeat, err)
	}
	h, err := s.history(testContext, HistoryFilter{Page: 1, Tag: "кофе"})
	if err != nil || h.Total != 1 {
		t.Fatal(h, err)
	}
	in.Rows[0].Tags = []string{"другой"}
	if _, err = s.saveImport(testContext, in); err == nil {
		t.Fatal("changed payload accepted")
	}
	balance(t, s, a, 8500)
	in = importInput(a, cat, "rollback")
	in.Rows[0].Description = "different"
	in.Rows[0].Tags = []string{"новый"}
	in.Rows = append(in.Rows, ImportRow{Transaction: Transaction{Date: "2026-10-02", SourcePage: 1, RowNumber: 2, AmountMinor: -100}, Decision: "save", CategoryID: cat, Tags: []string{" "}})
	if _, err = s.saveImport(testContext, in); err == nil {
		t.Fatal("invalid import accepted")
	}
	tags, _ := s.tags(testContext)
	if len(tags) != 1 {
		t.Fatal(tags)
	}
}
