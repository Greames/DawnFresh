ALTER TABLE goods_receipts ADD COLUMN IF NOT EXISTS stock_lot_id uuid REFERENCES stock_lots(id);
CREATE INDEX IF NOT EXISTS goods_receipts_stock_lot_idx ON goods_receipts(stock_lot_id);
