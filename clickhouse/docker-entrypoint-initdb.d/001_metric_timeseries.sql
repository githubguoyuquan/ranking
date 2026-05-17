CREATE DATABASE IF NOT EXISTS ranking;

CREATE TABLE IF NOT EXISTS ranking.metric_timeseries
(
    `ts` DateTime64(3, 'UTC'),
    `topic_id` UInt64,
    `entity_id` UInt64,
    `metric_key` LowCardinality(String),
    `value` Float64,
    `source_tier` UInt8,
    `ingested_at` DateTime64(3, 'UTC'),
    `evidence_id` UUID,
    `snapshot_id` UInt64,
    `time_window` LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (topic_id, entity_id, metric_key, ts)
SETTINGS index_granularity = 8192;
