-- Drop transactions.reimbursement_account_id by table-rebuild

-- 1) Recreate transactions without reimbursement_account_id
CREATE TABLE transactions_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date          TEXT    NOT NULL,               -- 'YYYY-MM-DD'
  description   TEXT,
  amount        REAL    NOT NULL,
  category      TEXT,                            -- legacy text (kept for rollout)
  category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL
);

-- 2) Copy data
INSERT INTO transactions_new (id, account_id, date, description, amount, category, category_id)
SELECT id, account_id, date, description, amount, category, category_id
FROM transactions;

-- 3) Replace table
DROP INDEX IF EXISTS idx_transactions_category_id;
DROP TABLE transactions;
ALTER TABLE transactions_new RENAME TO transactions;

-- 4) Recreate helpful indexes
CREATE INDEX IF NOT EXISTS idx_transactions_category_id ON transactions(category_id);
