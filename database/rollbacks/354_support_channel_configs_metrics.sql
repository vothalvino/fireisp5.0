-- Rollback for migration 354 — drop ai_support_metrics and support_channel_configs
DROP TABLE IF EXISTS ai_support_metrics;
DROP TABLE IF EXISTS support_channel_configs;
