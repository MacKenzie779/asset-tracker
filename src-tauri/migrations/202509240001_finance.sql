-- Accounts + Transactions for the Home dashboard

CREATE TABLE IF NOT EXISTS accounts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  color       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,           -- ISO date 'YYYY-MM-DD'
  description TEXT,
  amount      REAL NOT NULL,           -- income > 0, expense < 0
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date DESC);

-- Ensure at least one default account exists for first-run UX
INSERT INTO accounts (name)
SELECT 'Main'
WHERE NOT EXISTS (SELECT 1 FROM accounts LIMIT 1);
