-- Migration: 043_add_ticket_id_to_jobs
-- Description: Adds ticket_id FK column to jobs so that a field work order can be
--              traced back to the support ticket that triggered it
--              (ticket → work order traceability chain).

ALTER TABLE jobs
    ADD COLUMN ticket_id BIGINT UNSIGNED NULL
        COMMENT 'Originating support ticket, if this job was escalated from a ticket'
        AFTER contract_id,
    ADD KEY idx_jobs_ticket_id (ticket_id),
    ADD CONSTRAINT fk_jobs_ticket FOREIGN KEY (ticket_id)
        REFERENCES tickets (id) ON DELETE SET NULL ON UPDATE CASCADE;
