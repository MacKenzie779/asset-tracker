-- Extra fields for Home table columns
ALTER TABLE transactions ADD COLUMN category TEXT;
ALTER TABLE transactions ADD COLUMN reimbursement_account_id INTEGER; -- optional FK to accounts(id)
