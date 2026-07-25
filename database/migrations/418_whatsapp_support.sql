-- =============================================================================
-- Migration 418 — WhatsApp customer-support foundation (identity + binding)
-- =============================================================================
-- Adds the identity layer that lets an inbound WhatsApp message be tied to a
-- FireISP client safely. See docs/whatsapp-support-design.md for the full model.
--
-- Three tables:
--   whatsapp_links          — the binding phone_e164 -> client. At most ONE
--                             ACTIVE binding per phone number install-wide,
--                             because the inbound webhook is a single endpoint
--                             with no org context: a sender number must resolve
--                             to exactly one client. Enforced by a UNIQUE on the
--                             VIRTUAL generated column active_phone (= phone_e164
--                             while status='active', else NULL so revoked rows
--                             don't collide). VIRTUAL — not STORED — because a
--                             STORED generated column cannot be indexed UNIQUE
--                             safely across the revoke/rebind churn, and (as
--                             migration 417 hit) STORED columns bring extra FK
--                             restrictions we don't need here.
--   whatsapp_verifications  — short-lived linking/step-up codes. Only the
--                             sha256 hash is stored (same discipline as
--                             clients.portal_reset_token_hash) — never plaintext.
--                             phone_e164 is NULL for portal-minted codes (the
--                             phone is unknown until the client texts the code).
--   whatsapp_inbound_messages — inbound audit + idempotency. UNIQUE(provider,
--                             provider_message_id) dedups provider redeliveries.
--
-- No new permission slugs: the webhook is public (authenticated by provider
-- signature, not JWT) and the portal endpoints reuse portalAuthenticate. A
-- staff-facing "manage a client's WhatsApp links" UI is a later phase and will
-- seed its own permission then.
-- =============================================================================

CREATE TABLE IF NOT EXISTS whatsapp_links (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL     COMMENT 'Org of the bound client; NULL = single-tenant. Data only — inbound resolution is by phone, install-wide.',
    client_id       BIGINT UNSIGNED NOT NULL,
    phone_e164      VARCHAR(20)     NOT NULL  COMMENT 'Normalized E.164, e.g. +5215512345678',
    bound_via       ENUM('portal', 'email_otp', 'staff') NOT NULL,
    status          ENUM('active', 'revoked') NOT NULL DEFAULT 'active',
    active_phone    VARCHAR(20)     AS (CASE WHEN status = 'active' THEN phone_e164 ELSE NULL END) VIRTUAL
                                    COMMENT 'phone_e164 while active, else NULL — powers the one-active-binding-per-phone UNIQUE without blocking revoked history',
    bound_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at    DATETIME        NULL     COMMENT 'Last inbound message from this bound number',
    revoked_at      DATETIME        NULL,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_whatsapp_links_active_phone (active_phone),
    KEY idx_whatsapp_links_client (client_id),
    KEY idx_whatsapp_links_phone (phone_e164),
    CONSTRAINT fk_whatsapp_links_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    CONSTRAINT fk_whatsapp_links_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='WhatsApp number -> client binding (migration 418). One active binding per phone install-wide.';

CREATE TABLE IF NOT EXISTS whatsapp_verifications (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL,
    phone_e164      VARCHAR(20)     NULL     COMMENT 'Target phone; NULL for portal-minted codes (phone unknown until the client texts it)',
    purpose         ENUM('link_portal', 'link_email', 'stepup') NOT NULL,
    client_id       BIGINT UNSIGNED NULL     COMMENT 'Resolved target client (known at mint time for portal codes / after email match)',
    code_hash       CHAR(64)        NOT NULL COMMENT 'sha256(code + server pepper) hex — NEVER the plaintext code',
    channel         ENUM('email', 'portal') NOT NULL COMMENT 'Where the code was delivered',
    expires_at      DATETIME        NOT NULL,
    consumed_at     DATETIME        NULL,
    attempts        INT             NOT NULL DEFAULT 0 COMMENT 'Wrong-code attempts against this row',
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_wa_verif_phone_purpose (phone_e164, purpose, consumed_at),
    KEY idx_wa_verif_purpose_codehash (purpose, code_hash),
    KEY idx_wa_verif_expires (expires_at),
    CONSTRAINT fk_wa_verif_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    CONSTRAINT fk_wa_verif_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Short-lived WhatsApp linking / step-up codes (migration 418) — hashed, single-use, expiring.';

CREATE TABLE IF NOT EXISTS whatsapp_inbound_messages (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL COMMENT 'Resolved once the sender is bound',
    client_id           BIGINT UNSIGNED NULL,
    provider            VARCHAR(20)     NOT NULL COMMENT 'twilio | meta',
    provider_message_id VARCHAR(255)    NOT NULL,
    phone_e164          VARCHAR(20)     NOT NULL,
    to_number           VARCHAR(40)     NULL COMMENT 'Business number that received the message — reserved for future per-org routing',
    body                TEXT            NULL,
    received_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_wa_inbound_provider_msg (provider, provider_message_id),
    KEY idx_wa_inbound_phone (phone_e164),
    KEY idx_wa_inbound_received (received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Inbound WhatsApp message audit + dedup (migration 418).';
