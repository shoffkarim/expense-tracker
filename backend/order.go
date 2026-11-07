package main

import (
	"database/sql"
	"net/http"
)

func registerOrderAPI(mux *http.ServeMux, s *Store) {
	mux.HandleFunc("PUT /api/dashboard/order", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Group string  `json:"group"`
			IDs   []int64 `json:"ids"`
		}
		if !readJSON(w, r, &in) {
			return
		}
		table, clause := "categories", "kind=?"
		args := []any{in.Group}
		switch in.Group {
		case "accounts":
			table, clause, args = "accounts", "1=1", nil
		case "expense", "income":
		default:
			apiFailure(w, invalid("Неизвестная группа."))
			return
		}
		err := s.write(r.Context(), func(tx *sql.Tx) error {
			var count int
			if err := tx.QueryRow("SELECT count(*) FROM "+table+" WHERE "+clause, args...).Scan(&count); err != nil {
				return err
			}
			bad := conflict("Список изменился. Обновите страницу.")
			if count != len(in.IDs) {
				return bad
			}
			seen := map[int64]bool{}
			for i, id := range in.IDs {
				if seen[id] {
					return bad
				}
				seen[id] = true
				values := append([]any{i, id}, args...)
				result, err := tx.Exec("UPDATE "+table+" SET dashboard_position=? WHERE id=? AND "+clause, values...)
				if err != nil {
					return err
				}
				n, err := result.RowsAffected()
				if err != nil {
					return err
				}
				if n != 1 {
					return bad
				}
			}
			return nil
		})
		jsonResult(w, map[string]bool{"ok": true}, err)
	})
}
