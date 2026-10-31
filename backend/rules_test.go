package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestRuleMatching(t *testing.T) {
	r := Rule{Available: true, Direction: "expense", Condition: "text", Text: "  МАГАЗИН   еды "}
	row := Transaction{Date: "2026-10-31", Description: "Оплата магазин еды", AmountMinor: -15000}
	if !ruleMatches(r, row, 1) {
		t.Fatal("unicode normalization")
	}
	r.AccountID = 2
	if ruleMatches(r, row, 1) {
		t.Fatal("scope")
	}
	r.AccountID = 0
	r.OtherAccountID = 1
	if ruleMatches(r, row, 1) {
		t.Fatal("self transfer")
	}
	r.OtherAccountID = 0
	r.Condition = "day_amount"
	r.Day = 31
	r.AmountMinor = 15000
	if !ruleMatches(r, row, 1) {
		t.Fatal("day amount")
	}
	row.AmountMinor = 15000
	if ruleMatches(r, row, 1) {
		t.Fatal("direction")
	}
	r.Direction = "income"
	if !ruleMatches(r, row, 1) {
		t.Fatal("income")
	}
	row.AmountMinor = 0
	if ruleMatches(r, row, 1) {
		t.Fatal("zero")
	}
	r.Available = false
	row.AmountMinor = 15000
	if ruleMatches(r, row, 1) {
		t.Fatal("archived")
	}
}
func TestRulesCRUDAndMigration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ledger.sqlite")
	s, e := openStore(path)
	if e != nil {
		t.Fatal(e)
	}
	a := account(t, s, "Synthetic", 0)
	c := categoryID(t, s, "expense")
	if _, e = s.db.Exec("DROP TABLE rules; PRAGMA user_version=1"); e != nil {
		t.Fatal(e)
	}
	if e = s.migrate(); e != nil {
		t.Fatal(e)
	}
	mux := http.NewServeMux()
	registerRulesAPI(mux, s)
	call := func(method, path, body string) int {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest(method, path, strings.NewReader(body)))
		return w.Code
	}
	r := Rule{Name: "Synthetic", Direction: "expense", Condition: "text", Text: "shop", CategoryID: c, AccountID: a}
	b, _ := json.Marshal(r)
	if call("POST", "/api/rules", string(b)) != 200 {
		t.Fatal("create")
	}
	if call("PUT", "/api/rules/order", `{"ids":[1,1]}`) != 409 {
		t.Fatal("stale order")
	}
	if call("PUT", "/api/rules/order", `{"ids":[1]}`) != 200 {
		t.Fatal("order")
	}
	s.db.Close()
	s, e = openStore(path)
	if e != nil {
		t.Fatal(e)
	}
	defer s.db.Close()
	rules, e := s.rules(testContext)
	if e != nil || len(rules) != 1 || !rules[0].Available {
		t.Fatal("persistence", e)
	}
	if e = s.archive(testContext, "categories", c); e != nil {
		t.Fatal(e)
	}
	rules, e = s.rules(testContext)
	if e != nil || rules[0].Available {
		t.Fatal("archived category")
	}
}
