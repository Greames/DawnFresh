-- Hand-added pre-flight for the two uniqueness rules below.
DO $$
DECLARE bad bigint;
BEGIN
  SELECT count(*) INTO bad FROM (SELECT route_id, package_id FROM dispatch_loads GROUP BY 1, 2 HAVING count(*) > 1) d;
  IF bad > 0 THEN RAISE EXCEPTION 'dispatch_loads has % route/package pair(s) scanned more than once. Remove the duplicates and redeploy.', bad; END IF;
  SELECT count(*) INTO bad FROM (SELECT supply_request_id FROM purchase_orders WHERE status <> 'Cancelled' AND supply_request_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1) d;
  IF bad > 0 THEN RAISE EXCEPTION '% supply request(s) have more than one live purchase order. Cancel the extras and redeploy.', bad; END IF;
END $$;--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"actor_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_actor_action_key_unique" UNIQUE("actor_user_id","action","key")
);
--> statement-breakpoint
ALTER TABLE "dispatch_loads" ADD CONSTRAINT "dispatch_loads_route_package_unique" UNIQUE("route_id","package_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_supply_request_live_unique" ON "purchase_orders" ("supply_request_id") WHERE "status" <> 'Cancelled';--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_actor_user_id_app_users_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "app_users"("id");