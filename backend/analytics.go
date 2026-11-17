package main

import "context"

type AnalyticsCategory struct {
	CategoryID  int64  `json:"categoryId"`
	Name        string `json:"name"`
	Color       string `json:"color"`
	AmountMinor int64  `json:"amountMinor"`
}
type Analytics struct {
	TotalMinor int64               `json:"totalMinor"`
	Categories []AnalyticsCategory `json:"categories"`
}

func (s *Store) analytics(ctx context.Context, f HistoryFilter, kind string) (Analytics, error) {
	out := Analytics{Categories: []AnalyticsCategory{}}
	if (kind != "expense" && kind != "income") || f.AccountID < 0 || f.CategoryID < 0 || (f.From != "" && !validDate(f.From)) || (f.To != "" && !validDate(f.To)) || (f.From != "" && f.To != "" && f.From > f.To) {
		return out, invalid("Некорректные фильтры аналитики.")
	}
	clause, args := transactionConditions(f)
	args = append(args, kind)
	rows, err := s.db.QueryContext(ctx, "SELECT category_id,c.name,c.color,SUM(amount_minor) FROM transactions JOIN categories c ON c.id=category_id WHERE "+clause+" AND transactions.kind=? GROUP BY category_id ORDER BY SUM(amount_minor) DESC,category_id", args...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var c AnalyticsCategory
		if err = rows.Scan(&c.CategoryID, &c.Name, &c.Color, &c.AmountMinor); err != nil {
			return out, err
		}
		out.TotalMinor, err = checkedAdd(out.TotalMinor, c.AmountMinor)
		if err != nil {
			return out, err
		}
		out.Categories = append(out.Categories, c)
	}
	return out, rows.Err()
}
