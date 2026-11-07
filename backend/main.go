package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"io"
	"log"
	"mime"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const maxPDFSize = 20 << 20

type apiError struct {
	Error string `json:"error"`
}

func reply(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func fail(w http.ResponseWriter, status int, message string) { reply(w, status, apiError{message}) }

func parseHandler(poppler string, stores ...*Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Дополнительный мегабайт отведён на multipart-заголовки; сам PDF ограничен отдельно.
		r.Body = http.MaxBytesReader(w, r.Body, maxPDFSize+(1<<20))
		reader, err := r.MultipartReader()
		if err != nil {
			fail(w, 400, "Выберите PDF-файл для загрузки.")
			return
		}
		dir, err := os.MkdirTemp("", "expense-tracker-*")
		if err != nil {
			fail(w, 500, "Не удалось подготовить обработку файла.")
			return
		}
		defer os.RemoveAll(dir)
		input := filepath.Join(dir, "input.pdf")
		fingerprint := sha256.New()
		found := false
		for {
			part, err := reader.NextPart()
			if errors.Is(err, io.EOF) {
				break
			}
			if err != nil {
				uploadError(w, err)
				return
			}
			if found || part.FormName() != "file" || part.FileName() == "" {
				fail(w, 400, "Загрузите один PDF в поле file.")
				return
			}
			mediaType, _, err := mime.ParseMediaType(part.Header.Get("Content-Type"))
			if err != nil || (mediaType != "application/pdf" && mediaType != "application/octet-stream") {
				fail(w, 400, "Поддерживаются только PDF-файлы.")
				return
			}
			file, err := os.OpenFile(input, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0600)
			if err != nil {
				fail(w, 500, "Не удалось подготовить обработку файла.")
				return
			}
			size, copyErr := io.Copy(io.MultiWriter(file, fingerprint), io.LimitReader(part, maxPDFSize+1))
			closeErr := file.Close()
			if size > maxPDFSize {
				fail(w, 413, "Размер PDF не должен превышать 20 МиБ.")
				return
			}
			if copyErr != nil {
				uploadError(w, copyErr)
				return
			}
			if closeErr != nil {
				fail(w, 500, "Не удалось прочитать файл.")
				return
			}
			found = true
		}
		if !found {
			fail(w, 400, "Выберите PDF-файл для загрузки.")
			return
		}
		f, err := os.Open(input)
		if err != nil {
			fail(w, 500, "Не удалось прочитать файл.")
			return
		}
		signature := make([]byte, 5)
		_, err = io.ReadFull(f, signature)
		f.Close()
		if err != nil || string(signature) != "%PDF-" {
			fail(w, 400, "Файл не похож на PDF. Выберите банковскую выписку.")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		output := filepath.Join(dir, "output.xml")
		cmd := exec.CommandContext(ctx, poppler, "-bbox-layout", "-enc", "UTF-8", input, output)
		// stderr Poppler может содержать данные документа: не собираем и не логируем его.
		if err := cmd.Run(); err != nil {
			if ctx.Err() != nil {
				fail(w, 422, "Обработка прервана или заняла больше 30 секунд.")
				return
			}
			var exitErr *exec.ExitError
			if errors.As(err, &exitErr) {
				fail(w, 422, "Не удалось прочитать PDF. Возможно, он повреждён или защищён паролем.")
				return
			}
			fail(w, 500, "Не удалось запустить обработчик PDF.")
			return
		}
		xmlFile, err := os.Open(output)
		if err != nil {
			fail(w, 500, "Не удалось прочитать результат обработки.")
			return
		}
		defer xmlFile.Close()
		info, err := xmlFile.Stat()
		if err != nil {
			fail(w, 500, "Не удалось прочитать результат обработки.")
			return
		}
		if info.Size() > 64<<20 {
			fail(w, 422, "Слишком большой объём текста в PDF.")
			return
		}
		result, err := parseStatement(xmlFile)
		if err != nil {
			fail(w, 422, err.Error())
			return
		}
		result.FileHash = hex.EncodeToString(fingerprint.Sum(nil))
		if raw := r.URL.Query().Get("accountId"); raw != "" {
			id, e := strconv.ParseInt(raw, 10, 64)
			if e != nil || id <= 0 || len(stores) == 0 {
				fail(w, 400, "Выберите счёт выписки.")
				return
			}
			var n int
			if e = stores[0].db.QueryRowContext(r.Context(), "SELECT count(*) FROM accounts WHERE id=? AND archived=0", id).Scan(&n); e != nil {
				apiFailure(w, e)
				return
			}
			if n != 1 {
				fail(w, 400, "Выберите активный счёт.")
				return
			}
			rules, e := stores[0].rules(r.Context())
			if e != nil {
				apiFailure(w, e)
				return
			}
			type assigned struct {
				Tags []string `json:"tags,omitempty"`
				Transaction
				CategoryID     int64  `json:"categoryId,omitempty"`
				OtherAccountID int64  `json:"otherAccountId,omitempty"`
				RuleName       string `json:"ruleName,omitempty"`
			}
			rows := make([]assigned, len(result.Transactions))
			for i, t := range result.Transactions {
				rows[i].Transaction = t
				rows[i].CategoryID, rows[i].OtherAccountID, rows[i].Tags, rows[i].RuleName = assignRules(rules, t, id)
			}
			reply(w, 200, struct {
				Transactions []assigned     `json:"transactions"`
				Warnings     []ParseWarning `json:"warnings"`
				FileHash     string         `json:"fileHash"`
			}{rows, result.Warnings, result.FileHash})
			return
		}
		reply(w, 200, result)
	}
}

func uploadError(w http.ResponseWriter, err error) {
	var limit *http.MaxBytesError
	if errors.As(err, &limit) {
		fail(w, 413, "Размер PDF не должен превышать 20 МиБ.")
		return
	}
	fail(w, 400, "Не удалось прочитать загрузку. Выберите файл повторно.")
}

func localOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		if r.Host != "127.0.0.1:8080" && r.Host != "localhost:8080" {
			fail(w, 403, "Приложение доступно только локально.")
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" {
			u, err := url.Parse(origin)
			if err != nil || u.Scheme != "http" || (u.Host != r.Host && u.Host != "127.0.0.1:5173" && u.Host != "localhost:5173") {
				fail(w, 403, "Загружайте выписку через локальный интерфейс приложения.")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func main() {
	popplerPath := flag.String("pdftotext", "pdftotext", "Путь к утилите Poppler pdftotext")
	dist := flag.String("frontend", "../frontend/dist", "Каталог production-сборки frontend")
	dbPath := flag.String("db", "../data/expense-tracker.sqlite", "Путь к локальной базе SQLite")
	flag.Parse()
	store, err := openStore(*dbPath)
	if err != nil {
		log.Fatal("Не удалось открыть базу данных. Проверьте путь, права доступа и версию приложения.")
	}
	defer store.db.Close()
	poppler, err := exec.LookPath(*popplerPath)
	if err != nil {
		log.Fatal("Не найден pdftotext. Установите Poppler: brew install poppler")
	}
	mux := http.NewServeMux()
	registerDataAPI(mux, store)
	mux.HandleFunc("POST /api/parse-statement", parseHandler(poppler, store))
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { fail(w, 404, "API-метод не найден.") })
	static := http.FileServer(http.Dir(*dist))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "Метод не поддерживается.", http.StatusMethodNotAllowed)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/") && r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		if _, err := os.Stat(filepath.Join(*dist, "index.html")); err != nil {
			http.Error(w, "Frontend ещё не собран. Выполните npm run build в frontend или откройте http://127.0.0.1:5173 в режиме разработки.", 503)
			return
		}
		static.ServeHTTP(w, r)
	})
	server := &http.Server{Addr: "127.0.0.1:8080", Handler: localOnly(mux), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 45 * time.Second, WriteTimeout: 40 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 1 << 20}
	log.Print("Expense Tracker: http://127.0.0.1:8080")
	log.Fatal(server.ListenAndServe())
}
