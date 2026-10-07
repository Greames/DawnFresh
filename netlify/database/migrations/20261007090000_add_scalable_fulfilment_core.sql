-- FreshRoute scalable fulfilment and finance core
CREATE TABLE IF NOT EXISTS production_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES customer_orders(id),
  franchise_id uuid REFERENCES franchises(id),
  product text NOT NULL,
  requested_quantity text NOT NULL,
  unit text NOT NULL,
  status text NOT NULL DEFAULT 'Planned',
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS production_orders_order_idx ON production_orders(order_id);
CREATE INDEX IF NOT EXISTS production_orders_franchise_status_idx ON production_orders(franchise_id,status);
CREATE INDEX IF NOT EXISTS production_orders_due_idx ON production_orders(due_at);

CREATE TABLE IF NOT EXISTS processing_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id uuid REFERENCES production_orders(id),
  product text NOT NULL,
  input_quantity text NOT NULL,
  output_quantity text NOT NULL,
  waste_quantity text NOT NULL DEFAULT '0',
  unit text NOT NULL,
  status text NOT NULL DEFAULT 'Planned',
  qc_status text NOT NULL DEFAULT 'Pending',
  qc_remarks text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS processing_batches_production_idx ON processing_batches(production_order_id);
CREATE INDEX IF NOT EXISTS processing_batches_status_idx ON processing_batches(status);

CREATE TABLE IF NOT EXISTS qc_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  processing_batch_id uuid NOT NULL REFERENCES processing_batches(id) ON DELETE CASCADE,
  status text NOT NULL,
  temperature text,
  remarks text,
  checked_by uuid REFERENCES app_users(id),
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qc_checks_batch_idx ON qc_checks(processing_batch_id);

CREATE TABLE IF NOT EXISTS stock_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product text NOT NULL,
  quantity text NOT NULL,
  unit text NOT NULL,
  stage text NOT NULL DEFAULT 'Finished stock',
  source_batch_id uuid REFERENCES processing_batches(id),
  outlet_id uuid REFERENCES operations_records(id),
  batch_code text NOT NULL,
  expiry_at timestamptz,
  status text NOT NULL DEFAULT 'Available',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_lots_product_stage_idx ON stock_lots(product,stage);
CREATE INDEX IF NOT EXISTS stock_lots_batch_code_idx ON stock_lots(batch_code);
CREATE INDEX IF NOT EXISTS stock_lots_expiry_idx ON stock_lots(expiry_at);

CREATE TABLE IF NOT EXISTS packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES customer_orders(id),
  package_code text NOT NULL UNIQUE,
  product text NOT NULL,
  quantity text NOT NULL,
  unit text NOT NULL,
  status text NOT NULL DEFAULT 'Packed',
  packed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS packages_order_idx ON packages(order_id);
CREATE INDEX IF NOT EXISTS packages_status_idx ON packages(status);

CREATE TABLE IF NOT EXISTS package_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  stock_lot_id uuid REFERENCES stock_lots(id),
  quantity text NOT NULL,
  unit text NOT NULL
);
CREATE INDEX IF NOT EXISTS package_items_package_idx ON package_items(package_id);

CREATE TABLE IF NOT EXISTS labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  printed_at timestamptz,
  print_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS labels_package_idx ON labels(package_id);

CREATE TABLE IF NOT EXISTS drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL,
  status text NOT NULL DEFAULT 'Available',
  franchise_id uuid REFERENCES franchises(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS drivers_franchise_status_idx ON drivers(franchise_id,status);

CREATE TABLE IF NOT EXISTS vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_number text NOT NULL UNIQUE,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'Available',
  franchise_id uuid REFERENCES franchises(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vehicles_franchise_status_idx ON vehicles(franchise_id,status);

CREATE TABLE IF NOT EXISTS delivery_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  franchise_id uuid REFERENCES franchises(id),
  route_date timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'Planned',
  driver_id uuid REFERENCES drivers(id),
  vehicle_id uuid REFERENCES vehicles(id),
  route_code text NOT NULL UNIQUE,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS delivery_routes_date_status_idx ON delivery_routes(route_date,status);
CREATE INDEX IF NOT EXISTS delivery_routes_franchise_idx ON delivery_routes(franchise_id);

CREATE TABLE IF NOT EXISTS delivery_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES delivery_routes(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES customer_orders(id),
  sequence integer NOT NULL,
  status text NOT NULL DEFAULT 'Planned',
  address_id uuid REFERENCES customer_addresses(id),
  latitude text,
  longitude text,
  delivery_window text,
  delivered_at timestamptz,
  failure_reason text
);
CREATE INDEX IF NOT EXISTS delivery_stops_route_sequence_idx ON delivery_stops(route_id,sequence);
CREATE INDEX IF NOT EXISTS delivery_stops_order_idx ON delivery_stops(order_id);

CREATE TABLE IF NOT EXISTS dispatch_loads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES delivery_routes(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES packages(id),
  scanned_at timestamptz NOT NULL DEFAULT now(),
  scanned_by uuid REFERENCES app_users(id),
  status text NOT NULL DEFAULT 'Loaded'
);
CREATE INDEX IF NOT EXISTS dispatch_loads_route_idx ON dispatch_loads(route_id);
CREATE INDEX IF NOT EXISTS dispatch_loads_package_idx ON dispatch_loads(package_id);

CREATE TABLE IF NOT EXISTS proof_of_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stop_id uuid NOT NULL UNIQUE REFERENCES delivery_stops(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'Delivered',
  recipient_name text,
  notes text,
  photo_url text,
  signature_ref text,
  delivered_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoice_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES customer_orders(id),
  invoice_number text NOT NULL UNIQUE,
  subtotal text NOT NULL DEFAULT '0',
  tax text NOT NULL DEFAULT '0',
  total text NOT NULL DEFAULT '0',
  paid text NOT NULL DEFAULT '0',
  status text NOT NULL DEFAULT 'Draft',
  issued_at timestamptz,
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoice_records_order_idx ON invoice_records(order_id);
CREATE INDEX IF NOT EXISTS invoice_records_status_idx ON invoice_records(status);

CREATE TABLE IF NOT EXISTS payment_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES customer_orders(id),
  invoice_id uuid REFERENCES invoice_records(id),
  amount text NOT NULL,
  method text NOT NULL,
  reference text,
  status text NOT NULL DEFAULT 'Received',
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_records_order_idx ON payment_records(order_id);
CREATE INDEX IF NOT EXISTS payment_records_invoice_idx ON payment_records(invoice_id);

CREATE TABLE IF NOT EXISTS settlement_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  franchise_id uuid NOT NULL REFERENCES franchises(id),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  gross_sales text NOT NULL DEFAULT '0',
  collections text NOT NULL DEFAULT '0',
  adjustments text NOT NULL DEFAULT '0',
  amount_due text NOT NULL DEFAULT '0',
  status text NOT NULL DEFAULT 'Open',
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS settlement_records_franchise_period_idx ON settlement_records(franchise_id,period_start);
