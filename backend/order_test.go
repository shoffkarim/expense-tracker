package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDashboardOrder(t *testing.T) {
	s := testStore(t)
	a := account(t, s, "First", 100)
	b := account(t, s, "Second", 200)
	mux := http.NewServeMux()
	registerOrderAPI(mux, s)
	call := func(ids string) int {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest("PUT", "/api/dashboard/order", strings.NewReader(`{"group":"accounts","ids":`+ids+`}`)))
		return w.Code
	}
	if code := call(fmt.Sprintf("[%d,%d]", b, a)); code != 200 {
		t.Fatal(code)
	}
	if code := call(fmt.Sprintf("[%d,%d]", a, a)); code != 409 {
		t.Fatal(code)
	}
	screen, err := s.screen(testContext, false)
	if err != nil {
		t.Fatal(err)
	}
	if screen.Accounts[0].ID != a || screen.Accounts[0].DashboardPosition != 1 || screen.Accounts[1].DashboardPosition != 0 || screen.TotalBalanceMinor != 300 {
		t.Fatal("order or balances changed unexpectedly")
	}
	c := account(t, s, "Third", 0)
	var pos int
	if err := s.db.QueryRow("SELECT dashboard_position FROM accounts WHERE id=?", c).Scan(&pos); err != nil || pos != 2 {
		t.Fatal(pos, err)
	}
}
