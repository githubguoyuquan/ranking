ALTER TABLE "TopicEmbedding"
  ALTER COLUMN "model" SET DEFAULT 'local-hash-embedding-v1';

-- Existing vectors came from a different algorithm. Mark them stale so the
-- application deterministically recomputes them before comparison.
UPDATE "TopicEmbedding"
SET "model" = 'legacy-remote-embedding'
WHERE "model" <> 'local-hash-embedding-v1';
