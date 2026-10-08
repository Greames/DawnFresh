ALTER TABLE invoice_records ADD COLUMN IF NOT EXISTS pos_sale_id uuid;
ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS pos_sale_id uuid;
CREATE INDEX IF NOT EXISTS invoice_records_pos_sale_idx ON invoice_records(pos_sale_id);
CREATE INDEX IF NOT EXISTS payment_records_pos_sale_idx ON payment_records(pos_sale_id);
