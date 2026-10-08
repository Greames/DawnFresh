CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  email text,
  status text NOT NULL DEFAULT 'Active',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS suppliers_status_idx ON suppliers(status);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  product text NOT NULL,
  quantity numeric(16,3) NOT NULL,
  unit text NOT NULL,
  unit_price numeric(16,2) NOT NULL,
  total numeric(16,2) NOT NULL,
  status text NOT NULL DEFAULT 'Draft',
  ordered_at timestamptz NOT NULL DEFAULT now(),
  expected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_orders_supplier_status_idx ON purchase_orders(supplier_id,status);

CREATE TABLE IF NOT EXISTS goods_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id),
  received_quantity numeric(16,3) NOT NULL,
  accepted_quantity numeric(16,3) NOT NULL,
  rejected_quantity numeric(16,3) NOT NULL DEFAULT 0,
  unit text NOT NULL,
  qc_status text NOT NULL DEFAULT 'Pending',
  batch_code text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  received_by uuid REFERENCES app_users(id)
);
CREATE INDEX IF NOT EXISTS goods_receipts_po_idx ON goods_receipts(purchase_order_id);

CREATE TABLE IF NOT EXISTS supplier_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  purchase_order_id uuid REFERENCES purchase_orders(id),
  invoice_number text NOT NULL UNIQUE,
  total numeric(16,2) NOT NULL,
  paid numeric(16,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'Issued',
  issued_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz
);
CREATE INDEX IF NOT EXISTS supplier_invoices_supplier_status_idx ON supplier_invoices(supplier_id,status);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_invoice_id uuid NOT NULL REFERENCES supplier_invoices(id),
  amount numeric(16,2) NOT NULL,
  method text NOT NULL,
  reference text,
  status text NOT NULL DEFAULT 'Paid',
  paid_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS supplier_payments_invoice_idx ON supplier_payments(supplier_invoice_id);

CREATE TABLE IF NOT EXISTS franchise_stock_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  franchise_id uuid NOT NULL REFERENCES franchises(id),
  product text NOT NULL,
  stock_lot_id uuid REFERENCES stock_lots(id),
  movement_type text NOT NULL,
  quantity numeric(16,3) NOT NULL,
  reference_type text,
  reference_id uuid,
  balance_after numeric(16,3) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app_users(id)
);
CREATE INDEX IF NOT EXISTS franchise_stock_ledger_franchise_product_idx ON franchise_stock_ledger(franchise_id,product,created_at);
CREATE INDEX IF NOT EXISTS franchise_stock_ledger_ref_idx ON franchise_stock_ledger(reference_type,reference_id);
