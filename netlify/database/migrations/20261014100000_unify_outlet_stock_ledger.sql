-- Unified stock model: one ledger per franchise outlet (outlet_stock_ledger).
-- Hand-written in the style of the preceding migrations.
-- Supply receipts credit outlet_stock_ledger with supply request / PO / GRN references.
-- franchise_stock_ledger is retired as an inflow-only legacy table: kept for history, no longer written.
ALTER TABLE outlet_stock_ledger ADD COLUMN IF NOT EXISTS supply_request_id uuid REFERENCES operations_records(id);
ALTER TABLE outlet_stock_ledger ADD COLUMN IF NOT EXISTS purchase_order_id uuid;
ALTER TABLE outlet_stock_ledger ADD COLUMN IF NOT EXISTS goods_receipt_id uuid;
ALTER TABLE outlet_stock_ledger ADD COLUMN IF NOT EXISTS transfer_group_id uuid;
ALTER TABLE outlet_stock_ledger ADD COLUMN IF NOT EXISTS reason text;
CREATE INDEX IF NOT EXISTS outlet_stock_ledger_lot_idx ON outlet_stock_ledger(outlet_id,product,stock_lot_id);
CREATE INDEX IF NOT EXISTS outlet_stock_ledger_supply_request_idx ON outlet_stock_ledger(supply_request_id);
CREATE INDEX IF NOT EXISTS outlet_stock_ledger_transfer_idx ON outlet_stock_ledger(transfer_group_id);
-- Sale returns choose between restocking and writing the goods off.
ALTER TABLE pos_returns ADD COLUMN IF NOT EXISTS disposition text NOT NULL DEFAULT 'Restock';
