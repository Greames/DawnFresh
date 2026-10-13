-- Hand-added pre-flight: every existing settlement must have a status the new CHECK allows.
DO $$
DECLARE bad bigint;
BEGIN
  SELECT count(*) INTO bad FROM settlement_records WHERE status NOT IN ('Open', 'Partially Settled', 'Settled');
  IF bad > 0 THEN RAISE EXCEPTION '% settlement_records row(s) have a status other than Open / Partially Settled / Settled. Fix them and redeploy.', bad; END IF;
  SELECT count(*) INTO bad FROM settlement_records WHERE period_end < period_start;
  IF bad > 0 THEN RAISE EXCEPTION '% settlement_records row(s) end before they start. Fix them and redeploy.', bad; END IF;
END $$;--> statement-breakpoint
CREATE TABLE "settlement_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"settlement_id" uuid NOT NULL,
	"franchise_id" uuid NOT NULL,
	"amount" numeric(16,2) NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_adjustments_amount_check" CHECK ("amount" <> 0),
	CONSTRAINT "settlement_adjustments_reason_check" CHECK (length(btrim("reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "settlement_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"settlement_id" uuid NOT NULL,
	"franchise_id" uuid NOT NULL,
	"amount" numeric(16,2) NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"recorded_by" uuid NOT NULL,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_payments_amount_check" CHECK ("amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "settlement_records" ADD COLUMN "period_start_date" date;--> statement-breakpoint
ALTER TABLE "settlement_records" ADD COLUMN "period_end_date" date;--> statement-breakpoint
ALTER TABLE "settlement_records" ADD COLUMN "supply_value" numeric(16,2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "settlement_records" ADD COLUMN "returns_value" numeric(16,2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "settlement_records" ADD COLUMN "payments_total" numeric(16,2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "settlement_records" ADD COLUMN "derived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "settlement_records" ADD COLUMN "created_by" uuid;--> statement-breakpoint
-- Hand-added backfill: legacy rows get their IST business dates so they take part in the overlap rule. They stay derived = false (read-only).
UPDATE "settlement_records" SET "period_start_date" = ("period_start" AT TIME ZONE 'Asia/Kolkata')::date, "period_end_date" = ("period_end" AT TIME ZONE 'Asia/Kolkata')::date;--> statement-breakpoint
CREATE INDEX "settlement_adjustments_settlement_idx" ON "settlement_adjustments" ("settlement_id");--> statement-breakpoint
CREATE INDEX "settlement_payments_settlement_idx" ON "settlement_payments" ("settlement_id");--> statement-breakpoint
ALTER TABLE "settlement_adjustments" ADD CONSTRAINT "settlement_adjustments_settlement_id_settlement_records_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlement_records"("id");--> statement-breakpoint
ALTER TABLE "settlement_adjustments" ADD CONSTRAINT "settlement_adjustments_franchise_id_franchises_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchises"("id");--> statement-breakpoint
ALTER TABLE "settlement_adjustments" ADD CONSTRAINT "settlement_adjustments_created_by_app_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "app_users"("id");--> statement-breakpoint
ALTER TABLE "settlement_payments" ADD CONSTRAINT "settlement_payments_settlement_id_settlement_records_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlement_records"("id");--> statement-breakpoint
ALTER TABLE "settlement_payments" ADD CONSTRAINT "settlement_payments_franchise_id_franchises_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchises"("id");--> statement-breakpoint
ALTER TABLE "settlement_payments" ADD CONSTRAINT "settlement_payments_recorded_by_app_users_id_fkey" FOREIGN KEY ("recorded_by") REFERENCES "app_users"("id");--> statement-breakpoint
ALTER TABLE "settlement_records" ADD CONSTRAINT "settlement_records_created_by_app_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "app_users"("id");--> statement-breakpoint
ALTER TABLE "settlement_records" ADD CONSTRAINT "settlement_records_status_check" CHECK ("status" IN ('Open', 'Partially Settled', 'Settled'));--> statement-breakpoint
ALTER TABLE "settlement_records" ADD CONSTRAINT "settlement_records_payments_check" CHECK ("payments_total" >= 0 AND ("derived" = false OR "payments_total" <= "amount_due"));--> statement-breakpoint
ALTER TABLE "settlement_records" ADD CONSTRAINT "settlement_records_dates_check" CHECK ("period_start_date" IS NULL OR "period_end_date" >= "period_start_date");--> statement-breakpoint
ALTER TABLE "outlet_stock_ledger" DROP CONSTRAINT "outlet_stock_ledger_movement_check", ADD CONSTRAINT "outlet_stock_ledger_movement_check" CHECK (("movement_type" IN ('SupplyIn', 'TransferIn', 'Return') AND "quantity" > 0) OR ("movement_type" IN ('Sale', 'Wastage', 'SupplyReturn') AND "quantity" < 0) OR ("movement_type" IN ('Adjustment', 'Count') AND "quantity" <> 0));