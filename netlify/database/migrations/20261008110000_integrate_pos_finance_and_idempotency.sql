ALTER TABLE payment_records ALTER COLUMN order_id DROP NOT NULL;

ALTER TABLE pos_sales ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS pos_sales_idempotency_key_idx ON pos_sales(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_records_pos_sale_idx ON payment_records(pos_sale_id);
