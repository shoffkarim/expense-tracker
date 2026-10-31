package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"testing"
)

// Opt-in: financial source files are never fixtures committed to the project.
// No operation text, amounts or response bodies are printed by this test.
func TestRealStatementImport(t *testing.T) {
	path := os.Getenv("EXPENSE_TRACKER_TEST_PDF")
	if path == "" {
		t.Skip("set EXPENSE_TRACKER_TEST_PDF to a local statement to run")
	}
	poppler := os.Getenv("EXPENSE_TRACKER_PDFTOTEXT")
	if poppler == "" {
		poppler = "pdftotext"
	}
	poppler, err := exec.LookPath(poppler)
	if err != nil {
		t.Fatal("Poppler is unavailable")
	}
	poppler, err = filepath.Abs(poppler)
	if err != nil {
		t.Fatal("Cannot resolve Poppler path")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal("Cannot read local statement")
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "statement.pdf")
	if err != nil {
		t.Fatal("Cannot prepare upload")
	}
	if _, err = part.Write(data); err != nil {
		t.Fatal("Cannot write upload")
	}
	if err = writer.Close(); err != nil {
		t.Fatal("Cannot finalize upload")
	}
	req := httptest.NewRequest("POST", "/api/parse-statement", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	response := httptest.NewRecorder()
	parseHandler(poppler).ServeHTTP(response, req)
	if response.Code != 200 {
		t.Fatalf("Parsing failed with HTTP %d", response.Code)
	}
	var parsed ParseResult
	if json.Unmarshal(response.Body.Bytes(), &parsed) != nil || len(parsed.Transactions) == 0 {
		t.Fatal("No parsed transactions")
	}
	hash := sha256.Sum256(data)
	if parsed.FileHash != hex.EncodeToString(hash[:]) {
		t.Fatal("Incorrect statement fingerprint")
	}
	if len(parsed.Warnings) != 0 {
		t.Fatal("Statement has warnings; review it locally")
	}
	if value := os.Getenv("EXPENSE_TRACKER_TEST_COUNT"); value != "" {
		count, err := strconv.Atoi(value)
		if err != nil || count <= 0 {
			t.Fatal("Invalid expected transaction count")
		}
		if len(parsed.Transactions) != count {
			t.Fatalf("Expected %d operations, got %d", count, len(parsed.Transactions))
		}
	}
	if path := os.Getenv("EXPENSE_TRACKER_TEST_EXPECTED"); path != "" {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal("Cannot read local reference")
		}
		var reference ParseResult
		if json.Unmarshal(data, &reference) != nil || len(reference.Transactions) == 0 {
			t.Fatal("Invalid local reference")
		}
		if len(parsed.Transactions) < len(reference.Transactions) {
			t.Fatal("Fewer operations than in the reference")
		}
		for i, expected := range reference.Transactions {
			if parsed.Transactions[i] != expected {
				t.Fatalf("Operation %d differs from the reference", i+1)
			}
		}
		t.Logf("First %d operations match the reference", len(reference.Transactions))
	}
	s := testStore(t)
	a := account(t, s, "Acceptance", 0)
	expense, income := categoryID(t, s, "expense"), categoryID(t, s, "income")
	in := ImportInput{AccountID: a, FileHash: parsed.FileHash, RequestKey: "local-statement-acceptance"}
	var expected int64
	for _, row := range parsed.Transactions {
		category := expense
		if row.AmountMinor > 0 {
			category = income
		}
		expected += row.AmountMinor
		in.Rows = append(in.Rows, ImportRow{Transaction: row, CategoryID: category, Decision: "save"})
	}
	check, err := s.checkImport(testContext, in)
	if err != nil {
		t.Fatal("Cannot check parsed statement")
	}
	for i := range in.Rows {
		if in.Rows[i].AmountMinor == 0 {
			in.Rows[i].Decision = "skip"
		} else if len(check.Rows[i].Matches) > 0 {
			in.Rows[i].Decision = "keep"
			in.Rows[i].MatchToken = check.Rows[i].MatchToken
		}
	}
	result, err := s.saveImport(testContext, in)
	if err != nil || result.Saved+result.Skipped != len(parsed.Transactions) {
		t.Fatal("Cannot save complete parsed statement")
	}
	var actual int64
	if s.db.QueryRow("SELECT balance_minor FROM accounts WHERE id=?", a).Scan(&actual) != nil || actual != expected {
		t.Fatal("Balance differs from statement total")
	}
	repeat, err := s.saveImport(testContext, in)
	if err != nil || repeat != result {
		t.Fatal("Import retry is not idempotent")
	}
	t.Logf("Parsed and imported %d operations; no warnings; idempotent retry passed", result.Saved)
}
