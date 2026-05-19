CREATE TABLE IF NOT EXISTS ranking.metric_daily_topic
(
    `day` Date,
    `topic_id` UInt64,
    `metric_key` LowCardinality(String),
    `avg_value` Float64,
    `max_value` Float64,
    `min_value` Float64,
    `sample_count` UInt64
)
ENGINE = SummingMergeTree
PARTITION BY toYYYYMM(day)
ORDER BY (topic_id, metric_key, day);

CREATE MATERIALIZED VIEW IF NOT EXISTS ranking.mv_metric_daily_topic
TO ranking.metric_daily_topic
AS
SELECT
    toDate(ts) AS day,
    topic_id,
    metric_key,
    avg(value) AS avg_value,
    max(value) AS max_value,
    min(value) AS min_value,
    count() AS sample_count
FROM ranking.metric_timeseries
GROUP BY day, topic_id, metric_key;
