package main

import (
	"context"
	"database/sql"
	"strings"
	"unicode/utf8"
)

const tagsSchema = `CREATE TABLE IF NOT EXISTS tags(id INTEGER PRIMARY KEY, name TEXT NOT NULL, key TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS transaction_tags(transaction_id INTEGER NOT NULL REFERENCES transactions(id), tag_id INTEGER NOT NULL REFERENCES tags(id), PRIMARY KEY(transaction_id,tag_id));
CREATE INDEX IF NOT EXISTS transaction_tags_tag ON transaction_tags(tag_id,transaction_id);`

func normalizeTags(tags []string) ([]string, error) {
	out := []string{}
	seen := map[string]bool{}
	for _, name := range tags {
		name = strings.Join(strings.Fields(name), " ")
		if name == "" || utf8.RuneCountInString(name) > 80 {
			return nil, invalid("Тег должен содержать от 1 до 80 символов.")
		}
		key := descriptionKey(name)
		if !seen[key] {
			out = append(out, name)
			seen[key] = true
		}
	}
	return out, nil
}
func saveTags(ctx context.Context, tx *sql.Tx, tags []string, operationID int64) ([]string, error) {
	names, err := normalizeTags(tags)
	if err != nil {
		return nil, err
	}
	if operationID > 0 {
		if _, err = tx.ExecContext(ctx, "DELETE FROM transaction_tags WHERE transaction_id=?", operationID); err != nil {
			return nil, err
		}
	}
	for i, name := range names {
		if _, err = tx.ExecContext(ctx, "INSERT INTO tags(name,key) VALUES(?,?) ON CONFLICT(key) DO NOTHING", name, descriptionKey(name)); err != nil {
			return nil, err
		}
		var id int64
		if err = tx.QueryRowContext(ctx, "SELECT id,name FROM tags WHERE key=?", descriptionKey(name)).Scan(&id, &names[i]); err != nil {
			return nil, err
		}
		if operationID > 0 {
			if _, err = tx.ExecContext(ctx, "INSERT INTO transaction_tags(transaction_id,tag_id) VALUES(?,?)", operationID, id); err != nil {
				return nil, err
			}
		}
	}
	return names, nil
}
func operationTags(ctx context.Context, tx *sql.Tx, id int64) ([]string, error) {
	rows, err := tx.QueryContext(ctx, "SELECT t.name FROM tags t JOIN transaction_tags tt ON t.id=tt.tag_id WHERE tt.transaction_id=? ORDER BY t.key", id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var name string
		if err = rows.Scan(&name); err != nil {
			return nil, err
		}
		out = append(out, name)
	}
	return out, rows.Err()
}
func (s *Store) tags(ctx context.Context) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT name FROM tags ORDER BY key")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var name string
		if err = rows.Scan(&name); err != nil {
			return nil, err
		}
		out = append(out, name)
	}
	return out, rows.Err()
}
