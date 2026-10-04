CREATE TABLE "franchises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"email" text NOT NULL UNIQUE,
	"user_id" text,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operations_records" ADD COLUMN "franchise_id" uuid;--> statement-breakpoint
CREATE INDEX "operations_records_franchise_idx" ON "operations_records" ("franchise_id");--> statement-breakpoint
ALTER TABLE "operations_records" ADD CONSTRAINT "operations_records_franchise_id_franchises_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchises"("id");