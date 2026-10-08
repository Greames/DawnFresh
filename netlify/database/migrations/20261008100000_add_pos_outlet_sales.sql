CREATE TABLE IF NOT EXISTS pos_outlets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  franchise_id uuid REFERENCES franchises(id),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'Active',
  address text,
  opening_time text,
  closing_time text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pos_outlets_franchise_idx ON pos_outlets(franchise_id);

CREATE TABLE IF NOT EXISTS pos_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id uuid NOT NULL REFERENCES pos_outlets(id),
  cashier_id uuid NOT NULL REFERENCES app_users(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  opening_cash numeric(16,2) NOT NULL DEFAULT 0,
  expected_cash numeric(16,2) NOT NULL DEFAULT 0,
  counted_cash numeric(16,2),
  cash_variance numeric(16,2),
  status text NOT NULL DEFAULT 'Open'
);
CREATE INDEX IF NOT EXISTS pos_shifts_outlet_status_idx ON pos_shifts(outlet_id,status);

CREATE TABLE IF NOT EXISTS pos_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id uuid NOT NULL REFERENCES pos_outlets(id),
  shift_id uuid NOT NULL REFERENCES pos_shifts(id),
  bill_number text NOT NULL UNIQUE,
  customer_id uuid REFERENCES customers(id),
  cashier_id uuid NOT NULL REFERENCES app_users(id),
  subtotal numeric(16,2) NOT NULL DEFAULT 0,
  discount numeric(16,2) NOT NULL DEFAULT 0,
  tax numeric(16,2) NOT NULL DEFAULT 0,
  total numeric(16,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'Completed',
  sold_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pos_sales_outlet_date_idx ON pos_sales(outlet_id,sold_at);
CREATE INDEX IF NOT EXISTS pos_sales_shift_idx ON pos_sales(shift_id);

CREATE TABLE IF NOT EXISTS pos_sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  product text NOT NULL,
  quantity numeric(16,3) NOT NULL,
  unit text NOT NULL DEFAULT 'kg',
  unit_price numeric(16,2) NOT NULL,
  discount numeric(16,2) NOT NULL DEFAULT 0,
  tax numeric(16,2) NOT NULL DEFAULT 0,
  total numeric(16,2) NOT NULL,
  stock_lot_id uuid REFERENCES stock_lots(id)
);
CREATE INDEX IF NOT EXISTS pos_sale_items_sale_idx ON pos_sale_items(sale_id);
CREATE INDEX IF NOT EXISTS pos_sale_items_lot_idx ON pos_sale_items(stock_lot_id);

CREATE TABLE IF NOT EXISTS pos_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  method text NOT NULL,
  amount numeric(16,2) NOT NULL,
  reference text,
  status text NOT NULL DEFAULT 'Received',
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pos_payments_sale_idx ON pos_payments(sale_id);
CREATE INDEX IF NOT EXISTS pos_payments_method_idx ON pos_payments(method);

CREATE TABLE IF NOT EXISTS pos_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES pos_sales(id),
  item_id uuid NOT NULL REFERENCES pos_sale_items(id),
  quantity numeric(16,3) NOT NULL,
  amount numeric(16,2) NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pos_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id uuid NOT NULL REFERENCES pos_outlets(id),
  shift_id uuid NOT NULL REFERENCES pos_shifts(id),
  business_date timestamptz NOT NULL,
  gross_sales numeric(16,2) NOT NULL DEFAULT 0,
  returns numeric(16,2) NOT NULL DEFAULT 0,
  discounts numeric(16,2) NOT NULL DEFAULT 0,
  tax numeric(16,2) NOT NULL DEFAULT 0,
  net_sales numeric(16,2) NOT NULL DEFAULT 0,
  cash_collected numeric(16,2) NOT NULL DEFAULT 0,
  upi_collected numeric(16,2) NOT NULL DEFAULT 0,
  card_collected numeric(16,2) NOT NULL DEFAULT 0,
  credit_sales numeric(16,2) NOT NULL DEFAULT 0,
  expected_cash numeric(16,2) NOT NULL DEFAULT 0,
  counted_cash numeric(16,2) NOT NULL DEFAULT 0,
  variance numeric(16,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'Open',
  closed_by uuid REFERENCES app_users(id),
  closed_at timestamptz
);
CREATE INDEX IF NOT EXISTS pos_reconciliation_outlet_date_idx ON pos_reconciliations(outlet_id,business_date);

CREATE TABLE IF NOT EXISTS outlet_stock_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id uuid NOT NULL REFERENCES pos_outlets(id),
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
CREATE INDEX IF NOT EXISTS outlet_stock_ledger_outlet_product_idx ON outlet_stock_ledger(outlet_id,product,created_at);
CREATE INDEX IF NOT EXISTS outlet_stock_ledger_ref_idx ON outlet_stock_ledger(reference_type,reference_id);
