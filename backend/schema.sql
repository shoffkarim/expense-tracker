CREATE TABLE accounts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    icon TEXT NOT NULL,
    initial_balance_minor INTEGER NOT NULL,
    balance_minor INTEGER NOT NULL CHECK(typeof(balance_minor) = 'integer' AND abs(balance_minor) <= 9007199254740991),
    archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('expense', 'income')),
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    icon TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE category_months (
    category_id INTEGER NOT NULL REFERENCES categories(id),
    month TEXT NOT NULL,
    amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor) = 'integer' AND amount_minor BETWEEN 0 AND 9007199254740991),
    PRIMARY KEY(category_id, month)
);
CREATE TABLE balance_adjustments (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    before_minor INTEGER NOT NULL,
    after_minor INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE imports (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    file_hash TEXT NOT NULL,
    request_key TEXT NOT NULL UNIQUE,
    payload_hash TEXT NOT NULL,
    saved_count INTEGER NOT NULL,
    skipped_count INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(account_id, file_hash)
);
CREATE TABLE transactions (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('expense', 'income', 'transfer')),
    date TEXT NOT NULL,
    amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor) = 'integer' AND amount_minor BETWEEN 1 AND 9007199254740991),
    source_account_id INTEGER REFERENCES accounts(id),
    destination_account_id INTEGER REFERENCES accounts(id),
    category_id INTEGER REFERENCES categories(id),
    description TEXT NOT NULL DEFAULT '',
    comment TEXT NOT NULL DEFAULT '',
    import_id INTEGER REFERENCES imports(id),
    source_page INTEGER NOT NULL DEFAULT 0,
    row_number INTEGER NOT NULL DEFAULT 0,
    deleted INTEGER NOT NULL DEFAULT 0,
    CHECK(
      (kind = 'expense' AND source_account_id IS NOT NULL AND destination_account_id IS NULL AND category_id IS NOT NULL) OR
      (kind = 'income' AND source_account_id IS NULL AND destination_account_id IS NOT NULL AND category_id IS NOT NULL) OR
      (kind = 'transfer' AND source_account_id IS NOT NULL AND destination_account_id IS NOT NULL AND source_account_id != destination_account_id AND category_id IS NULL)
    )
);
CREATE INDEX transactions_date ON transactions(deleted, date DESC, id DESC);
CREATE INDEX transactions_source ON transactions(source_account_id, date, amount_minor);
CREATE INDEX transactions_destination ON transactions(destination_account_id, date, amount_minor);
CREATE INDEX transactions_category ON transactions(category_id, date);
-- Keep original statement identities even if the user later edits or deletes an operation.
CREATE TABLE import_rows (
    import_id INTEGER NOT NULL REFERENCES imports(id),
    source_page INTEGER NOT NULL,
    row_number INTEGER NOT NULL,
    date TEXT NOT NULL,
    amount_minor INTEGER NOT NULL,
    description_key TEXT NOT NULL,
    transaction_id INTEGER NOT NULL REFERENCES transactions(id),
    PRIMARY KEY(import_id, source_page, row_number)
);
CREATE INDEX import_rows_match ON import_rows(date, amount_minor, description_key);
