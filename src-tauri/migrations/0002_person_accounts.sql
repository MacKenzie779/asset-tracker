-- 0002: "reimbursable" accounts become naturally signed "person" accounts.
--
-- A person account represents someone you settle up with:
--   balance > 0  they owe you        balance < 0  you owe them
-- Net worth is therefore the plain sum of all balances; no sign flipping.
--
-- What this migration does:
--   1. rebuilds `accounts` so the type check allows 'person' instead of 'reimbursable'
--   2. adds `transactions.transfer_id`, linking the two legs of a transfer
--   3. negates every amount on former reimbursable accounts (natural sign)
--   4. links the legs of existing transfers
--   5. converts the old mirrored reimbursable entries into linked transfers
--
-- sqlx runs this inside a transaction. `PRAGMA foreign_keys = OFF` is not
-- possible there, so the table rebuild relies on deferred foreign keys: the
-- child rows in `transactions` are unresolved only between DROP and the
-- re-insert of the same ids, and everything is checked again at COMMIT.

PRAGMA defer_foreign_keys = ON;

-- 1. Rebuild accounts with the new type check (SQLite cannot alter CHECK constraints).
CREATE TABLE accounts_mig_copy AS
  SELECT id, name, color, type, created_at, updated_at FROM accounts;

DROP TABLE accounts;

CREATE TABLE accounts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  color       TEXT,
  -- "standard": your own money.  "person": someone you settle up with.
  type        TEXT NOT NULL DEFAULT 'standard'
                CHECK (type IN ('standard','person')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO accounts (id, name, color, type, created_at, updated_at)
  SELECT id, name, color,
         CASE WHEN type = 'reimbursable' THEN 'person' ELSE type END,
         created_at, updated_at
  FROM accounts_mig_copy;

DROP TABLE accounts_mig_copy;

CREATE INDEX IF NOT EXISTS idx_accounts_name ON accounts(name COLLATE NOCASE);

-- 2. Transfer link: both legs of a transfer share the id of the source leg.
ALTER TABLE transactions ADD COLUMN transfer_id INTEGER NULL;
CREATE INDEX IF NOT EXISTS idx_tx_transfer_id ON transactions(transfer_id);

-- 3. Natural sign for person accounts.
UPDATE transactions
   SET amount = -amount
 WHERE account_id IN (SELECT id FROM accounts WHERE type = 'person');

-- 4. Link existing transfer pairs. The app inserted the negative source leg
--    first and the positive destination leg immediately after it.
INSERT OR IGNORE INTO categories(name) VALUES ('Transfer');

CREATE TEMP TABLE mig_transfer_pairs AS
  SELECT a.id AS a_id, b.id AS b_id
    FROM transactions a
    JOIN transactions b ON b.id = a.id + 1
    JOIN categories ca ON ca.id = a.category_id
    JOIN categories cb ON cb.id = b.category_id
   WHERE LOWER(ca.name) = 'transfer'
     AND LOWER(cb.name) = 'transfer'
     AND a.amount < 0
     AND ABS(a.amount + b.amount) < 0.000001
     AND a.date = b.date
     AND a.description IS b.description
     AND a.account_id <> b.account_id;

UPDATE transactions
   SET transfer_id = (SELECT p.a_id FROM mig_transfer_pairs p
                       WHERE p.a_id = transactions.id OR p.b_id = transactions.id)
 WHERE id IN (SELECT a_id FROM mig_transfer_pairs UNION SELECT b_id FROM mig_transfer_pairs);

DROP TABLE mig_transfer_pairs;

-- 5. Old mirrored reimbursable entries -> linked transfers.
--    The app wrote the entry on the paying account first and its mirror on the
--    reimbursable account right after it, with identical date, amount, notes
--    and category. After step 3 the two amounts cancel out exactly like the
--    legs of a transfer, which is what they always meant. The category is kept:
--    it records what the money was for.
CREATE TEMP TABLE mig_mirror_pairs AS
  SELECT a.id AS a_id, b.id AS b_id
    FROM transactions a
    JOIN transactions b ON b.id = a.id + 1
    JOIN accounts aa ON aa.id = a.account_id
    JOIN accounts ab ON ab.id = b.account_id
    LEFT JOIN categories ca ON ca.id = a.category_id
   WHERE aa.type = 'standard'
     AND ab.type = 'person'
     AND a.transfer_id IS NULL
     AND b.transfer_id IS NULL
     AND a.date = b.date
     AND a.description IS b.description
     AND a.category_id IS b.category_id
     AND ABS(a.amount + b.amount) < 0.000001
     AND LOWER(COALESCE(ca.name, '')) NOT IN ('init', 'transfer');

UPDATE transactions
   SET transfer_id = (SELECT p.a_id FROM mig_mirror_pairs p
                       WHERE p.a_id = transactions.id OR p.b_id = transactions.id)
 WHERE id IN (SELECT a_id FROM mig_mirror_pairs UNION SELECT b_id FROM mig_mirror_pairs);

DROP TABLE mig_mirror_pairs;
