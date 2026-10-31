package main

import (
	"context"
	"database/sql"
	"strings"
	"time"
	"unicode/utf8"
)

type OperationInput struct {
	Kind                 string `json:"kind"`
	Date                 string `json:"date"`
	AmountMinor          int64  `json:"amountMinor"`
	SourceAccountID      int64  `json:"sourceAccountId,omitempty"`
	DestinationAccountID int64  `json:"destinationAccountId,omitempty"`
	CategoryID           int64  `json:"categoryId,omitempty"`
	Description          string `json:"description"`
	Comment              string `json:"comment"`
}
type Operation struct {
	ID int64 `json:"id"`
	OperationInput
	ImportID   int64 `json:"importId,omitempty"`
	SourcePage int   `json:"sourcePage,omitempty"`
	RowNumber  int   `json:"rowNumber,omitempty"`
}

const operationColumns = `id,kind,date,amount_minor,COALESCE(source_account_id,0),COALESCE(destination_account_id,0),COALESCE(category_id,0),description,comment,COALESCE(import_id,0),source_page,row_number`

type scanner interface{ Scan(...any) error }

func scanOperation(row scanner) (Operation, error) {
	var o Operation
	err := row.Scan(&o.ID, &o.Kind, &o.Date, &o.AmountMinor, &o.SourceAccountID, &o.DestinationAccountID, &o.CategoryID, &o.Description, &o.Comment, &o.ImportID, &o.SourcePage, &o.RowNumber)
	return o, err
}

func validDate(date string) bool {
	parsed, err := time.Parse("2006-01-02", date)
	return err == nil && parsed.Format("2006-01-02") == date && parsed.Year() >= 1900
}

func validateOperation(ctx context.Context, tx *sql.Tx, in OperationInput, old *Operation) error {
	if !validDate(in.Date) {
		return invalid("Укажите дату в формате ГГГГ-ММ-ДД, начиная с 1900 года.")
	}
	if in.AmountMinor <= 0 || in.AmountMinor > maxMoney {
		return invalid("Сумма операции должна быть положительным целым числом копеек.")
	}
	if utf8.RuneCountInString(in.Description) > 4000 || utf8.RuneCountInString(in.Comment) > 2000 {
		return invalid("Слишком длинное описание или комментарий.")
	}
	switch in.Kind {
	case "expense":
		if in.SourceAccountID <= 0 || in.DestinationAccountID != 0 || in.CategoryID <= 0 {
			return invalid("Для расхода выберите счёт и категорию расхода.")
		}
	case "income":
		if in.DestinationAccountID <= 0 || in.SourceAccountID != 0 || in.CategoryID <= 0 {
			return invalid("Для дохода выберите категорию дохода и счёт.")
		}
	case "transfer":
		if in.SourceAccountID <= 0 || in.DestinationAccountID <= 0 || in.SourceAccountID == in.DestinationAccountID || in.CategoryID != 0 {
			return invalid("Для перевода выберите два разных счёта.")
		}
	default:
		return invalid("Неизвестный тип операции.")
	}
	for _, id := range []int64{in.SourceAccountID, in.DestinationAccountID} {
		if id == 0 {
			continue
		}
		var archived bool
		if err := tx.QueryRowContext(ctx, "SELECT archived FROM accounts WHERE id=?", id).Scan(&archived); err != nil {
			if err == sql.ErrNoRows {
				return invalid("Выбранный счёт не найден.")
			}
			return err
		}
		// Existing historical links may remain archived, but cannot be newly selected.
		if archived && (old == nil || (id != old.SourceAccountID && id != old.DestinationAccountID)) {
			return conflict("Выбранный счёт находится в архиве. Обновите справочник.")
		}
	}
	if in.CategoryID > 0 {
		var kind string
		var archived bool
		if err := tx.QueryRowContext(ctx, "SELECT kind,archived FROM categories WHERE id=?", in.CategoryID).Scan(&kind, &archived); err != nil {
			if err == sql.ErrNoRows {
				return invalid("Выбранная категория не найдена.")
			}
			return err
		}
		if kind != in.Kind {
			return invalid("Тип категории не соответствует операции.")
		}
		if archived && (old == nil || in.CategoryID != old.CategoryID) {
			return conflict("Выбранная категория находится в архиве. Обновите справочник.")
		}
	}
	return nil
}

func applyOperation(ctx context.Context, tx *sql.Tx, in OperationInput, direction int64) error {
	return applyChanges(ctx, tx, operationChange{in, direction})
}

type operationChange struct {
	operation OperationInput
	direction int64
}

// Apply the net edit, so reverting the old operation cannot transiently overflow
// an account after a manual balance correction. Each call has at most two changes.
func applyChanges(ctx context.Context, tx *sql.Tx, changes ...operationChange) error {
	accounts := map[int64]int64{}
	type monthKey struct {
		categoryID int64
		month      string
	}
	months := map[monthKey]int64{}
	for _, change := range changes {
		in := change.operation
		delta := in.AmountMinor * change.direction
		accounts[in.SourceAccountID] -= delta
		accounts[in.DestinationAccountID] += delta
		if in.CategoryID != 0 {
			months[monthKey{in.CategoryID, in.Date[:7]}] += delta
		}
	}
	for id, delta := range accounts {
		if id == 0 || delta == 0 {
			continue
		}
		var balance int64
		if err := tx.QueryRowContext(ctx, "SELECT balance_minor FROM accounts WHERE id=?", id).Scan(&balance); err != nil {
			return err
		}
		next, err := checkedAdd(balance, delta)
		if err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, "UPDATE accounts SET balance_minor=? WHERE id=?", next, id); err != nil {
			return err
		}
	}
	for key, delta := range months {
		if delta == 0 {
			continue
		}
		var current int64
		err := tx.QueryRowContext(ctx, "SELECT amount_minor FROM category_months WHERE category_id=? AND month=?", key.categoryID, key.month).Scan(&current)
		if err != nil && err != sql.ErrNoRows {
			return err
		}
		next, err := checkedAdd(current, delta)
		if err != nil {
			return err
		}
		if next < 0 {
			return invalid("Нарушена согласованность итогов категории.")
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO category_months(category_id,month,amount_minor) VALUES(?,?,?)
			ON CONFLICT(category_id,month) DO UPDATE SET amount_minor=excluded.amount_minor`, key.categoryID, key.month, next)
		if err != nil {
			return err
		}
	}
	return nil
}

func insertOperation(ctx context.Context, tx *sql.Tx, in OperationInput, importID int64, page, row int) (int64, error) {
	if err := validateOperation(ctx, tx, in, nil); err != nil {
		return 0, err
	}
	result, err := tx.ExecContext(ctx, `INSERT INTO transactions(kind,date,amount_minor,source_account_id,destination_account_id,category_id,description,comment,import_id,source_page,row_number)
		VALUES(?,?,?,NULLIF(?,0),NULLIF(?,0),NULLIF(?,0),?,?,NULLIF(?,0),?,?)`,
		in.Kind, in.Date, in.AmountMinor, in.SourceAccountID, in.DestinationAccountID, in.CategoryID, in.Description, in.Comment, importID, page, row)
	if err != nil {
		return 0, err
	}
	if err = applyOperation(ctx, tx, in, 1); err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func (s *Store) saveOperation(ctx context.Context, id int64, in OperationInput) (int64, error) {
	err := s.write(ctx, func(tx *sql.Tx) error {
		if id == 0 {
			var err error
			id, err = insertOperation(ctx, tx, in, 0, 0, 0)
			return err
		}
		old, err := scanOperation(tx.QueryRowContext(ctx, "SELECT "+operationColumns+" FROM transactions WHERE id=? AND deleted=0", id))
		if err != nil {
			return err
		}
		if err = validateOperation(ctx, tx, in, &old); err != nil {
			return err
		}
		if err = applyChanges(ctx, tx, operationChange{old.OperationInput, -1}, operationChange{in, 1}); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `UPDATE transactions SET kind=?,date=?,amount_minor=?,source_account_id=NULLIF(?,0),destination_account_id=NULLIF(?,0),category_id=NULLIF(?,0),description=?,comment=? WHERE id=?`,
			in.Kind, in.Date, in.AmountMinor, in.SourceAccountID, in.DestinationAccountID, in.CategoryID, in.Description, in.Comment, id)
		return err
	})
	return id, err
}

func (s *Store) deleteOperation(ctx context.Context, id int64) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		old, err := scanOperation(tx.QueryRowContext(ctx, "SELECT "+operationColumns+" FROM transactions WHERE id=? AND deleted=0", id))
		if err != nil {
			return err
		}
		if err = applyOperation(ctx, tx, old.OperationInput, -1); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, "UPDATE transactions SET deleted=1 WHERE id=?", id)
		return err
	})
}

type HistoryFilter struct {
	AccountID, CategoryID int64
	From, To              string
	Page                  int
}
type History struct {
	Transactions []Operation `json:"transactions"`
	Total        int         `json:"total"`
	Page         int         `json:"page"`
	PageSize     int         `json:"pageSize"`
}

func (s *Store) history(ctx context.Context, f HistoryFilter) (History, error) {
	out := History{Transactions: []Operation{}, Page: f.Page, PageSize: 20}
	if f.Page < 1 || f.Page > 1000000 || f.AccountID < 0 || f.CategoryID < 0 || (f.From != "" && !validDate(f.From)) || (f.To != "" && !validDate(f.To)) || (f.From != "" && f.To != "" && f.From > f.To) {
		return out, invalid("Некорректные параметры истории.")
	}
	where := []string{"deleted=0"}
	args := []any{}
	if f.AccountID != 0 {
		where = append(where, "(source_account_id=? OR destination_account_id=?)")
		args = append(args, f.AccountID, f.AccountID)
	}
	if f.CategoryID != 0 {
		where = append(where, "category_id=?")
		args = append(args, f.CategoryID)
	}
	if f.From != "" {
		where = append(where, "date>=?")
		args = append(args, f.From)
	}
	if f.To != "" {
		where = append(where, "date<=?")
		args = append(args, f.To)
	}
	clause := strings.Join(where, " AND ")
	err := s.write(ctx, func(tx *sql.Tx) error {
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM transactions WHERE "+clause, args...).Scan(&out.Total); err != nil {
			return err
		}
		queryArgs := append(append([]any{}, args...), out.PageSize, (f.Page-1)*out.PageSize)
		rows, err := tx.QueryContext(ctx, "SELECT "+operationColumns+" FROM transactions WHERE "+clause+" ORDER BY date DESC,id DESC LIMIT ? OFFSET ?", queryArgs...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			o, err := scanOperation(rows)
			if err != nil {
				return err
			}
			out.Transactions = append(out.Transactions, o)
		}
		return rows.Err()
	})
	return out, err
}
