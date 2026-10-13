-- Hand-added pre-flight: the new movement CHECK must hold for every existing outlet ledger row.
DO $$
DECLARE bad bigint;
BEGIN
  SELECT count(*) INTO bad FROM outlet_stock_ledger WHERE NOT ((movement_type IN ('SupplyIn', 'TransferIn', 'Return') AND quantity > 0) OR (movement_type IN ('Sale', 'Wastage') AND quantity < 0) OR (movement_type IN ('Adjustment', 'Count') AND quantity <> 0));
  IF bad > 0 THEN RAISE EXCEPTION 'outlet_stock_ledger has % row(s) with an unknown movement type or a quantity sign that does not match it. Correct them and redeploy.', bad; END IF;
END $$;--> statement-breakpoint
CREATE TABLE "stock_balances" (
	"outlet_id" uuid,
	"product" text,
	"quantity" numeric(16,3) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_balances_pkey" PRIMARY KEY("outlet_id","product"),
	CONSTRAINT "stock_balances_quantity_check" CHECK ("quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"outlet_id" uuid NOT NULL,
	"franchise_id" uuid,
	"product" text NOT NULL,
	"stock_lot_id" uuid,
	"system_quantity" numeric(16,3) NOT NULL,
	"counted_quantity" numeric(16,3) NOT NULL,
	"variance" numeric(16,3) NOT NULL,
	"reason" text,
	"counted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_counts_quantities_check" CHECK ("counted_quantity" >= 0 AND "system_quantity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "stock_lots" ADD COLUMN "franchise_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD COLUMN "pos_outlet_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD COLUMN "parent_lot_id" uuid;--> statement-breakpoint
ALTER TABLE "outlet_stock_ledger" ADD COLUMN "seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "outlet_stock_ledger_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
ALTER TABLE "outlet_stock_ledger" ADD COLUMN "franchise_id" uuid;--> statement-breakpoint
ALTER TABLE "outlet_stock_ledger" ADD COLUMN "sale_id" uuid;--> statement-breakpoint
ALTER TABLE "outlet_stock_ledger" ADD COLUMN "supply_request_id" uuid;--> statement-breakpoint
ALTER TABLE "outlet_stock_ledger" ADD COLUMN "purchase_order_id" uuid;--> statement-breakpoint
ALTER TABLE "outlet_stock_ledger" ADD COLUMN "goods_receipt_id" uuid;--> statement-breakpoint
ALTER TABLE "outlet_stock_ledger" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "pos_returns" ADD COLUMN "disposition" text DEFAULT 'Restock' NOT NULL;--> statement-breakpoint
CREATE INDEX "stock_lots_outlet_product_idx" ON "stock_lots" ("pos_outlet_id","product");--> statement-breakpoint
CREATE INDEX "stock_lots_franchise_idx" ON "stock_lots" ("franchise_id");--> statement-breakpoint
CREATE INDEX "outlet_stock_ledger_supply_request_idx" ON "outlet_stock_ledger" ("supply_request_id");--> statement-breakpoint
CREATE INDEX "outlet_stock_ledger_lot_idx" ON "outlet_stock_ledger" ("stock_lot_id");--> statement-breakpoint
CREATE INDEX "stock_counts_outlet_product_idx" ON "stock_counts" ("outlet_id","product","created_at");--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_franchise_id_franchises_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchises"("id");--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_pos_outlet_id_pos_outlets_id_fkey" FOREIGN KEY ("pos_outlet_id") REFERENCES "pos_outlets"("id");--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_parent_lot_id_stock_lots_id_fkey" FOREIGN KEY ("parent_lot_id") REFERENCES "stock_lots"("id");--> statement-breakpoint
ALTER TABLE "outlet_stock_ledger" ADD CONSTRAINT "outlet_stock_ledger_franchise_id_franchises_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchises"("id");--> statement-breakpoint
ALTER TABLE "outlet_stock_ledger" ADD CONSTRAINT "outlet_stock_ledger_sale_id_pos_sales_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "pos_sales"("id");--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_outlet_id_pos_outlets_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "pos_outlets"("id");--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_outlet_id_pos_outlets_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "pos_outlets"("id");--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_franchise_id_franchises_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchises"("id");--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_stock_lot_id_stock_lots_id_fkey" FOREIGN KEY ("stock_lot_id") REFERENCES "stock_lots"("id");--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_counted_by_app_users_id_fkey" FOREIGN KEY ("counted_by") REFERENCES "app_users"("id");--> statement-breakpoint
ALTER TABLE "outlet_stock_ledger" ADD CONSTRAINT "outlet_stock_ledger_movement_check" CHECK (("movement_type" IN ('SupplyIn', 'TransferIn', 'Return') AND "quantity" > 0) OR ("movement_type" IN ('Sale', 'Wastage') AND "quantity" < 0) OR ("movement_type" IN ('Adjustment', 'Count') AND "quantity" <> 0));--> statement-breakpoint
ALTER TABLE "pos_returns" ADD CONSTRAINT "pos_returns_disposition_check" CHECK ("disposition" IN ('Restock', 'Wastage'));
--> statement-breakpoint
-- Hand-added backfill. Lots made from a franchise's own production orders belong to that franchise.
UPDATE "stock_lots" l SET "franchise_id" = po."franchise_id" FROM "processing_batches" pb JOIN "production_orders" po ON po."id" = pb."production_order_id" WHERE l."source_batch_id" = pb."id" AND po."franchise_id" IS NOT NULL;--> statement-breakpoint
UPDATE "outlet_stock_ledger" l SET "franchise_id" = o."franchise_id" FROM "pos_outlets" o WHERE o."id" = l."outlet_id";--> statement-breakpoint
-- Balances are the arithmetic sum of signed ledger quantities (the previous balance_after values were read from
-- an unordered "latest row", which is ambiguous inside one transaction). Negative sums cannot exist (pre-flight
-- in the previous migration) but are clamped defensively.
INSERT INTO "stock_balances" ("outlet_id", "product", "quantity") SELECT "outlet_id", "product", GREATEST(SUM("quantity"), 0) FROM "outlet_stock_ledger" GROUP BY "outlet_id", "product";--> statement-breakpoint
-- Existing outlet stock had no lot at the outlet (transfers drew down company lots). Give each non-empty
-- outlet/product one opening lot so the balance equals the sum of that outlet's lots from now on.
INSERT INTO "stock_lots" ("product", "quantity", "unit", "stage", "batch_code", "status", "franchise_id", "pos_outlet_id") SELECT b."product", b."quantity", 'kg', 'Finished stock', 'OPENING-' || substr(b."outlet_id"::text, 1, 8), 'Available', o."franchise_id", b."outlet_id" FROM "stock_balances" b JOIN "pos_outlets" o ON o."id" = b."outlet_id" WHERE b."quantity" > 0;
