-- 生产建议：90 天 TTL（仅新装库生效；已有表需 ALTER）
ALTER TABLE ranking.metric_timeseries
  MODIFY TTL ts + INTERVAL 90 DAY;
