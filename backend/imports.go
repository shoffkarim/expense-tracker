package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"
)

type ImportRow struct {
	Transaction
	CategoryID     int64  `json:"categoryId,omitempty"`
	OtherAccountID int64  `json:"otherAccountId,omitempty"`
	Comment        string `json:"comment"`
	Decision       string `json:"decision"` // save, skip, keep (explicit duplicate override)
	MatchToken     string `json:"matchToken,omitempty"`
}
type ImportInput struct {
	AccountID  int64       `json:"accountId"`
	FileHash   string      `json:"fileHash"`
	RequestKey string      `json:"requestKey,omitempty"`
	Rows       []ImportRow `json:"rows"`
}
type ImportPosition struct {
	SourcePage int `json:"sourcePage"`
	RowNumber  int `json:"rowNumber"`
}
type ImportMatch struct {
	RelatedRows   []ImportPosition `json:"relatedRows,omitempty"`
	TransactionID int64            `json:"transactionId,omitempty"`
	Reason        string           `json:"reason"`
}
type RowCheck struct {
	Matches    []ImportMatch `json:"matches"`
	MatchToken string        `json:"matchToken"`
}
type ImportCheck struct {
	AlreadyImported bool       `json:"alreadyImported"`
	Rows            []RowCheck `json:"rows"`
}
type ImportResult struct {
	ID      int64 `json:"id"`
	Saved   int   `json:"saved"`
	Skipped int   `json:"skipped"`
}

func digest(value any) string {
	data, _ := json.Marshal(value)
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}
func descriptionKey(value string) string {
	return strings.ToLower(strings.Join(strings.Fields(value), " "))
}
func rowKey(row ImportRow) string {
	return digest([]any{row.Date, row.AmountMinor, descriptionKey(row.Description)})
}

func validateImport(in ImportInput) error {
	hash, err := hex.DecodeString(in.FileHash)
	if err != nil || len(hash) != 32 || in.FileHash != strings.ToLower(in.FileHash) {
		return invalid("Некорректный отпечаток выписки. Загрузите PDF заново.")
	}
	if in.AccountID <= 0 || len(in.Rows) == 0 || len(in.Rows) > 5000 {
		return invalid("Выберите счёт и выписку, содержащую от 1 до 5000 операций.")
	}
	positions := map[string]bool{}
	for _, row := range in.Rows {
		if !validDate(row.Date) || row.AmountMinor < -maxMoney || row.AmountMinor > maxMoney || row.SourcePage <= 0 || row.RowNumber <= 0 || utf8.RuneCountInString(row.Description) > 4000 || utf8.RuneCountInString(row.Comment) > 2000 {
			return invalid("В выписке есть некорректная строка.")
		}
		if row.Decision != "save" && row.Decision != "skip" && row.Decision != "keep" {
			return invalid("Выберите действие для каждой строки.")
		}
		key := fmt.Sprintf("%d:%d", row.SourcePage, row.RowNumber)
		if positions[key] {
			return invalid("Позиции строк в выписке должны быть уникальны.")
		}
		positions[key] = true
	}
	return nil
}

func checkImport(ctx context.Context, tx *sql.Tx, in ImportInput) (ImportCheck, error) {
	out := ImportCheck{Rows: []RowCheck{}}
	var archived bool
	if err := tx.QueryRowContext(ctx, "SELECT archived FROM accounts WHERE id=?", in.AccountID).Scan(&archived); err != nil {
		if err == sql.ErrNoRows {
			return out, invalid("Счёт не найден.")
		}
		return out, err
	}
	if archived {
		return out, conflict("Счёт выписки находится в архиве.")
	}
	if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM imports WHERE account_id=? AND file_hash=?)", in.AccountID, in.FileHash).Scan(&out.AlreadyImported); err != nil {
		return out, err
	}
	groups := map[string][]ImportPosition{}
	for _, row := range in.Rows {
		key := rowKey(row)
		groups[key] = append(groups[key], ImportPosition{row.SourcePage, row.RowNumber})
	}
	for _, row := range in.Rows {
		matches := map[int64]string{}
		rows, err := tx.QueryContext(ctx, `SELECT r.transaction_id FROM import_rows r JOIN imports i ON i.id=r.import_id
			WHERE i.account_id=? AND r.date=? AND r.amount_minor=? AND r.description_key=?`, in.AccountID, row.Date, row.AmountMinor, descriptionKey(row.Description))
		if err != nil {
			return out, err
		}
		for rows.Next() {
			var id int64
			if err = rows.Scan(&id); err != nil {
				rows.Close()
				return out, err
			}
			matches[id] = "Эта строка встречалась в сохранённой выписке."
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return out, err
		}
		amount := row.AmountMinor
		if amount < 0 {
			amount = -amount
		}
		rows, err = tx.QueryContext(ctx, `SELECT id,kind,description FROM transactions WHERE deleted=0 AND date=? AND amount_minor=?
			AND ((source_account_id=? AND ?<0) OR (destination_account_id=? AND ?>0))`,
			row.Date, amount, in.AccountID, row.AmountMinor, in.AccountID, row.AmountMinor)
		if err != nil {
			return out, err
		}
		for rows.Next() {
			var id int64
			var kind, description string
			if err = rows.Scan(&id, &kind, &description); err != nil {
				rows.Close()
				return out, err
			}
			if kind == "transfer" {
				matches[id] = "Возможная сторона уже учтённого перевода."
			} else if descriptionKey(description) == descriptionKey(row.Description) {
				matches[id] = "Совпадают счёт, дата, сумма и описание."
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return out, err
		}
		check := RowCheck{Matches: []ImportMatch{}}
		ids := make([]int64, 0, len(matches))
		for id := range matches {
			ids = append(ids, id)
		}
		sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
		for _, id := range ids {
			check.Matches = append(check.Matches, ImportMatch{TransactionID: id, Reason: matches[id]})
		}
		group := groups[rowKey(row)]
		if len(group) > 1 {
			related := []ImportPosition{}
			for _, position := range group {
				if position.SourcePage != row.SourcePage || position.RowNumber != row.RowNumber {
					related = append(related, position)
				}
			}
			check.Matches = append(check.Matches, ImportMatch{RelatedRows: related, Reason: "Похожие строки в этой выписке."})
		}
		check.MatchToken = digest([]any{in.AccountID, in.FileHash, rowKey(row), check.Matches})
		out.Rows = append(out.Rows, check)
	}
	return out, nil
}

func (s *Store) checkImport(ctx context.Context, in ImportInput) (ImportCheck, error) {
	out := ImportCheck{}
	if err := validateImport(in); err != nil {
		return out, err
	}
	err := s.write(ctx, func(tx *sql.Tx) error { var err error; out, err = checkImport(ctx, tx, in); return err })
	return out, err
}

func importOperation(accountID int64, row ImportRow) (OperationInput, error) {
	o := OperationInput{Date: row.Date, Description: row.Description, Comment: row.Comment, CategoryID: row.CategoryID, AmountMinor: row.AmountMinor}
	if row.AmountMinor == 0 {
		return o, invalid("Операцию с нулевой суммой нужно пропустить.")
	}
	if row.OtherAccountID != 0 && row.CategoryID != 0 {
		return o, invalid("Выберите либо категорию, либо другой счёт.")
	}
	if row.AmountMinor < 0 {
		o.AmountMinor = -row.AmountMinor
		o.Kind = "expense"
		o.SourceAccountID = accountID
	} else {
		o.Kind = "income"
		o.DestinationAccountID = accountID
	}
	if row.OtherAccountID > 0 {
		o.Kind = "transfer"
		if row.AmountMinor < 0 {
			o.DestinationAccountID = row.OtherAccountID
		} else {
			o.SourceAccountID = row.OtherAccountID
		}
	}
	return o, nil
}

func (s *Store) saveImport(ctx context.Context, in ImportInput) (ImportResult, error) {
	out := ImportResult{}
	if err := validateImport(in); err != nil {
		return out, err
	}
	if len(in.RequestKey) < 16 || len(in.RequestKey) > 100 {
		return out, invalid("Некорректный ключ сохранения.")
	}
	payloadHash := digest(in)
	err := s.write(ctx, func(tx *sql.Tx) error {
		var storedHash string
		err := tx.QueryRowContext(ctx, "SELECT id,saved_count,skipped_count,payload_hash FROM imports WHERE request_key=?", in.RequestKey).Scan(&out.ID, &out.Saved, &out.Skipped, &storedHash)
		if err == nil {
			if storedHash != payloadHash {
				return conflict("Этот ключ уже использован для другого набора операций.")
			}
			return nil
		}
		if err != sql.ErrNoRows {
			return err
		}
		check, err := checkImport(ctx, tx, in)
		if err != nil {
			return err
		}
		if check.AlreadyImported {
			return conflict("Эта выписка уже сохранена для выбранного счёта. Изменить операции можно в истории.")
		}
		for i, row := range in.Rows {
			if row.Decision == "skip" {
				out.Skipped++
				continue
			}
			if len(check.Rows[i].Matches) > 0 && (row.Decision != "keep" || row.MatchToken != check.Rows[i].MatchToken) {
				return conflict("Обнаружены возможные повторы. Проверьте совпадения перед сохранением.")
			}
			o, err := importOperation(in.AccountID, row)
			if err != nil {
				return err
			}
			if err = validateOperation(ctx, tx, o, nil); err != nil {
				return err
			}
			out.Saved++
		}
		if out.Saved == 0 {
			return invalid("Нет операций для сохранения.")
		}
		result, err := tx.ExecContext(ctx, "INSERT INTO imports(account_id,file_hash,request_key,payload_hash,saved_count,skipped_count) VALUES(?,?,?,?,?,?)", in.AccountID, in.FileHash, in.RequestKey, payloadHash, out.Saved, out.Skipped)
		if err != nil {
			return err
		}
		out.ID, err = result.LastInsertId()
		if err != nil {
			return err
		}
		for _, row := range in.Rows {
			if row.Decision == "skip" {
				continue
			}
			o, err := importOperation(in.AccountID, row)
			if err != nil {
				return err
			}
			id, err := insertOperation(ctx, tx, o, out.ID, row.SourcePage, row.RowNumber)
			if err != nil {
				return err
			}
			if _, err = tx.ExecContext(ctx, `INSERT INTO import_rows(import_id,source_page,row_number,date,amount_minor,description_key,transaction_id) VALUES(?,?,?,?,?,?,?)`,
				out.ID, row.SourcePage, row.RowNumber, row.Date, row.AmountMinor, descriptionKey(row.Description), id); err != nil {
				return err
			}
		}
		return nil
	})
	return out, err
}
