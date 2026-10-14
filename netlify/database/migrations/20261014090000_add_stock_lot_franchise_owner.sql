-- Stock lot ownership: NULL = company stock, otherwise the owning franchise.
ALTER TABLE stock_lots ADD COLUMN IF NOT EXISTS franchise_id uuid REFERENCES franchises(id);
CREATE INDEX IF NOT EXISTS stock_lots_franchise_idx ON stock_lots(franchise_id);
-- Lots created by franchise processing batches belong to that franchise.
UPDATE stock_lots sl
SET franchise_id = po.franchise_id
FROM processing_batches pb
JOIN production_orders po ON po.id = pb.production_order_id
WHERE sl.source_batch_id = pb.id AND po.franchise_id IS NOT NULL AND sl.franchise_id IS NULL;
