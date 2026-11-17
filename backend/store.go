package main

import (
	"context"
	"database/sql"
	_ "embed"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	_ "github.com/mattn/go-sqlite3"
)

const maxMoney int64 = 9007199254740991

//go:embed schema.sql
var schema string

type problem struct {
	status  int
	message string
}

func (e *problem) Error() string    { return e.message }
func invalid(message string) error  { return &problem{400, message} }
func conflict(message string) error { return &problem{409, message} }

type Store struct {
	db  *sql.DB
	now func() time.Time
}

func openStore(path string) (*Store, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(filepath.Dir(absolute), 0700); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(absolute, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = file.Close(); err != nil {
		return nil, err
	}
	dsn := (&url.URL{Scheme: "file", Path: absolute}).String() +
		"?_foreign_keys=on&_journal_mode=WAL&_busy_timeout=5000&_txlock=immediate&_synchronous=FULL"
	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return nil, err
	}
	// One connection serializes writes, including read-modify-write balance changes.
	db.SetMaxOpenConns(1)
	s := &Store{db: db, now: time.Now}
	if err = s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) migrate() error {
	err := s.write(context.Background(), func(tx *sql.Tx) error {
		var version int
		if err := tx.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
			return err
		}
		if version > 6 {
			return errors.New("база создана более новой версией приложения")
		}
		if version == 6 {
			return nil
		}
		if version == 5 {
			_, err := tx.Exec("ALTER TABLE accounts ADD COLUMN monthly_limit_minor INTEGER; ALTER TABLE categories ADD COLUMN monthly_limit_minor INTEGER; CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id=1), monthly_limit_minor INTEGER); INSERT INTO settings(id) VALUES(1); PRAGMA user_version=6;")
			return err
		}
		if version == 4 {
			_, err := tx.Exec(`ALTER TABLE accounts ADD COLUMN dashboard_position INTEGER NOT NULL DEFAULT 0; ALTER TABLE categories ADD COLUMN dashboard_position INTEGER NOT NULL DEFAULT 0; UPDATE accounts SET dashboard_position=id; UPDATE categories SET dashboard_position=id; CREATE TRIGGER accounts_position AFTER INSERT ON accounts BEGIN UPDATE accounts SET dashboard_position=(SELECT COALESCE(MAX(dashboard_position),0)+1 FROM accounts) WHERE id=NEW.id; END; CREATE TRIGGER categories_position AFTER INSERT ON categories BEGIN UPDATE categories SET dashboard_position=(SELECT COALESCE(MAX(dashboard_position),0)+1 FROM categories WHERE kind=NEW.kind) WHERE id=NEW.id; END; PRAGMA user_version=5;`)
			return err
		}
		if version == 3 {
			_, err := tx.Exec("ALTER TABLE import_rows RENAME TO import_rows_old; DROP INDEX import_rows_match; CREATE TABLE import_rows (import_id INTEGER NOT NULL REFERENCES imports(id), source_page INTEGER NOT NULL, row_number INTEGER NOT NULL, date TEXT NOT NULL, amount_minor INTEGER NOT NULL, description_key TEXT NOT NULL, transaction_id INTEGER NOT NULL REFERENCES transactions(id), part_index INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(import_id,source_page,row_number,part_index)); INSERT INTO import_rows SELECT import_id,source_page,row_number,date,amount_minor,description_key,transaction_id,0 FROM import_rows_old; DROP TABLE import_rows_old; CREATE INDEX import_rows_match ON import_rows(date,amount_minor,description_key); PRAGMA user_version=4")
			return err
		}
		if _, err := tx.Exec(tagsSchema); err != nil {
			return err
		}
		if version == 2 {
			_, err := tx.Exec("PRAGMA user_version = 3")
			return err
		}
		if version == 1 {
			if _, err := tx.Exec(rulesSchema); err != nil {
				return err
			}
			_, err := tx.Exec("PRAGMA user_version = 3")
			return err
		}
		if _, err := tx.Exec(schema); err != nil {
			return err
		}
		seeds := []Category{
			{Kind: "expense", Name: "Еда", Color: "#c87946", Icon: "food"},
			{Kind: "expense", Name: "Дом", Color: "#658c73", Icon: "home"},
			{Kind: "expense", Name: "Машина", Color: "#627eaa", Icon: "car"},
			{Kind: "expense", Name: "Медицина", Color: "#b66a7e", Icon: "health"},
			{Kind: "expense", Name: "Прочее", Color: "#8c7aa9", Icon: "other"},
			{Kind: "income", Name: "Зарплата", Color: "#658c73", Icon: "work"},
			{Kind: "income", Name: "Инвестиции", Color: "#627eaa", Icon: "chart"},
			{Kind: "income", Name: "Подарки", Color: "#b66a7e", Icon: "gift"},
			{Kind: "income", Name: "Прочее", Color: "#8c7aa9", Icon: "other"},
		}
		for _, c := range seeds {
			if _, err := tx.Exec("INSERT INTO categories(kind,name,color,icon) VALUES(?,?,?,?)", c.Kind, c.Name, c.Color, c.Icon); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(rulesSchema); err != nil {
			return err
		}
		_, err := tx.Exec("PRAGMA user_version = 3")
		return err
	})
	if err != nil {
		return err
	}
	var version int
	if err = s.db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	if version < 6 {
		return s.migrate()
	}
	return nil
}

func (s *Store) write(ctx context.Context, fn func(*sql.Tx) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}

type Account struct {
	MonthlyExpenseMinor int64  `json:"monthlyExpenseMinor"`
	MonthlyLimitMinor   *int64 `json:"monthlyLimitMinor"`
	DashboardPosition   int64  `json:"dashboardPosition"`
	ID                  int64  `json:"id"`
	Name                string `json:"name"`
	Color               string `json:"color"`
	Icon                string `json:"icon"`
	InitialBalanceMinor int64  `json:"initialBalanceMinor"`
	BalanceMinor        int64  `json:"balanceMinor"`
	Archived            bool   `json:"archived"`
}
type AccountInput struct {
	MonthlyLimitMinor OptionalLimit `json:"monthlyLimitMinor"`
	Name              string        `json:"name"`
	Color             string        `json:"color"`
	Icon              string        `json:"icon"`
	BalanceMinor      int64         `json:"balanceMinor"`
}
type Category struct {
	MonthlyLimitMinor *int64 `json:"monthlyLimitMinor"`
	DashboardPosition int64  `json:"dashboardPosition"`
	ID                int64  `json:"id"`
	Kind              string `json:"kind"`
	Name              string `json:"name"`
	Color             string `json:"color"`
	Icon              string `json:"icon"`
	Archived          bool   `json:"archived"`
	AmountMinor       int64  `json:"amountMinor"`
}
type CategoryInput struct {
	MonthlyLimitMinor OptionalLimit `json:"monthlyLimitMinor"`
	Kind              string        `json:"kind"`
	Name              string        `json:"name"`
	Color             string        `json:"color"`
	Icon              string        `json:"icon"`
}
type Screen struct {
	MonthlyLimitMinor *int64     `json:"monthlyLimitMinor"`
	Month             string     `json:"month"`
	TotalBalanceMinor int64      `json:"totalBalanceMinor"`
	Accounts          []Account  `json:"accounts"`
	Categories        []Category `json:"categories"`
}

var colorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
var icons = map[string]bool{"wallet": true, "bank": true, "card": true, "cash": true, "food": true, "home": true, "car": true, "health": true, "other": true, "work": true, "chart": true, "gift": true, "travel": true, "shopping": true, "coffee": true, "education": true, "piggybank": true, "coins": true, "receipt": true, "calculator": true, "shoppingcart": true, "store": true, "apple": true, "pizza": true, "cake": true, "icecreambowl": true, "fish": true, "beef": true, "milk": true, "wine": true, "bus": true, "trainfront": true, "bike": true, "fuel": true, "ship": true, "taxi": true, "bed": true, "sofa": true, "lamp": true, "refrigerator": true, "washingmachine": true, "wrench": true, "hammer": true, "plug": true, "droplets": true, "flame": true, "wifi": true, "phone": true, "laptop": true, "monitor": true, "tv": true, "camera": true, "headphones": true, "music": true, "gamepad2": true, "film": true, "bookopen": true, "dumbbell": true, "pill": true, "stethoscope": true, "pawprint": true, "baby": true, "shirt": true, "scissors": true}

func validAppearance(name, color, icon string) error {
	if strings.TrimSpace(name) == "" || utf8.RuneCountInString(name) > 80 {
		return invalid("Название должно содержать от 1 до 80 символов.")
	}
	if !colorPattern.MatchString(color) || !icons[icon] {
		return invalid("Выберите цвет и иконку из доступного набора.")
	}
	return nil
}

func (s *Store) screen(ctx context.Context, activeOnly bool) (Screen, error) {
	out := Screen{Month: s.now().Format("2006-01"), Accounts: []Account{}, Categories: []Category{}}
	err := s.write(ctx, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, "SELECT id,name,color,icon,initial_balance_minor,balance_minor,archived,dashboard_position,monthly_limit_minor FROM accounts ORDER BY archived,id")
		if err != nil {
			return err
		}
		for rows.Next() {
			var a Account
			if err = rows.Scan(&a.ID, &a.Name, &a.Color, &a.Icon, &a.InitialBalanceMinor, &a.BalanceMinor, &a.Archived, &a.DashboardPosition, &a.MonthlyLimitMinor); err != nil {
				rows.Close()
				return err
			}
			if !a.Archived {
				out.TotalBalanceMinor, err = checkedAdd(out.TotalBalanceMinor, a.BalanceMinor)
				if err != nil {
					rows.Close()
					return err
				}
			}
			if !activeOnly || !a.Archived {
				out.Accounts = append(out.Accounts, a)
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		rows, err = tx.QueryContext(ctx, `SELECT c.id,c.kind,c.name,c.color,c.icon,c.archived,COALESCE(m.amount_minor,0),c.dashboard_position,c.monthly_limit_minor
			FROM categories c LEFT JOIN category_months m ON m.category_id=c.id AND m.month=? ORDER BY c.archived,c.id`, out.Month)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var c Category
			if err = rows.Scan(&c.ID, &c.Kind, &c.Name, &c.Color, &c.Icon, &c.Archived, &c.AmountMinor, &c.DashboardPosition, &c.MonthlyLimitMinor); err != nil {
				return err
			}
			if !activeOnly || !c.Archived {
				out.Categories = append(out.Categories, c)
			}
		}
		if err := rows.Err(); err != nil {
			return err
		}
		rows.Close()
		if err := tx.QueryRowContext(ctx, "SELECT monthly_limit_minor FROM settings WHERE id=1").Scan(&out.MonthlyLimitMinor); err != nil {
			return err
		}
		for i := range out.Accounts {
			r, err := tx.QueryContext(ctx, "SELECT amount_minor FROM transactions WHERE deleted=0 AND kind='expense' AND source_account_id=? AND substr(date,1,7)=?", out.Accounts[i].ID, out.Month)
			if err != nil {
				return err
			}
			for r.Next() {
				var amount int64
				if err = r.Scan(&amount); err != nil {
					r.Close()
					return err
				}
				out.Accounts[i].MonthlyExpenseMinor, err = checkedAdd(out.Accounts[i].MonthlyExpenseMinor, amount)
				if err != nil {
					r.Close()
					return err
				}
			}
			err = r.Err()
			r.Close()
			if err != nil {
				return err
			}
		}
		return nil
	})
	return out, err
}

func checkedAdd(a, b int64) (int64, error) {
	if a > maxMoney || a < -maxMoney || (b > 0 && a > maxMoney-b) || (b < 0 && a < -maxMoney-b) {
		return 0, invalid("Сумма выходит за поддерживаемый диапазон.")
	}
	return a + b, nil
}

func (s *Store) saveAccount(ctx context.Context, id int64, in AccountInput) (int64, error) {
	if err := in.MonthlyLimitMinor.validate(); err != nil {
		return 0, err
	}
	if err := validAppearance(in.Name, in.Color, in.Icon); err != nil {
		return 0, err
	}
	if _, err := checkedAdd(0, in.BalanceMinor); err != nil {
		return 0, err
	}
	err := s.write(ctx, func(tx *sql.Tx) error {
		if id == 0 {
			result, err := tx.ExecContext(ctx, "INSERT INTO accounts(name,color,icon,initial_balance_minor,balance_minor) VALUES(?,?,?,?,?)", strings.TrimSpace(in.Name), in.Color, in.Icon, in.BalanceMinor, in.BalanceMinor)
			if err != nil {
				return err
			}
			id, err = result.LastInsertId()
			if err != nil {
				return err
			}
			return saveLimit(ctx, tx, "accounts", id, in.MonthlyLimitMinor)
		}
		var before int64
		var archived bool
		if err := tx.QueryRowContext(ctx, "SELECT balance_minor,archived FROM accounts WHERE id=?", id).Scan(&before, &archived); err != nil {
			return err
		}
		if archived {
			return conflict("Счёт находится в архиве.")
		}
		if before != in.BalanceMinor {
			if _, err := tx.ExecContext(ctx, "INSERT INTO balance_adjustments(account_id,before_minor,after_minor) VALUES(?,?,?)", id, before, in.BalanceMinor); err != nil {
				return err
			}
		}
		_, err := tx.ExecContext(ctx, "UPDATE accounts SET name=?,color=?,icon=?,balance_minor=? WHERE id=?", strings.TrimSpace(in.Name), in.Color, in.Icon, in.BalanceMinor, id)
		if err != nil {
			return err
		}
		return saveLimit(ctx, tx, "accounts", id, in.MonthlyLimitMinor)
	})
	return id, err
}

func (s *Store) saveCategory(ctx context.Context, id int64, in CategoryInput) (int64, error) {
	if err := in.MonthlyLimitMinor.validate(); err != nil {
		return 0, err
	}
	if in.Kind == "income" && in.MonthlyLimitMinor.Value != nil {
		return 0, invalid("Лимит доступен только для расходов.")
	}
	if err := validAppearance(in.Name, in.Color, in.Icon); err != nil {
		return 0, err
	}
	if in.Kind != "income" && in.Kind != "expense" {
		return 0, invalid("Выберите тип категории.")
	}
	err := s.write(ctx, func(tx *sql.Tx) error {
		if id == 0 {
			result, err := tx.ExecContext(ctx, "INSERT INTO categories(kind,name,color,icon) VALUES(?,?,?,?)", in.Kind, strings.TrimSpace(in.Name), in.Color, in.Icon)
			if err != nil {
				return err
			}
			id, err = result.LastInsertId()
			if err != nil {
				return err
			}
			return saveLimit(ctx, tx, "categories", id, in.MonthlyLimitMinor)
		}
		var kind string
		var archived bool
		if err := tx.QueryRowContext(ctx, "SELECT kind,archived FROM categories WHERE id=?", id).Scan(&kind, &archived); err != nil {
			return err
		}
		if archived {
			return conflict("Категория находится в архиве.")
		}
		if kind != in.Kind {
			return invalid("Тип существующей категории менять нельзя.")
		}
		_, err := tx.ExecContext(ctx, "UPDATE categories SET name=?,color=?,icon=? WHERE id=?", strings.TrimSpace(in.Name), in.Color, in.Icon, id)
		if err != nil {
			return err
		}
		return saveLimit(ctx, tx, "categories", id, in.MonthlyLimitMinor)
	})
	return id, err
}

func (s *Store) archive(ctx context.Context, table string, id int64) error {
	if table != "accounts" && table != "categories" {
		return errors.New("invalid archive table")
	}
	return s.write(ctx, func(tx *sql.Tx) error {
		result, err := tx.ExecContext(ctx, fmt.Sprintf("UPDATE %s SET archived=1 WHERE id=?", table), id)
		if err != nil {
			return err
		}
		n, err := result.RowsAffected()
		if err == nil && n == 0 {
			return sql.ErrNoRows
		}
		return err
	})
}
