-- Migration: 058_add_template_id_to_email_logs
-- Description: Links email_logs to the new message_templates table so every
--              sent message records which template was used to render it.
--              The existing VARCHAR template column is kept for backward
--              compatibility and free-text template names.

ALTER TABLE email_logs
    ADD COLUMN template_id BIGINT UNSIGNED NULL COMMENT 'Template used to render this message; NULL = ad-hoc / legacy'
        AFTER template,
    ADD KEY idx_email_logs_template_id (template_id),
    ADD CONSTRAINT fk_email_logs_template FOREIGN KEY (template_id)
        REFERENCES message_templates (id) ON DELETE SET NULL ON UPDATE CASCADE;
