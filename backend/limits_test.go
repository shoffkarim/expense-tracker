package main

import (
	"encoding/json"
	"testing"
)

func TestMonthlyLimits(t *testing.T) {
	s := testStore(t)
	var input AccountInput
	if err := json.Unmarshal([]byte(`{"name":"Synthetic","color":"#658c73","icon":"wallet","balanceMinor":1000,"monthlyLimitMinor":0}`), &input); err != nil {
		t.Fatal(err)
	}
	id, err := s.saveAccount(testContext, 0, input)
	if err != nil {
		t.Fatal(err)
	}
	view, err := s.screen(testContext, false)
	if err != nil {
		t.Fatal(err)
	}
	if view.Accounts[0].MonthlyLimitMinor == nil || *view.Accounts[0].MonthlyLimitMinor != 0 {
		t.Fatal("zero limit missing")
	}
	input.MonthlyLimitMinor = OptionalLimit{}
	if _, err = s.saveAccount(testContext, id, input); err != nil {
		t.Fatal(err)
	}
	view, err = s.screen(testContext, false)
	if err != nil || view.Accounts[0].MonthlyLimitMinor == nil {
		t.Fatal("omitted limit removed", err)
	}
	input.MonthlyLimitMinor = OptionalLimit{Set: true}
	if _, err = s.saveAccount(testContext, id, input); err != nil {
		t.Fatal(err)
	}
	view, err = s.screen(testContext, false)
	if err != nil || view.Accounts[0].MonthlyLimitMinor != nil {
		t.Fatal("limit not removed", err)
	}
	negative := int64(-1)
	input.MonthlyLimitMinor = OptionalLimit{Set: true, Value: &negative}
	if _, err = s.saveAccount(testContext, id, input); err == nil {
		t.Fatal("negative accepted")
	}
	c := categoryID(t, s, "expense")
	_, err = s.db.Exec("INSERT INTO transactions(kind,date,amount_minor,source_account_id,category_id) VALUES('expense',?,123,?,?)", s.now().Format("2006-01")+"-01", id, c)
	if err != nil {
		t.Fatal(err)
	}
	view, err = s.screen(testContext, false)
	if err != nil || view.Accounts[0].MonthlyExpenseMinor != 123 {
		t.Fatal("monthly expense", err)
	}
}
