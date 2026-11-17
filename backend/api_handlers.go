package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
)

func apiFailure(w http.ResponseWriter, err error) {
	var p *problem
	switch {
	case errors.As(err, &p):
		fail(w, p.status, p.message)
	case errors.Is(err, sql.ErrNoRows):
		fail(w, 404, "Запись не найдена.")
	default:
		fail(w, 500, "Не удалось выполнить операцию с базой. Изменения не применены; попробуйте ещё раз.")
	}
}
func readJSON(w http.ResponseWriter, r *http.Request, value any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 8<<20)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		fail(w, 400, "Некорректный JSON или слишком большой запрос.")
		return false
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		fail(w, 400, "Ожидается один JSON-объект.")
		return false
	}
	return true
}
func pathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		fail(w, 400, "Некорректный идентификатор.")
		return 0, false
	}
	return id, true
}
func jsonResult(w http.ResponseWriter, value any, err error) {
	if err != nil {
		apiFailure(w, err)
		return
	}
	reply(w, 200, value)
}
func registerDataAPI(mux *http.ServeMux, s *Store) {
	registerRulesAPI(mux, s)
	registerOrderAPI(mux, s)
	mux.HandleFunc("GET /api/tags", func(w http.ResponseWriter, r *http.Request) { out, err := s.tags(r.Context()); jsonResult(w, out, err) })
	mux.HandleFunc("GET /api/import-screen", func(w http.ResponseWriter, r *http.Request) {
		out, err := s.screen(r.Context(), true)
		jsonResult(w, out, err)
	})
	mux.HandleFunc("PUT /api/settings/monthly-limit", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			MonthlyLimitMinor OptionalLimit `json:"monthlyLimitMinor"`
		}
		if !readJSON(w, r, &in) {
			return
		}
		err := in.MonthlyLimitMinor.validate()
		if !in.MonthlyLimitMinor.Set {
			err = invalid("Укажите лимит или null.")
		}
		if err == nil {
			_, err = s.db.ExecContext(r.Context(), "UPDATE settings SET monthly_limit_minor=? WHERE id=1", in.MonthlyLimitMinor.Value)
		}
		jsonResult(w, map[string]bool{"ok": err == nil}, err)
	})
	mux.HandleFunc("GET /api/dashboard", func(w http.ResponseWriter, r *http.Request) {
		out, err := s.screen(r.Context(), false)
		jsonResult(w, out, err)
	})
	mux.HandleFunc("POST /api/accounts", func(w http.ResponseWriter, r *http.Request) {
		var in AccountInput
		if !readJSON(w, r, &in) {
			return
		}
		id, err := s.saveAccount(r.Context(), 0, in)
		jsonResult(w, map[string]int64{"id": id}, err)
	})
	mux.HandleFunc("PATCH /api/accounts/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathID(w, r)
		if !ok {
			return
		}
		var in AccountInput
		if !readJSON(w, r, &in) {
			return
		}
		_, err := s.saveAccount(r.Context(), id, in)
		jsonResult(w, map[string]int64{"id": id}, err)
	})
	mux.HandleFunc("POST /api/categories", func(w http.ResponseWriter, r *http.Request) {
		var in CategoryInput
		if !readJSON(w, r, &in) {
			return
		}
		id, err := s.saveCategory(r.Context(), 0, in)
		jsonResult(w, map[string]int64{"id": id}, err)
	})
	mux.HandleFunc("PATCH /api/categories/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathID(w, r)
		if !ok {
			return
		}
		var in CategoryInput
		if !readJSON(w, r, &in) {
			return
		}
		_, err := s.saveCategory(r.Context(), id, in)
		jsonResult(w, map[string]int64{"id": id}, err)
	})
	for _, table := range []string{"accounts", "categories"} {
		mux.HandleFunc("DELETE /api/"+table+"/{id}", func(w http.ResponseWriter, r *http.Request) {
			id, ok := pathID(w, r)
			if !ok {
				return
			}
			jsonResult(w, map[string]bool{"ok": true}, s.archive(r.Context(), table, id))
		})
	}

	mux.HandleFunc("GET /api/analytics", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		parse := func(key string) (int64, error) {
			if q.Get(key) == "" {
				return 0, nil
			}
			return strconv.ParseInt(q.Get(key), 10, 64)
		}
		a, ae := parse("accountId")
		c, ce := parse("categoryId")
		if ae != nil || ce != nil {
			fail(w, 400, "Некорректные фильтры аналитики.")
			return
		}
		kind := q.Get("kind")
		if kind == "" {
			kind = "expense"
		}
		out, err := s.analytics(r.Context(), HistoryFilter{AccountID: a, CategoryID: c, Tag: q.Get("tag"), From: q.Get("from"), To: q.Get("to")}, kind)
		jsonResult(w, out, err)
	})
	mux.HandleFunc("GET /api/transactions", func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query()
		parse := func(key string, defaultValue int64) (int64, error) {
			if query.Get(key) == "" {
				return defaultValue, nil
			}
			return strconv.ParseInt(query.Get(key), 10, 64)
		}
		account, aerr := parse("accountId", 0)
		category, cerr := parse("categoryId", 0)
		page, perr := parse("page", 1)
		if aerr != nil || cerr != nil || perr != nil {
			fail(w, 400, "Некорректные фильтры истории.")
			return
		}
		out, err := s.history(r.Context(), HistoryFilter{AccountID: account, CategoryID: category, Tag: query.Get("tag"), From: query.Get("from"), To: query.Get("to"), Page: int(page)})
		jsonResult(w, out, err)
	})
	mux.HandleFunc("POST /api/transactions", func(w http.ResponseWriter, r *http.Request) {
		var in OperationInput
		if !readJSON(w, r, &in) {
			return
		}
		id, err := s.saveOperation(r.Context(), 0, in)
		jsonResult(w, map[string]int64{"id": id}, err)
	})
	mux.HandleFunc("PATCH /api/transactions/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathID(w, r)
		if !ok {
			return
		}
		var in OperationInput
		if !readJSON(w, r, &in) {
			return
		}
		_, err := s.saveOperation(r.Context(), id, in)
		jsonResult(w, map[string]int64{"id": id}, err)
	})
	mux.HandleFunc("DELETE /api/transactions/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathID(w, r)
		if !ok {
			return
		}
		jsonResult(w, map[string]bool{"ok": true}, s.deleteOperation(r.Context(), id))
	})
	mux.HandleFunc("POST /api/imports/check", func(w http.ResponseWriter, r *http.Request) {
		var in ImportInput
		if !readJSON(w, r, &in) {
			return
		}
		out, err := s.checkImport(r.Context(), in)
		jsonResult(w, out, err)
	})
	mux.HandleFunc("POST /api/imports", func(w http.ResponseWriter, r *http.Request) {
		var in ImportInput
		if !readJSON(w, r, &in) {
			return
		}
		out, err := s.saveImport(r.Context(), in)
		jsonResult(w, out, err)
	})
}
