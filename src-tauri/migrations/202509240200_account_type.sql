-- Add account type; default to 'standard'
ALTER TABLE accounts ADD COLUMN type TEXT NOT NULL DEFAULT 'standard';
