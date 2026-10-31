package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

var testContext = context.Background()

func testStore(t *testing.T) *Store {
	t.Helper()
	s, err := openStore(filepath.Join(t.TempDir(), "ledger.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	s.now = func() time.Time { return time.Date(2026, 10, 20, 12, 0, 0, 0, time.Local) }
	t.Cleanup(func() { s.db.Close() })
	return s
}
func account(t *testing.T, s *Store, name string, balance int64) int64 {
	t.Helper()
	id, err := s.saveAccount(testContext, 0, AccountInput{Name: name, Color: "#658c73", Icon: "wallet", BalanceMinor: balance})
	if err != nil {
		t.Fatal(err)
	}
	return id
}
func categoryID(t *testing.T, s *Store, kind string) int64 {
	t.Helper()
	var id int64
	if err := s.db.QueryRow("SELECT id FROM categories WHERE kind=? ORDER BY id LIMIT 1", kind).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}
func operation(t *testing.T, s *Store, in OperationInput) int64 {
	t.Helper()
	id, err := s.saveOperation(testContext, 0, in)
	if err != nil {
		t.Fatal(err)
	}
	return id
}
func balance(t *testing.T, s *Store, id int64, want int64) {
	t.Helper()
	var got int64
	if err := s.db.QueryRow("SELECT balance_minor FROM accounts WHERE id=?", id).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("account %d: got %d, want %d", id, got, want)
	}
}
func total(t *testing.T, s *Store, id int64, month string, want int64) {
	t.Helper()
	var got int64
	err := s.db.QueryRow("SELECT amount_minor FROM category_months WHERE category_id=? AND month=?", id, month).Scan(&got)
	if err != nil && err != sql.ErrNoRows {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("category %d month %s: got %d, want %d", id, month, got, want)
	}
}
func TestLedgerLifecycle(t *testing.T) {
	s := testStore(t)
	a := account(t, s, "A", 10000)
	b := account(t, s, "B", 2000)
	expense, income := categoryID(t, s, "expense"), categoryID(t, s, "income")
	o := OperationInput{Kind: "expense", Date: "2026-09-30", AmountMinor: 1500, SourceAccountID: a, CategoryID: expense}
	id := operation(t, s, o)
	operation(t, s, OperationInput{Kind: "income", Date: "2026-10-01", AmountMinor: 5000, DestinationAccountID: a, CategoryID: income})
	transfer := operation(t, s, OperationInput{Kind: "transfer", Date: "2026-10-02", AmountMinor: 3000, SourceAccountID: a, DestinationAccountID: b})
	balance(t, s, a, 10500)
	balance(t, s, b, 5000)
	total(t, s, expense, "2026-09", 1500)
	total(t, s, expense, "2026-10", 0)
	total(t, s, income, "2026-10", 5000)
	view, err := s.screen(testContext, false)
	if err != nil {
		t.Fatal(err)
	}
	if view.TotalBalanceMinor != 15500 {
		t.Fatal(view.TotalBalanceMinor)
	}
	other, err := s.saveCategory(testContext, 0, CategoryInput{Kind: "expense", Name: "Дом", Color: "#627eaa", Icon: "home"})
	if err != nil {
		t.Fatal(err)
	}
	o.Date = "2026-10-03"
	o.AmountMinor = 2500
	o.SourceAccountID = b
	o.CategoryID = other
	if _, err = s.saveOperation(testContext, id, o); err != nil {
		t.Fatal(err)
	}
	balance(t, s, a, 12000)
	balance(t, s, b, 2500)
	total(t, s, expense, "2026-09", 0)
	total(t, s, other, "2026-10", 2500)
	if err = s.deleteOperation(testContext, id); err != nil {
		t.Fatal(err)
	}
	if err = s.deleteOperation(testContext, transfer); err != nil {
		t.Fatal(err)
	}
	balance(t, s, a, 15000)
	balance(t, s, b, 2000)
	total(t, s, other, "2026-10", 0)
	h, err := s.history(testContext, HistoryFilter{Page: 1})
	if err != nil {
		t.Fatal(err)
	}
	if h.Total != 1 {
		t.Fatal(h.Total)
	}
}
func TestBalanceCorrectionAndHistoricalEdit(t *testing.T) {
	s := testStore(t)
	a := account(t, s, "A", 10000)
	cat := categoryID(t, s, "expense")
	o := OperationInput{Kind: "expense", Date: "2020-01-01", AmountMinor: 2000, SourceAccountID: a, CategoryID: cat}
	id := operation(t, s, o)
	if _, err := s.saveAccount(testContext, a, AccountInput{Name: "A", Color: "#658c73", Icon: "card", BalanceMinor: 50000}); err != nil {
		t.Fatal(err)
	}
	o.AmountMinor = 3000
	if _, err := s.saveOperation(testContext, id, o); err != nil {
		t.Fatal(err)
	}
	balance(t, s, a, 49000)
	total(t, s, cat, "2020-01", 3000)
	if err := s.deleteOperation(testContext, id); err != nil {
		t.Fatal(err)
	}
	balance(t, s, a, 52000)
	var count int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM balance_adjustments").Scan(&count); err != nil || count != 1 {
		t.Fatal(count, err)
	}
}

func TestEditNearMoneyLimitAppliesNetDifference(t *testing.T) {
	s := testStore(t)
	a := account(t, s, "A", 10000)
	cat := categoryID(t, s, "expense")
	o := OperationInput{Kind: "expense", Date: "2026-10-01", AmountMinor: 100, SourceAccountID: a, CategoryID: cat}
	id := operation(t, s, o)
	if _, err := s.saveAccount(testContext, a, AccountInput{Name: "A", Color: "#658c73", Icon: "card", BalanceMinor: maxMoney}); err != nil {
		t.Fatal(err)
	}
	o.AmountMinor = 110
	if _, err := s.saveOperation(testContext, id, o); err != nil {
		t.Fatal(err)
	}
	balance(t, s, a, maxMoney-10)
	total(t, s, cat, "2026-10", 110)
}
func TestArchivePreservesLinks(t *testing.T) {
	s := testStore(t)
	a := account(t, s, "A", 10000)
	cat := categoryID(t, s, "expense")
	o := OperationInput{Kind: "expense", Date: "2026-10-01", AmountMinor: 2000, SourceAccountID: a, CategoryID: cat}
	id := operation(t, s, o)
	if err := s.archive(testContext, "accounts", a); err != nil {
		t.Fatal(err)
	}
	if err := s.archive(testContext, "categories", cat); err != nil {
		t.Fatal(err)
	}
	view, err := s.screen(testContext, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Accounts) != 0 || view.TotalBalanceMinor != 0 {
		t.Fatal(view)
	}
	full, err := s.screen(testContext, false)
	if err != nil {
		t.Fatal(err)
	}
	if !full.Accounts[0].Archived || full.Categories[len(full.Categories)-1].AmountMinor != 2000 {
		t.Fatal(full)
	}
	if _, err = s.saveOperation(testContext, 0, o); err == nil {
		t.Fatal("new operation on archived account accepted")
	}
	o.Comment = "Historical correction"
	if _, err = s.saveOperation(testContext, id, o); err != nil {
		t.Fatal(err)
	}
	if err = s.deleteOperation(testContext, id); err != nil {
		t.Fatal(err)
	}
	balance(t, s, a, 10000)
}
func importInput(a, cat int64, hash string) ImportInput {
	return ImportInput{AccountID: a, FileHash: digest(hash), RequestKey: "test-request-key-" + hash, Rows: []ImportRow{
		{Transaction: Transaction{SourcePage: 1, RowNumber: 1, Date: "2026-10-01", Description: "Synthetic store", AmountMinor: -1500}, CategoryID: cat, Decision: "save"},
	}}
}
func TestImportAtomicityAndIdempotency(t *testing.T) {
	s := testStore(t)
	a := account(t, s, "A", 10000)
	cat := categoryID(t, s, "expense")
	in := importInput(a, cat, "first")
	result, err := s.saveImport(testContext, in)
	if err != nil {
		t.Fatal(err)
	}
	repeat, err := s.saveImport(testContext, in)
	if err != nil || repeat != result {
		t.Fatal(repeat, err)
	}
	balance(t, s, a, 8500)
	total(t, s, cat, "2026-10", 1500)
	in.RequestKey = "test-request-key-different"
	if _, err = s.saveImport(testContext, in); err == nil {
		t.Fatal("same file accepted")
	}
	in = importInput(a, cat, "second")
	check, err := s.checkImport(testContext, in)
	if err != nil {
		t.Fatal(err)
	}
	if len(check.Rows[0].Matches) != 1 {
		t.Fatal(check)
	}
	if _, err = s.saveImport(testContext, in); err == nil {
		t.Fatal("duplicate without consent accepted")
	}
	in.Rows[0].Decision = "keep"
	in.Rows[0].MatchToken = check.Rows[0].MatchToken
	if _, err = s.saveImport(testContext, in); err != nil {
		t.Fatal(err)
	}
	balance(t, s, a, 7000)
	// A later invalid row must not create an import or mutate a balance.
	bad := importInput(a, cat, "invalid")
	bad.Rows[0].Date = "2026-10-05"
	bad.Rows = append(bad.Rows, ImportRow{Transaction: Transaction{SourcePage: 1, RowNumber: 2, Date: "2026-10-05", AmountMinor: -1000}, CategoryID: 999, Decision: "save"})
	if _, err = s.saveImport(testContext, bad); err == nil {
		t.Fatal("invalid package accepted")
	}
	balance(t, s, a, 7000)
	var n int
	if err = s.db.QueryRow("SELECT COUNT(*) FROM imports").Scan(&n); err != nil || n != 2 {
		t.Fatal(n, err)
	}
}
func TestImportRollbackAfterWrites(t *testing.T) {
	s := testStore(t)
	a := account(t, s, "A", -maxMoney+100)
	cat := categoryID(t, s, "expense")
	in := importInput(a, cat, "overflow")
	in.Rows[0].AmountMinor = -50
	in.Rows = append(in.Rows, ImportRow{Transaction: Transaction{SourcePage: 1, RowNumber: 2, Date: "2026-10-02", AmountMinor: -100}, CategoryID: cat, Decision: "save"})
	if _, err := s.saveImport(testContext, in); err == nil {
		t.Fatal("overflow accepted")
	}
	balance(t, s, a, -maxMoney+100)
	total(t, s, cat, "2026-10", 0)
	var n int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM imports").Scan(&n); err != nil || n != 0 {
		t.Fatal(n, err)
	}
}
func TestTransferMirrorAndOriginalIdentity(t *testing.T) {
	s := testStore(t)
	a := account(t, s, "A", 10000)
	b := account(t, s, "B", 0)
	cat := categoryID(t, s, "expense")
	in := importInput(a, cat, "transfer")
	in.Rows[0].CategoryID = 0
	in.Rows[0].OtherAccountID = b
	if _, err := s.saveImport(testContext, in); err != nil {
		t.Fatal(err)
	}
	mirror := importInput(b, cat, "mirror")
	mirror.Rows[0].AmountMinor = 1500
	mirror.Rows[0].Description = "Different bank description"
	check, err := s.checkImport(testContext, mirror)
	if err != nil {
		t.Fatal(err)
	}
	if len(check.Rows[0].Matches) != 1 || !strings.Contains(check.Rows[0].Matches[0].Reason, "перевода") {
		t.Fatal(check)
	}
	mirror.Rows[0].Decision = "skip"
	mirror.Rows = append(mirror.Rows, ImportRow{Transaction: Transaction{SourcePage: 1, RowNumber: 2, Date: "2026-10-03", Description: "Other", AmountMinor: -100}, CategoryID: cat, Decision: "save"})
	if _, err = s.saveImport(testContext, mirror); err != nil {
		t.Fatal(err)
	}
	balance(t, s, a, 8500)
	balance(t, s, b, 1400)
	h, _ := s.history(testContext, HistoryFilter{Page: 1, AccountID: a})
	old := h.Transactions[0]
	old.Date = "2026-09-01"
	old.Description = "Edited"
	old.AmountMinor = 2000
	if _, err = s.saveOperation(testContext, old.ID, old.OperationInput); err != nil {
		t.Fatal(err)
	}
	if err = s.deleteOperation(testContext, old.ID); err != nil {
		t.Fatal(err)
	}
	overlap := importInput(a, cat, "overlap")
	check, err = s.checkImport(testContext, overlap)
	if err != nil || len(check.Rows[0].Matches) != 1 {
		t.Fatal(check, err)
	}
}
func TestNewDuplicateRequiresReview(t *testing.T) {
	s := testStore(t)
	a := account(t, s, "A", 10000)
	cat := categoryID(t, s, "expense")
	in := importInput(a, cat, "pending")
	check, err := s.checkImport(testContext, in)
	if err != nil {
		t.Fatal(err)
	}
	in.Rows[0].MatchToken = check.Rows[0].MatchToken
	in.Rows[0].Decision = "keep"
	operation(t, s, OperationInput{Kind: "expense", Date: in.Rows[0].Date, Description: in.Rows[0].Description, AmountMinor: 1500, SourceAccountID: a, CategoryID: cat})
	if _, err = s.saveImport(testContext, in); err == nil {
		t.Fatal("new duplicate accepted with stale token")
	}
	balance(t, s, a, 8500)
}
func TestWithinFileDuplicatesAndZero(t *testing.T) {
	s := testStore(t)
	a := account(t, s, "A", 10000)
	cat := categoryID(t, s, "expense")
	in := importInput(a, cat, "batch")
	second := in.Rows[0]
	second.RowNumber = 2
	in.Rows = append(in.Rows, second)
	check, err := s.checkImport(testContext, in)
	if err != nil {
		t.Fatal(err)
	}
	for i := range in.Rows {
		if len(check.Rows[i].Matches) != 1 {
			t.Fatal(check)
		}
		related := check.Rows[i].Matches[0].RelatedRows
		if len(related) != 1 || related[0].RowNumber != in.Rows[1-i].RowNumber || related[0].SourcePage != in.Rows[1-i].SourcePage {
			t.Fatalf("unexpected related rows: %+v", related)
		}
		in.Rows[i].Decision = "keep"
		in.Rows[i].MatchToken = check.Rows[i].MatchToken
	}
	if _, err = s.saveImport(testContext, in); err != nil {
		t.Fatal(err)
	}
	balance(t, s, a, 7000)
	zero := importInput(a, cat, "zero")
	zero.Rows[0].AmountMinor = 0
	if _, err = s.saveImport(testContext, zero); err == nil {
		t.Fatal("zero operation accepted")
	}
	zero.Rows[0].Decision = "skip"
	if _, err = s.saveImport(testContext, zero); err == nil {
		t.Fatal("empty import accepted")
	}
}
func TestConcurrentImportAndWrites(t *testing.T) {
	s := testStore(t)
	a := account(t, s, "A", 10000)
	cat := categoryID(t, s, "expense")
	in := importInput(a, cat, "concurrent")
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := s.saveImport(testContext, in); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	balance(t, s, a, 8500)
	total(t, s, cat, "2026-10", 1500)
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := s.saveOperation(testContext, 0, OperationInput{Kind: "expense", Date: "2026-10-02", AmountMinor: 100, SourceAccountID: a, CategoryID: cat})
			if err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	balance(t, s, a, 7500)
	total(t, s, cat, "2026-10", 2500)
}
func TestPersistenceAndMonthBoundary(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ledger.sqlite")
	s, err := openStore(path)
	if err != nil {
		t.Fatal(err)
	}
	a := account(t, s, "A", 10000)
	cat := categoryID(t, s, "expense")
	operation(t, s, OperationInput{Kind: "expense", Date: "2026-10-31", AmountMinor: 1000, SourceAccountID: a, CategoryID: cat})
	if err = s.db.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = openStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.db.Close()
	s.now = func() time.Time { return time.Date(2026, 11, 1, 0, 0, 0, 0, time.Local) }
	balance(t, s, a, 9000)
	view, err := s.screen(testContext, false)
	if err != nil {
		t.Fatal(err)
	}
	if view.Month != "2026-11" || view.Categories[0].AmountMinor != 0 {
		t.Fatal(view)
	}
	total(t, s, cat, "2026-10", 1000)
	var count int
	if err = s.db.QueryRow("SELECT COUNT(*) FROM categories").Scan(&count); err != nil || count != 9 {
		t.Fatal(count, err)
	}
}
func TestHistoryFilteringAndAPIValidation(t *testing.T) {
	s := testStore(t)
	a := account(t, s, "A", 0)
	cat := categoryID(t, s, "expense")
	for i := 0; i < 32; i++ {
		operation(t, s, OperationInput{Kind: "expense", Date: "2026-10-02", AmountMinor: 100, SourceAccountID: a, CategoryID: cat})
	}
	h, err := s.history(testContext, HistoryFilter{Page: 2, AccountID: a, CategoryID: cat, From: "2026-10-01", To: "2026-10-31"})
	if err != nil || h.Total != 32 || len(h.Transactions) != 2 {
		t.Fatal(h, err)
	}
	mux := http.NewServeMux()
	registerDataAPI(mux, s)
	handler := localOnly(mux)
	cases := []struct {
		method, path, body string
		status             int
	}{
		{"GET", "/api/dashboard", "", 200},
		{"GET", "/api/import-screen", "", 200},
		{"GET", "/api/transactions?page=0", "", 400},
		{"GET", "/api/transactions?from=2026-02-30", "", 400},
		{"PATCH", "/api/accounts/999", `{"name":"x","color":"#658c73","icon":"wallet","balanceMinor":0}`, 404},
		{"POST", "/api/accounts", `{"name":"x","color":"#658c73","icon":"wallet","balanceMinor":1.5}`, 400},
		{"POST", "/api/accounts", `{"name":"x","color":"#658c73","icon":"wallet","balanceMinor":0,"extra":1}`, 400},
		{"POST", "/api/transactions", fmt.Sprintf(`{"kind":"transfer","date":"2026-10-01","amountMinor":100,"sourceAccountId":%d,"destinationAccountId":%d,"description":"","comment":""}`, a, a), 400},
	}
	for _, tc := range cases {
		t.Run(tc.path+tc.body, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, "http://127.0.0.1:8080"+tc.path, strings.NewReader(tc.body))
			out := httptest.NewRecorder()
			handler.ServeHTTP(out, req)
			if out.Code != tc.status {
				t.Fatalf("got %d: %s", out.Code, out.Body.String())
			}
			var body any
			if err := json.Unmarshal(out.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
		})
	}
	req := httptest.NewRequest("GET", "http://example.com/api/dashboard", nil)
	out := httptest.NewRecorder()
	handler.ServeHTTP(out, req)
	if out.Code != 403 {
		t.Fatal(out.Code)
	}
}
