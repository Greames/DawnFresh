-- FreshRoute configurable pricing and commercial model
CREATE TABLE IF NOT EXISTS pricing_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product text NOT NULL,
  processing_type text NOT NULL DEFAULT 'Standard',
  supplier_name text NOT NULL,
  supplier_price_per_kg numeric(14,4) NOT NULL,
  standard_yield_pct numeric(7,3) NOT NULL,
  logistics_cost_per_kg numeric(14,4) NOT NULL DEFAULT 0,
  other_cost_per_kg numeric(14,4) NOT NULL DEFAULT 0,
  company_price_per_kg numeric(14,4) NOT NULL,
  franchise_id uuid REFERENCES franchises(id),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'Draft',
  notes text,
  created_by uuid REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pricing_configs_lookup_idx ON pricing_configs(product,processing_type,status,effective_from);
CREATE INDEX IF NOT EXISTS pricing_configs_franchise_idx ON pricing_configs(franchise_id);

CREATE TABLE IF NOT EXISTS pricing_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  product text NOT NULL,
  processing_type text NOT NULL DEFAULT 'Standard',
  supplier_name text NOT NULL,
  live_weight_kg numeric(14,3) NOT NULL,
  supplier_price_per_kg numeric(14,4) NOT NULL,
  standard_yield_pct numeric(7,3) NOT NULL,
  logistics_cost_per_kg numeric(14,4) NOT NULL DEFAULT 0,
  other_cost_per_kg numeric(14,4) NOT NULL DEFAULT 0,
  company_price_per_kg numeric(14,4) NOT NULL,
  billable_weight_kg numeric(14,3) NOT NULL,
  supplier_cost numeric(16,4) NOT NULL,
  landed_cost numeric(16,4) NOT NULL,
  franchise_value numeric(16,4) NOT NULL,
  gross_margin numeric(16,4) NOT NULL,
  gross_margin_pct numeric(8,3) NOT NULL,
  actual_output_kg numeric(14,3),
  actual_yield_pct numeric(7,3),
  yield_variance_pct numeric(8,3),
  created_by uuid REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pricing_scenarios_product_idx ON pricing_scenarios(product,created_at);

CREATE TABLE IF NOT EXISTS order_pricing_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES customer_orders(id) ON DELETE CASCADE,
  pricing_config_id uuid REFERENCES pricing_configs(id),
  live_weight_kg numeric(14,3) NOT NULL,
  billable_weight_kg numeric(14,3) NOT NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_pricing_snapshots_config_idx ON order_pricing_snapshots(pricing_config_id);
