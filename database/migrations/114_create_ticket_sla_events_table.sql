-- Migration: 114_create_ticket_sla_events_table
-- Description: SLA tracking events per support ticket. Records first-response
--              time, resolution time, escalations, and breach events. Pairs with
--              the sla_definitions table (migration 063) to compare actual
--              performance against contracted SLA targets.

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS ticket_sla_events (
    id                  BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    ticket_id           BIGINT UNSIGNED  NOT NULL                   COMMENT 'Ticket this SLA event belongs to',
    sla_definition_id   BIGINT UNSIGNED  NULL                       COMMENT 'SLA definition that set the target; NULL = no formal SLA',
    event_type          ENUM('first_response','resolution','escalation','breach_warning','breach')
                                          NOT NULL                   COMMENT 'Type of SLA milestone or event',
    target_deadline     TIMESTAMP         NULL                       COMMENT 'Calculated deadline for this SLA target; NULL = informational event',
    actual_at           TIMESTAMP         NULL                       COMMENT 'Actual timestamp when the event occurred; NULL = not yet achieved',
    is_breached         TINYINT(1)        NOT NULL DEFAULT 0         COMMENT 'TRUE = the SLA target was missed',
    breached_by_minutes INT               NULL                       COMMENT 'Minutes by which the deadline was exceeded (positive = late); NULL = not breached',
    notes               TEXT              NULL                       COMMENT 'Optional context or explanation for the event',
    created_at          TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_ticket_sla_events_ticket_id (ticket_id),
    KEY idx_ticket_sla_events_sla_definition_id (sla_definition_id),
    KEY idx_ticket_sla_events_event_type (event_type),
    KEY idx_ticket_sla_events_is_breached (is_breached),
    CONSTRAINT fk_ticket_sla_events_ticket FOREIGN KEY (ticket_id)
        REFERENCES tickets (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_ticket_sla_events_sla_definition FOREIGN KEY (sla_definition_id)
        REFERENCES sla_definitions (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
