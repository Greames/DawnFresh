CREATE TABLE "app_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"email" text NOT NULL UNIQUE,
	"identity_id" text UNIQUE,
	"name" text,
	"role" text NOT NULL,
	"franchise_id" uuid,
	"permissions" jsonb DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'Active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
-- Carry existing franchise logins (bound by account id or invited email) into users & access.
INSERT INTO "app_users" ("email", "identity_id", "name", "role", "franchise_id")
SELECT "email", "user_id", "data"->>'name', 'franchisee', "id" FROM "franchises"
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "franchises" DROP COLUMN "user_id";--> statement-breakpoint
CREATE INDEX "app_users_franchise_idx" ON "app_users" ("franchise_id");--> statement-breakpoint
ALTER TABLE "app_users" ADD CONSTRAINT "app_users_franchise_id_franchises_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchises"("id");