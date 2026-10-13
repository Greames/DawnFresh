CREATE TABLE "franchise_daily_closes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"franchise_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"status" text DEFAULT 'Closed' NOT NULL,
	"totals" jsonb NOT NULL,
	"expected_cash" numeric(16,2) DEFAULT '0' NOT NULL,
	"counted_cash" numeric(16,2) DEFAULT '0' NOT NULL,
	"cash_variance" numeric(16,2) DEFAULT '0' NOT NULL,
	"notes" text,
	"closed_by" uuid NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reopen_count" integer DEFAULT 0 NOT NULL,
	"reopened_by" uuid,
	"reopened_at" timestamp with time zone,
	"reopen_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "franchise_daily_closes_franchise_date_unique" UNIQUE("franchise_id","business_date"),
	CONSTRAINT "franchise_daily_closes_status_check" CHECK ("status" IN ('Closed', 'Reopened')),
	CONSTRAINT "franchise_daily_closes_reopen_check" CHECK ("status" = 'Closed' OR ("reopen_reason" IS NOT NULL AND length(btrim("reopen_reason")) > 0))
);
--> statement-breakpoint
ALTER TABLE "franchise_daily_closes" ADD CONSTRAINT "franchise_daily_closes_franchise_id_franchises_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchises"("id");--> statement-breakpoint
ALTER TABLE "franchise_daily_closes" ADD CONSTRAINT "franchise_daily_closes_closed_by_app_users_id_fkey" FOREIGN KEY ("closed_by") REFERENCES "app_users"("id");--> statement-breakpoint
ALTER TABLE "franchise_daily_closes" ADD CONSTRAINT "franchise_daily_closes_reopened_by_app_users_id_fkey" FOREIGN KEY ("reopened_by") REFERENCES "app_users"("id");