-- Baseline only: every table, index and foreign key in this snapshot was already
-- created by the hand-written migrations 20261006183030_add_normalized_customer_order_core
-- and 20261007090000_add_scalable_fulfilment_core. This migration records the Drizzle
-- snapshot so future `drizzle-kit generate` runs diff correctly, and changes nothing.
SELECT 1;
