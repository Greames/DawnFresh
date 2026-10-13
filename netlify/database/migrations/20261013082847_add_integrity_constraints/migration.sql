-- Hand-added: POS sales insert invoices with no order (order_id NULL) and db/schema.ts already
-- declares the column nullable, but the original CREATE TABLE made it NOT NULL.
ALTER TABLE "invoice_records" ALTER COLUMN "order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "settlement_records" ADD CONSTRAINT "settlement_records_franchise_period_unique" UNIQUE("franchise_id","period_start","period_end");--> statement-breakpoint
ALTER TABLE "pos_reconciliations" ADD CONSTRAINT "pos_reconciliations_shift_unique" UNIQUE("shift_id");--> statement-breakpoint
ALTER TABLE "franchise_stock_ledger" ADD CONSTRAINT "franchise_stock_ledger_balance_check" CHECK ("balance_after" >= 0);--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_quantities_check" CHECK ("received_quantity" >= 0 AND "accepted_quantity" >= 0 AND "rejected_quantity" >= 0 AND "accepted_quantity" <= "received_quantity");--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_paid_check" CHECK ("paid" >= 0 AND "paid" <= "total");