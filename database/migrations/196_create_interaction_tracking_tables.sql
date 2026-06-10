-- =============================================================================
-- Migration 196: Interaction Tracking tables (client interactions, follow-up
--                reminders, satisfaction surveys, ticket escalations)
-- =============================================================================
-- Implements isp-platform-features.md §1.3 "Interaction Tracking":
--   • client_interactions   — manual interaction log (calls, visits, chats, …);
--                              together with tickets, payments, email_logs and
--                              sms_logs it feeds the per-client activity
--                              timeline (interactionService.activityTimeline)
--   • follow_up_reminders    — scheduled follow-ups with automated due
--                              notifications (taskRunner: follow_up_reminders)
--   • satisfaction_surveys   — NPS / CSAT surveys, auto-dispatched when a
--                              ticket is resolved (taskRunner:
--                              dispatch_satisfaction_surveys)
--   • ticket_escalations     — escalation management for unresolved tickets,
--                              with hourly auto-escalation of stale tickets
--                              (taskRunner: auto_escalate_tickets)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: client_interactions — manual interaction log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_interactions (
    id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id  BIGINT UNSIGNED NULL
                         COMMENT 'Tenant organization; NULL = single-tenant deployment',
    client_id        BIGINT UNSIGNED NOT NULL,
    user_id          BIGINT UNSIGNED NULL COMMENT 'Staff member (users.id) who logged the interaction',
    interaction_type ENUM('call','email','sms','visit','chat','other')
                         NOT NULL DEFAULT 'call' COMMENT 'Channel of the interaction',
    direction        ENUM('inbound','outbound')
                         NOT NULL DEFAULT 'inbound' COMMENT 'Direction relative to the ISP',
    subject          VARCHAR(300)    NOT NULL COMMENT 'Short summary line',
    notes            TEXT            NULL COMMENT 'Free-form detail of what was discussed',
    occurred_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                         COMMENT 'When the interaction took place',
    duration_minutes INT UNSIGNED    NULL COMMENT 'Call/visit duration in minutes',
    created_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at       DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_client_interactions_organization_id (organization_id),
    KEY idx_client_interactions_client_occurred (client_id, occurred_at DESC),
    KEY idx_client_interactions_type (interaction_type),
    KEY idx_client_interactions_deleted_at (deleted_at),
    CONSTRAINT fk_client_interactions_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_client_interactions_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_client_interactions_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: follow_up_reminders — scheduled follow-ups per client
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS follow_up_reminders (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL
                        COMMENT 'Tenant organization; NULL = single-tenant deployment',
    client_id       BIGINT UNSIGNED NOT NULL,
    interaction_id  BIGINT UNSIGNED NULL COMMENT 'Originating interaction, when the follow-up came from one',
    ticket_id       BIGINT UNSIGNED NULL COMMENT 'Related support ticket, if any',
    assigned_to     BIGINT UNSIGNED NULL COMMENT 'Staff member (users.id) responsible for the follow-up',
    title           VARCHAR(200)    NOT NULL COMMENT 'What needs to be followed up',
    notes           TEXT            NULL,
    priority        ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
    status          ENUM('pending','completed','cancelled') NOT NULL DEFAULT 'pending',
    due_at          DATETIME        NOT NULL COMMENT 'When the follow-up is due',
    notified_at     DATETIME        NULL COMMENT 'When the due notification was sent (NULL = not yet notified)',
    completed_at    DATETIME        NULL,
    completed_by    BIGINT UNSIGNED NULL,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_follow_up_reminders_organization_id (organization_id),
    KEY idx_follow_up_reminders_client_id (client_id),
    KEY idx_follow_up_reminders_assigned_status (assigned_to, status, due_at),
    KEY idx_follow_up_reminders_status_due (status, due_at),
    KEY idx_follow_up_reminders_deleted_at (deleted_at),
    CONSTRAINT fk_follow_up_reminders_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_follow_up_reminders_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_follow_up_reminders_interaction FOREIGN KEY (interaction_id)
        REFERENCES client_interactions (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_follow_up_reminders_ticket FOREIGN KEY (ticket_id)
        REFERENCES tickets (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_follow_up_reminders_assigned_to FOREIGN KEY (assigned_to)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_follow_up_reminders_completed_by FOREIGN KEY (completed_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: satisfaction_surveys — NPS / CSAT responses
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS satisfaction_surveys (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL
                        COMMENT 'Tenant organization; NULL = single-tenant deployment',
    client_id       BIGINT UNSIGNED NOT NULL,
    ticket_id       BIGINT UNSIGNED NULL COMMENT 'Ticket that triggered the survey (resolution CSAT)',
    interaction_id  BIGINT UNSIGNED NULL COMMENT 'Interaction that triggered the survey, if any',
    survey_type     ENUM('nps','csat') NOT NULL DEFAULT 'csat'
                        COMMENT 'NPS scores 0-10; CSAT scores 1-5',
    channel         ENUM('email','sms','portal','in_person') NOT NULL DEFAULT 'email',
    status          ENUM('pending','sent','responded','expired') NOT NULL DEFAULT 'pending',
    score           TINYINT         NULL COMMENT 'NPS: 0-10, CSAT: 1-5; NULL until responded',
    comment         TEXT            NULL COMMENT 'Free-form respondent comment',
    sent_at         DATETIME        NULL,
    responded_at    DATETIME        NULL,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_satisfaction_surveys_organization_id (organization_id),
    KEY idx_satisfaction_surveys_client_id (client_id),
    KEY idx_satisfaction_surveys_ticket_id (ticket_id),
    KEY idx_satisfaction_surveys_type_status (survey_type, status),
    KEY idx_satisfaction_surveys_responded_at (responded_at),
    KEY idx_satisfaction_surveys_deleted_at (deleted_at),
    CONSTRAINT fk_satisfaction_surveys_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_satisfaction_surveys_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_satisfaction_surveys_ticket FOREIGN KEY (ticket_id)
        REFERENCES tickets (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_satisfaction_surveys_interaction FOREIGN KEY (interaction_id)
        REFERENCES client_interactions (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: ticket_escalations — escalation chain for unresolved tickets
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_escalations (
    id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id  BIGINT UNSIGNED NULL
                         COMMENT 'Tenant organization; NULL = single-tenant deployment',
    ticket_id        BIGINT UNSIGNED NOT NULL,
    level            TINYINT UNSIGNED NOT NULL DEFAULT 1
                         COMMENT 'Escalation tier: 1 = L1 support, 2 = L2 tech, 3 = management',
    escalated_by     BIGINT UNSIGNED NULL COMMENT 'User who escalated; NULL = automatic (stale-ticket task)',
    escalated_to     BIGINT UNSIGNED NULL COMMENT 'User the ticket was escalated to',
    reason           VARCHAR(500)    NOT NULL COMMENT 'Why the ticket was escalated',
    status           ENUM('open','acknowledged','resolved') NOT NULL DEFAULT 'open',
    acknowledged_at  DATETIME        NULL,
    resolved_at      DATETIME        NULL,
    resolution_notes TEXT            NULL,
    created_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_ticket_escalations_organization_id (organization_id),
    KEY idx_ticket_escalations_ticket_level (ticket_id, level),
    KEY idx_ticket_escalations_status (status),
    CONSTRAINT fk_ticket_escalations_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_ticket_escalations_ticket FOREIGN KEY (ticket_id)
        REFERENCES tickets (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_ticket_escalations_escalated_by FOREIGN KEY (escalated_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_ticket_escalations_escalated_to FOREIGN KEY (escalated_to)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Seed: scheduled tasks driving the automated parts of §1.3
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO scheduled_tasks
    (organization_id, task_name, description, cron_expression, is_enabled, priority)
VALUES
    (NULL,
     'follow_up_reminders',
     'Notify assignees about follow-up reminders that have come due',
     '*/15 * * * *',
     TRUE,
     'normal'),
    (NULL,
     'dispatch_satisfaction_surveys',
     'Create and send CSAT surveys for recently resolved tickets',
     '0 * * * *',
     TRUE,
     'normal'),
    (NULL,
     'auto_escalate_tickets',
     'Escalate open tickets with no resolution after 48 hours',
     '30 * * * *',
     TRUE,
     'normal');
