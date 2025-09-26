-- Baseline schema for AssetTracker (SQLCipher/SQLite)
-- Runs on a brand new database file.

PRAGMA foreign_keys = ON;

-- =========================
-- Accounts
-- =========================
CREATE TABLE IF NOT EXISTS accounts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  color       TEXT,
  -- account types used by your code: "standard" | "reimbursable"
  type        TEXT NOT NULL DEFAULT 'standard'
                CHECK (type IN ('standard','reimbursable')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_accounts_name ON accounts(name COLLATE NOCASE);

-- =========================
-- Categories (case-insensitive unique)
-- =========================
CREATE TABLE IF NOT EXISTS categories (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE
);

-- =========================
-- Transactions
-- =========================
CREATE TABLE IF NOT EXISTS transactions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id   INTEGER NOT NULL
                 REFERENCES accounts(id) ON DELETE CASCADE,
  date         TEXT NOT NULL,        -- 'YYYY-MM-DD'
  description  TEXT,
  amount       REAL NOT NULL,        -- income > 0, expense < 0
  category_id  INTEGER NULL
                 REFERENCES categories(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- helpful indexes for your queries
CREATE INDEX IF NOT EXISTS idx_tx_account_date ON transactions(account_id, date, id);
CREATE INDEX IF NOT EXISTS idx_tx_date_id      ON transactions(date, id);
CREATE INDEX IF NOT EXISTS idx_tx_category_id  ON transactions(category_id);