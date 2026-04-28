-- =============================================================================
-- Migration 168 — PROFECO complaint tracking
-- =============================================================================
-- Stores records of consumer complaints filed through Mexico's PROFECO
-- (Procuraduría Federal del Consumidor) CONCILIANET platform.  ISPs are
-- required to maintain a complaint register and submit quarterly summaries to
-- PROFECO.  Each row in this table corresponds to one PROFECO complaint folio.
-- A complaint may optionally be linked to an existing support ticket and/or
-- a client record.
-- =============================================================================

CREATE TABLE IF NOT EXISTS profeco_complaints (
    id                   BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id      BIGINT UNSIGNED  NOT NULL,
    ticket_id            BIGINT UNSIGNED  NULL     COMMENT 'Linked support ticket, if any',
    client_id            BIGINT UNSIGNED  NULL     COMMENT 'Linked client record, if any',

    -- PROFECO filing details
    folio_profeco        VARCHAR(50)      NULL     COMMENT 'Folio number assigned by PROFECO/CONCILIANET',
    consumer_name        VARCHAR(255)     NOT NULL COMMENT 'Consumer full name as it appears in the PROFECO filing',
    consumer_email       VARCHAR(255)     NULL,
    consumer_phone       VARCHAR(30)      NULL,

    -- Classification
    service_type         ENUM('internet', 'telefonia', 'television', 'paquete')
                                          NOT NULL DEFAULT 'internet',
    category             ENUM('facturacion', 'calidad_servicio', 'contrato',
                               'suspension_indebida', 'cobros_no_autorizados',
                               'atencion_cliente', 'otro')
                                          NOT NULL DEFAULT 'otro',

    -- Content
    description          TEXT            NOT NULL COMMENT 'Consumer complaint description',
    resolution_requested TEXT            NULL     COMMENT 'What the consumer is asking for',
    company_response     TEXT            NULL     COMMENT 'Company formal response / position',

    -- Lifecycle
    status               ENUM('recibida', 'en_tramite', 'resuelta', 'archivada')
                                          NOT NULL DEFAULT 'recibida',
    reported_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                          COMMENT 'Date PROFECO received the complaint (may differ from created_at)',
    resolved_at          DATETIME        NULL,
    submitted_by         BIGINT UNSIGNED NULL     COMMENT 'Staff user who logged this entry',

    created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at           DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_profeco_complaints_org         (organization_id),
    KEY idx_profeco_complaints_client      (client_id),
    KEY idx_profeco_complaints_ticket      (ticket_id),
    KEY idx_profeco_complaints_status      (status),
    KEY idx_profeco_complaints_reported_at (reported_at),
    KEY idx_profeco_complaints_folio       (folio_profeco),
    KEY idx_profeco_complaints_deleted_at  (deleted_at),

    CONSTRAINT fk_profeco_complaints_org
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_profeco_complaints_client
        FOREIGN KEY (client_id) REFERENCES clients (id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_profeco_complaints_ticket
        FOREIGN KEY (ticket_id) REFERENCES tickets (id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_profeco_complaints_user
        FOREIGN KEY (submitted_by) REFERENCES users (id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
