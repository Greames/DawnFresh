-- Hand-added pre-flight: one open shift per outlet. Close the extras (or fix them) and redeploy if this aborts.
DO $$
DECLARE bad bigint;
BEGIN
  SELECT count(*) INTO bad FROM (SELECT outlet_id FROM pos_shifts WHERE status = 'Open' GROUP BY 1 HAVING count(*) > 1) d;
  IF bad > 0 THEN RAISE EXCEPTION '% outlet(s) have more than one open shift. Close the extra shifts and redeploy.', bad; END IF;
END $$;--> statement-breakpoint
CREATE TABLE "customer_receivables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"sale_id" uuid NOT NULL UNIQUE,
	"outlet_id" uuid NOT NULL,
	"franchise_id" uuid,
	"customer_id" uuid NOT NULL,
	"original_amount" numeric(16,2) NOT NULL,
	"returned_amount" numeric(16,2) DEFAULT '0' NOT NULL,
	"paid_amount" numeric(16,2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'Open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_receivables_amounts_check" CHECK ("original_amount" > 0 AND "returned_amount" >= 0 AND "paid_amount" >= 0 AND "returned_amount" + "paid_amount" <= "original_amount"),
	CONSTRAINT "customer_receivables_status_check" CHECK ("status" IN ('Open', 'Partially Paid', 'Paid'))
);
--> statement-breakpoint
CREATE TABLE "receivable_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"receivable_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"franchise_id" uuid,
	"shift_id" uuid NOT NULL,
	"amount" numeric(16,2) NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"received_by" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receivable_payments_amount_check" CHECK ("amount" > 0),
	CONSTRAINT "receivable_payments_method_check" CHECK ("method" IN ('Cash', 'UPI', 'Card'))
);
--> statement-breakpoint
ALTER TABLE "stock_lots" ADD COLUMN "unit_cost" numeric(16,4);--> statement-breakpoint
ALTER TABLE "pricing_configs" ADD COLUMN "customer_price_per_kg" numeric(14,2);--> statement-breakpoint
ALTER TABLE "pricing_configs" ADD COLUMN "tax_rate_pct" numeric(5,2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "outlet_stock_ledger" ADD COLUMN "unit_cost" numeric(16,4);--> statement-breakpoint
ALTER TABLE "pos_sale_items" ADD COLUMN "unit_cost" numeric(16,4);--> statement-breakpoint
CREATE INDEX "customer_receivables_franchise_status_idx" ON "customer_receivables" ("franchise_id","status");--> statement-breakpoint
CREATE INDEX "customer_receivables_customer_idx" ON "customer_receivables" ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_shifts_one_open_per_outlet" ON "pos_shifts" ("outlet_id") WHERE "status" = 'Open';--> statement-breakpoint
CREATE INDEX "receivable_payments_receivable_idx" ON "receivable_payments" ("receivable_id");--> statement-breakpoint
CREATE INDEX "receivable_payments_shift_idx" ON "receivable_payments" ("shift_id");--> statement-breakpoint
CREATE INDEX "receivable_payments_franchise_date_idx" ON "receivable_payments" ("franchise_id","received_at");--> statement-breakpoint
ALTER TABLE "customer_receivables" ADD CONSTRAINT "customer_receivables_sale_id_pos_sales_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "pos_sales"("id");--> statement-breakpoint
ALTER TABLE "customer_receivables" ADD CONSTRAINT "customer_receivables_outlet_id_pos_outlets_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "pos_outlets"("id");--> statement-breakpoint
ALTER TABLE "customer_receivables" ADD CONSTRAINT "customer_receivables_franchise_id_franchises_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchises"("id");--> statement-breakpoint
ALTER TABLE "customer_receivables" ADD CONSTRAINT "customer_receivables_customer_id_customers_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id");--> statement-breakpoint
ALTER TABLE "receivable_payments" ADD CONSTRAINT "receivable_payments_receivable_id_customer_receivables_id_fkey" FOREIGN KEY ("receivable_id") REFERENCES "customer_receivables"("id");--> statement-breakpoint
ALTER TABLE "receivable_payments" ADD CONSTRAINT "receivable_payments_outlet_id_pos_outlets_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "pos_outlets"("id");--> statement-breakpoint
ALTER TABLE "receivable_payments" ADD CONSTRAINT "receivable_payments_franchise_id_franchises_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchises"("id");--> statement-breakpoint
ALTER TABLE "receivable_payments" ADD CONSTRAINT "receivable_payments_shift_id_pos_shifts_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "pos_shifts"("id");--> statement-breakpoint
ALTER TABLE "receivable_payments" ADD CONSTRAINT "receivable_payments_received_by_app_users_id_fkey" FOREIGN KEY ("received_by") REFERENCES "app_users"("id");--> statement-breakpoint
ALTER TABLE "pricing_configs" ADD CONSTRAINT "pricing_configs_tax_rate_check" CHECK ("tax_rate_pct" >= 0 AND "tax_rate_pct" <= 100);--> statement-breakpoint
ALTER TABLE "pricing_configs" ADD CONSTRAINT "pricing_configs_customer_price_check" CHECK ("customer_price_per_kg" IS NULL OR "customer_price_per_kg" >= 0);