-- Migration: 160_add_portal_credentials_to_clients
-- Description: Adds portal_password_hash and portal_login_attempts /
--              portal_locked_until to clients so they can authenticate
--              against the self-service portal independently of staff accounts.

ALTER TABLE clients
  ADD COLUMN portal_password_hash       VARCHAR(255) NULL      COMMENT 'bcrypt hash for self-service portal password; NULL = portal access not enabled',
  ADD COLUMN portal_login_attempts      TINYINT      NOT NULL DEFAULT 0,
  ADD COLUMN portal_locked_until        TIMESTAMP    NULL;
