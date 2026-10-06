CREATE TABLE IF NOT EXISTS "customers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "franchise_id" uuid REFERENCES "franchises"("id"),
  "source_lead_id" uuid REFERENCES "operations_records"("id"),
  "name" text NOT NULL,
  "phone" text,
  "email" text,
  "customer_type" text DEFAULT 'Business' NOT NULL,
  "status" text DEFAULT 'Active' NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "customers_franchise_idx" ON "customers" ("franchise_id");
CREATE INDEX IF NOT EXISTS "customers_phone_idx" ON "customers" ("phone");
CREATE INDEX IF NOT EXISTS "customers_source_lead_idx" ON "customers" ("source_lead_id");

CREATE TABLE IF NOT EXISTS "customer_addresses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "label" text DEFAULT 'Primary' NOT NULL,
  "address_line1" text NOT NULL,
  "address_line2" text,
  "city" text,
  "state" text,
  "postal_code" text,
  "latitude" text,
  "longitude" text,
  "is_default" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "customer_addresses_customer_idx" ON "customer_addresses" ("customer_id");

CREATE TABLE IF NOT EXISTS "customer_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id"),
  "franchise_id" uuid REFERENCES "franchises"("id"),
  "legacy_record_id" uuid UNIQUE REFERENCES "operations_records"("id"),
  "status" text NOT NULL,
  "channel" text,
  "order_date" timestamp with time zone NOT NULL,
  "subtotal" text,
  "tax" text,
  "total" text,
  "paid" text,
  "currency" text DEFAULT 'INR' NOT NULL,
  "delivery_date" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "customer_orders_customer_idx" ON "customer_orders" ("customer_id");
CREATE INDEX IF NOT EXISTS "customer_orders_franchise_status_idx" ON "customer_orders" ("franchise_id", "status");
CREATE INDEX IF NOT EXISTS "customer_orders_date_idx" ON "customer_orders" ("order_date");

CREATE TABLE IF NOT EXISTS "customer_order_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL REFERENCES "customer_orders"("id") ON DELETE CASCADE,
  "product" text NOT NULL,
  "quantity" text NOT NULL,
  "unit" text NOT NULL,
  "unit_price" text,
  "line_total" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "customer_order_items_order_idx" ON "customer_order_items" ("order_id");

CREATE TABLE IF NOT EXISTS "audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor_user_id" uuid REFERENCES "app_users"("id"),
  "franchise_id" uuid REFERENCES "franchises"("id"),
  "entity_type" text NOT NULL,
  "entity_id" uuid,
  "action" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "audit_events_entity_idx" ON "audit_events" ("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "audit_events_franchise_created_idx" ON "audit_events" ("franchise_id", "created_at");
CREATE INDEX IF NOT EXISTS "audit_events_actor_idx" ON "audit_events" ("actor_user_id", "created_at");
