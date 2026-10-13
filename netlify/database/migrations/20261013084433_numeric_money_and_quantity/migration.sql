-- Hand-added: the pre-flight below, and DROP DEFAULT / SET DEFAULT 0 around the conversion of columns that had a
-- text default ('0'), which Postgres cannot cast automatically. The generated ALTER ... USING statements are unchanged.
-- The migration aborts, rolling
-- everything back, with a message that names the offending table and column instead of failing on the
-- first bad cast, or on a CHECK constraint that existing rows would violate.
DO $$
DECLARE
  target record;
  bad bigint;
  problems text := '';
BEGIN
  FOR target IN SELECT * FROM (VALUES
    ('customer_order_items','quantity'),('customer_order_items','unit_price'),('customer_order_items','line_total'),
    ('customer_orders','subtotal'),('customer_orders','tax'),('customer_orders','total'),('customer_orders','paid'),
    ('invoice_records','subtotal'),('invoice_records','tax'),('invoice_records','total'),('invoice_records','paid'),
    ('package_items','quantity'),('packages','quantity'),('payment_records','amount'),
    ('processing_batches','input_quantity'),('processing_batches','output_quantity'),('processing_batches','waste_quantity'),
    ('production_orders','requested_quantity'),
    ('settlement_records','gross_sales'),('settlement_records','collections'),('settlement_records','adjustments'),('settlement_records','amount_due'),
    ('stock_lots','quantity')
  ) AS t(tbl, col) LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE %I IS NOT NULL AND %I !~ %L', target.tbl, target.col, target.col, '^\s*-?[0-9]+(\.[0-9]+)?\s*$') INTO bad;
    IF bad > 0 THEN problems := problems || format('%s.%s has %s non-numeric value(s); ', target.tbl, target.col, bad); END IF;
  END LOOP;
  IF problems <> '' THEN RAISE EXCEPTION 'Numeric conversion pre-flight failed: %Fix or null these values and redeploy.', problems; END IF;

  SELECT count(*) INTO bad FROM stock_lots WHERE quantity::numeric < 0;
  IF bad > 0 THEN problems := problems || format('stock_lots has %s negative quantity row(s); ', bad); END IF;
  SELECT count(*) INTO bad FROM invoice_records WHERE paid::numeric < 0 OR paid::numeric > total::numeric;
  IF bad > 0 THEN problems := problems || format('invoice_records has %s row(s) with paid < 0 or paid > total; ', bad); END IF;
  SELECT count(*) INTO bad FROM customer_orders WHERE paid::numeric < 0 OR paid::numeric > total::numeric;
  IF bad > 0 THEN problems := problems || format('customer_orders has %s row(s) with paid < 0 or paid > total; ', bad); END IF;
  SELECT count(*) INTO bad FROM outlet_stock_ledger WHERE balance_after < 0;
  IF bad > 0 THEN problems := problems || format('outlet_stock_ledger has %s negative balance_after row(s) (earlier allowNegativeStock sales); ', bad); END IF;
  IF problems <> '' THEN RAISE EXCEPTION 'Constraint pre-flight failed: %Correct these rows and redeploy.', problems; END IF;
END $$;--> statement-breakpoint
ALTER TABLE "customer_order_items" ALTER COLUMN "quantity" SET DATA TYPE numeric(16,3) USING "quantity"::numeric(16,3);--> statement-breakpoint
ALTER TABLE "customer_order_items" ALTER COLUMN "unit_price" SET DATA TYPE numeric(16,2) USING "unit_price"::numeric(16,2);--> statement-breakpoint
ALTER TABLE "customer_order_items" ALTER COLUMN "line_total" SET DATA TYPE numeric(16,2) USING "line_total"::numeric(16,2);--> statement-breakpoint
ALTER TABLE "customer_orders" ALTER COLUMN "subtotal" SET DATA TYPE numeric(16,2) USING "subtotal"::numeric(16,2);--> statement-breakpoint
ALTER TABLE "customer_orders" ALTER COLUMN "tax" SET DATA TYPE numeric(16,2) USING "tax"::numeric(16,2);--> statement-breakpoint
ALTER TABLE "customer_orders" ALTER COLUMN "total" SET DATA TYPE numeric(16,2) USING "total"::numeric(16,2);--> statement-breakpoint
ALTER TABLE "customer_orders" ALTER COLUMN "paid" SET DATA TYPE numeric(16,2) USING "paid"::numeric(16,2);--> statement-breakpoint
ALTER TABLE "invoice_records" ALTER COLUMN "subtotal" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "invoice_records" ALTER COLUMN "subtotal" SET DATA TYPE numeric(16,2) USING "subtotal"::numeric(16,2);--> statement-breakpoint
ALTER TABLE "invoice_records" ALTER COLUMN "subtotal" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "invoice_records" ALTER COLUMN "tax" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "invoice_records" ALTER COLUMN "tax" SET DATA TYPE numeric(16,2) USING "tax"::numeric(16,2);--> statement-breakpoint
ALTER TABLE "invoice_records" ALTER COLUMN "tax" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "invoice_records" ALTER COLUMN "total" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "invoice_records" ALTER COLUMN "total" SET DATA TYPE numeric(16,2) USING "total"::numeric(16,2);--> statement-breakpoint
ALTER TABLE "invoice_records" ALTER COLUMN "total" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "invoice_records" ALTER COLUMN "paid" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "invoice_records" ALTER COLUMN "paid" SET DATA TYPE numeric(16,2) USING "paid"::numeric(16,2);--> statement-breakpoint
ALTER TABLE "invoice_records" ALTER COLUMN "paid" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "package_items" ALTER COLUMN "quantity" SET DATA TYPE numeric(16,3) USING "quantity"::numeric(16,3);--> statement-breakpoint
ALTER TABLE "packages" ALTER COLUMN "quantity" SET DATA TYPE numeric(16,3) USING "quantity"::numeric(16,3);--> statement-breakpoint
ALTER TABLE "payment_records" ALTER COLUMN "amount" SET DATA TYPE numeric(16,2) USING "amount"::numeric(16,2);--> statement-breakpoint
ALTER TABLE "processing_batches" ALTER COLUMN "input_quantity" SET DATA TYPE numeric(16,3) USING "input_quantity"::numeric(16,3);--> statement-breakpoint
ALTER TABLE "processing_batches" ALTER COLUMN "output_quantity" SET DATA TYPE numeric(16,3) USING "output_quantity"::numeric(16,3);--> statement-breakpoint
ALTER TABLE "processing_batches" ALTER COLUMN "waste_quantity" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "processing_batches" ALTER COLUMN "waste_quantity" SET DATA TYPE numeric(16,3) USING "waste_quantity"::numeric(16,3);--> statement-breakpoint
ALTER TABLE "processing_batches" ALTER COLUMN "waste_quantity" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "production_orders" ALTER COLUMN "requested_quantity" SET DATA TYPE numeric(16,3) USING "requested_quantity"::numeric(16,3);--> statement-breakpoint
ALTER TABLE "settlement_records" ALTER COLUMN "gross_sales" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "settlement_records" ALTER COLUMN "gross_sales" SET DATA TYPE numeric(16,2) USING "gross_sales"::numeric(16,2);--> statement-breakpoint
ALTER TABLE "settlement_records" ALTER COLUMN "gross_sales" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "settlement_records" ALTER COLUMN "collections" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "settlement_records" ALTER COLUMN "collections" SET DATA TYPE numeric(16,2) USING "collections"::numeric(16,2);--> statement-breakpoint
ALTER TABLE "settlement_records" ALTER COLUMN "collections" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "settlement_records" ALTER COLUMN "adjustments" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "settlement_records" ALTER COLUMN "adjustments" SET DATA TYPE numeric(16,2) USING "adjustments"::numeric(16,2);--> statement-breakpoint
ALTER TABLE "settlement_records" ALTER COLUMN "adjustments" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "settlement_records" ALTER COLUMN "amount_due" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "settlement_records" ALTER COLUMN "amount_due" SET DATA TYPE numeric(16,2) USING "amount_due"::numeric(16,2);--> statement-breakpoint
ALTER TABLE "settlement_records" ALTER COLUMN "amount_due" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "stock_lots" ALTER COLUMN "quantity" SET DATA TYPE numeric(16,3) USING "quantity"::numeric(16,3);--> statement-breakpoint
ALTER TABLE "customer_orders" ADD CONSTRAINT "customer_orders_paid_check" CHECK ("paid" >= 0 AND "paid" <= "total");--> statement-breakpoint
ALTER TABLE "invoice_records" ADD CONSTRAINT "invoice_records_paid_check" CHECK ("paid" >= 0 AND "paid" <= "total");--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_quantity_check" CHECK ("quantity" >= 0);--> statement-breakpoint
ALTER TABLE "outlet_stock_ledger" ADD CONSTRAINT "outlet_stock_ledger_balance_check" CHECK ("balance_after" >= 0);