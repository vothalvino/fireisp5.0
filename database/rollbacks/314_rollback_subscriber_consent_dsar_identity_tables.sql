-- Rollback 314: §16.2 User Data Management tables
DROP TABLE IF EXISTS identity_verification_records;
DROP TABLE IF EXISTS dsar_requests;
DROP TABLE IF EXISTS subscriber_consents;
