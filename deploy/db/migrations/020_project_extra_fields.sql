-- Дополнительные сведения о стройке.
ALTER TABLE project
    ADD COLUMN IF NOT EXISTS object_type TEXT,
    ADD COLUMN IF NOT EXISTS contract_number TEXT,
    ADD COLUMN IF NOT EXISTS notes TEXT;
