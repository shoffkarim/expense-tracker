package main

import (
	"context"
	"database/sql"
	"encoding/json"
)

type OptionalLimit struct {
	Set   bool
	Value *int64
}

func (v *OptionalLimit) UnmarshalJSON(data []byte) error {
	v.Set = true
	return json.Unmarshal(data, &v.Value)
}
func (v OptionalLimit) validate() error {
	if v.Value != nil && (*v.Value < 0 || *v.Value > maxMoney) {
		return invalid("Лимит должен быть неотрицательной суммой в допустимом диапазоне.")
	}
	return nil
}
func saveLimit(ctx context.Context, tx *sql.Tx, table string, id int64, limit OptionalLimit) error {
	if !limit.Set {
		return nil
	}
	_, err := tx.ExecContext(ctx, "UPDATE "+table+" SET monthly_limit_minor=? WHERE id=?", limit.Value, id)
	return err
}
