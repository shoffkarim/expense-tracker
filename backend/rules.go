package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

const rulesSchema = `CREATE TABLE rules(id INTEGER PRIMARY KEY, position INTEGER NOT NULL, payload TEXT NOT NULL);`

type Rule struct {
	ID             int64  `json:"id"`
	Name           string `json:"name"`
	AccountID      int64  `json:"accountId"`
	Direction      string `json:"direction"`
	Condition      string `json:"condition"`
	Text           string `json:"text"`
	Day            int    `json:"day"`
	AmountMinor    int64  `json:"amountMinor"`
	CategoryID     int64  `json:"categoryId"`
	OtherAccountID int64  `json:"otherAccountId"`
	Available      bool   `json:"available"`
}

func (s *Store) rules(ctx context.Context) ([]Rule, error) {
	rows, e := s.db.QueryContext(ctx, "SELECT id,payload FROM rules ORDER BY position,id")
	if e != nil {
		return nil, e
	}
	out := []Rule{}
	for rows.Next() {
		var id int64
		var data string
		var r Rule
		if e = rows.Scan(&id, &data); e != nil {
			break
		}
		if e = json.Unmarshal([]byte(data), &r); e != nil {
			break
		}
		r.ID = id
		out = append(out, r)
	}
	if e == nil {
		e = rows.Err()
	}
	rows.Close()
	if e != nil {
		return nil, e
	}
	for i := range out {
		out[i].Available = s.validRule(ctx, out[i]) == nil
	}
	return out, nil
}
func (s *Store) validRule(ctx context.Context, r Rule) error {
	bad := &problem{400, "Проверьте название, условие и результат правила."}
	if strings.TrimSpace(r.Name) == "" || len([]rune(r.Name)) > 80 || (r.Direction != "expense" && r.Direction != "income") {
		return bad
	}
	if r.Condition == "text" {
		if descriptionKey(r.Text) == "" || len([]rune(r.Text)) > 4000 {
			return bad
		}
	} else if r.Condition != "day_amount" || r.Day < 1 || r.Day > 31 || r.AmountMinor <= 0 || r.AmountMinor > maxMoney {
		return bad
	}
	active := func(id int64) bool {
		var n int
		return s.db.QueryRowContext(ctx, "SELECT count(*) FROM accounts WHERE id=? AND archived=0", id).Scan(&n) == nil && n == 1
	}
	if r.AccountID < 0 || (r.AccountID != 0 && !active(r.AccountID)) {
		return bad
	}
	if (r.CategoryID > 0) == (r.OtherAccountID > 0) || r.CategoryID < 0 || r.OtherAccountID < 0 {
		return bad
	}
	if r.OtherAccountID > 0 {
		if !active(r.OtherAccountID) || r.OtherAccountID == r.AccountID {
			return bad
		}
	} else {
		var n int
		if s.db.QueryRowContext(ctx, "SELECT count(*) FROM categories WHERE id=? AND archived=0 AND kind=?", r.CategoryID, r.Direction).Scan(&n) != nil || n != 1 {
			return bad
		}
	}
	return nil
}
func ruleMatches(r Rule, t Transaction, account int64) bool {
	if !r.Available || t.AmountMinor == 0 || (r.AccountID != 0 && r.AccountID != account) || r.OtherAccountID == account {
		return false
	}
	if (t.AmountMinor < 0) != (r.Direction == "expense") {
		return false
	}
	if r.Condition == "text" {
		return strings.Contains(descriptionKey(t.Description), descriptionKey(r.Text))
	}
	amount := t.AmountMinor
	if amount < 0 {
		amount = -amount
	}
	day := 0
	if len(t.Date) == 10 {
		day, _ = strconv.Atoi(t.Date[8:])
	}
	return day == r.Day && amount == r.AmountMinor
}
func registerRulesAPI(mux *http.ServeMux, s *Store) {
	mux.HandleFunc("GET /api/rules", func(w http.ResponseWriter, r *http.Request) { out, e := s.rules(r.Context()); jsonResult(w, out, e) })
	save := func(w http.ResponseWriter, r *http.Request) {
		var in Rule
		if !readJSON(w, r, &in) {
			return
		}
		var id int64
		var ok bool
		if r.Method == "PATCH" {
			id, ok = pathID(w, r)
			if !ok {
				return
			}
		}
		if e := s.validRule(r.Context(), in); e != nil {
			apiFailure(w, e)
			return
		}
		in.ID = 0
		in.Available = false
		data, _ := json.Marshal(in)
		e := s.write(r.Context(), func(tx *sql.Tx) error {
			if id == 0 {
				res, e := tx.Exec("INSERT INTO rules(position,payload) SELECT COALESCE(MAX(position),0)+1,? FROM rules", string(data))
				if e != nil {
					return e
				}
				id, e = res.LastInsertId()
				return e
			}
			res, e := tx.Exec("UPDATE rules SET payload=? WHERE id=?", string(data), id)
			if e != nil {
				return e
			}
			n, _ := res.RowsAffected()
			if n == 0 {
				return sql.ErrNoRows
			}
			return nil
		})
		jsonResult(w, map[string]int64{"id": id}, e)
	}
	mux.HandleFunc("POST /api/rules", save)
	mux.HandleFunc("PATCH /api/rules/{id}", save)
	mux.HandleFunc("DELETE /api/rules/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathID(w, r)
		if !ok {
			return
		}
		res, e := s.db.ExecContext(r.Context(), "DELETE FROM rules WHERE id=?", id)
		if e == nil {
			n, _ := res.RowsAffected()
			if n == 0 {
				e = sql.ErrNoRows
			}
		}
		jsonResult(w, map[string]bool{"ok": true}, e)
	})
	mux.HandleFunc("PUT /api/rules/order", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			IDs []int64 `json:"ids"`
		}
		if !readJSON(w, r, &in) {
			return
		}
		e := s.write(r.Context(), func(tx *sql.Tx) error {
			var n int
			if e := tx.QueryRow("SELECT count(*) FROM rules").Scan(&n); e != nil {
				return e
			}
			bad := &problem{409, "Список изменился. Обновите страницу."}
			if n != len(in.IDs) {
				return bad
			}
			seen := map[int64]bool{}
			for i, id := range in.IDs {
				if seen[id] {
					return bad
				}
				seen[id] = true
				res, e := tx.Exec("UPDATE rules SET position=? WHERE id=?", i, id)
				if e != nil {
					return e
				}
				n, _ := res.RowsAffected()
				if n != 1 {
					return bad
				}
			}
			return nil
		})
		jsonResult(w, map[string]bool{"ok": true}, e)
	})
}
