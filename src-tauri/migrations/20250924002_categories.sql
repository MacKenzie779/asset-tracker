-- Create categories table (case-insensitive unique names)
CREATE TABLE IF NOT EXISTS categories (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE
);

-- Add FK column to transactions (nullable)
ALTER TABLE transactions ADD COLUMN category_id INTEGER NULL
  REFERENCES categories(id) ON DELETE SET NULL;

-- Backfill unique categories from legacy text column
INSERT INTO categories(name)
SELECT DISTINCT TRIM(category) AS name
FROM transactions
WHERE category IS NOT NULL AND TRIM(category) <> ''
ON CONFLICT(name) DO NOTHING;

-- Link existing transactions to categories
UPDATE transactions
SET category_id = (
  SELECT id FROM categories c
  WHERE c.name = TRIM(transactions.category)
)
WHERE category IS NOT NULL AND TRIM(category) <> '';

-- Optional: you can clear the legacy text to avoid divergence
-- UPDATE transactions SET category = NULL;

-- Index for faster filtering/joins
CREATE INDEX IF NOT EXISTS idx_transactions_category_id
ON transactions(category_id);
