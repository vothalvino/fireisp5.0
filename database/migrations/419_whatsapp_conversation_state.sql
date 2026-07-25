-- =============================================================================
-- Migration 419 — WhatsApp bot conversation state (PR 2: read-only capabilities)
-- =============================================================================
-- Multi-turn state for the WhatsApp bot so a bound client can walk a short flow
-- (e.g. "report a problem" -> pick which service -> describe it). One in-flight
-- conversation per phone number; state is short-lived (the bot treats a row
-- older than a few minutes as stale and falls back to the menu). context holds
-- flow scratch data (e.g. the contract list being picked from).
--
-- No new permissions (all bot-internal, driven by the signed inbound webhook).
-- =============================================================================

CREATE TABLE IF NOT EXISTS whatsapp_conversation_state (
    phone_e164   VARCHAR(20)     NOT NULL,
    client_id    BIGINT UNSIGNED NULL,
    state        VARCHAR(40)     NOT NULL COMMENT 'e.g. await_contract_pick, await_problem_desc',
    context      JSON            NULL     COMMENT 'flow scratch data (contract list, chosen contract, ...)',
    updated_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (phone_e164),
    KEY idx_wa_convstate_client (client_id),
    CONSTRAINT fk_wa_convstate_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='WhatsApp bot multi-turn conversation state (migration 419) — one in-flight flow per phone, short-lived.';
