-- DOM 结构化特征（meta/og/h1/canonical 等）
ALTER TABLE "CrawledUrl" ADD COLUMN IF NOT EXISTS "domFeaturesJson" JSONB;
