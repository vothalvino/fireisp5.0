-- =============================================================================
-- Migration 439 — deploy requests + host agent heartbeat
-- =============================================================================
-- Lets the install operator trigger a redeploy from the web GUI WITHOUT giving
-- the application container any privilege on the host.
--
-- WHY THIS SHAPE. The obvious implementation mounts the Docker socket into the
-- app container. That is root on the host: any RCE or path traversal in FireISP
-- would own the machine rather than the app. The same architecture was already
-- refused for the TLS renew button, and it is refused here.
--
-- Instead the container only ever INSERTS A ROW. A systemd timer running as
-- root OUTSIDE the container claims that row and executes one fixed command —
-- redeploy.sh, with no arguments.
--
-- THE REQUEST CARRIES NO TARGET. There is deliberately no commit/tag/image
-- column: a request that could name what to deploy would hand a compromised app
-- an arbitrary-image-deploy primitive, which is most of what the Docker socket
-- would have given away. The agent always deploys whatever CI has published for
-- current main. A full app compromise therefore buys an attacker "trigger a
-- redeploy of the signed image that was going to be deployed anyway".
--
-- NOT ORG-SCOPED, and this is the one table where that is correct rather than
-- an oversight: a deploy is an act on the INSTALL. There is no organization_id
-- because there is no tenant whose deploy this is, and the routes gate on the
-- legacy users.role='admin' rather than a permission slug — migration 119
-- grants org admins every slug, so a slug would reach exactly the wrong people.
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run on MySQL 8).
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS deploy_requests (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    requested_by  BIGINT UNSIGNED NULL      COMMENT 'users.id of the operator who pressed the button; NULL once that user is deleted',
    requested_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status        ENUM('pending','running','succeeded','failed')
                                  NOT NULL DEFAULT 'pending',
    started_at    TIMESTAMP       NULL     COMMENT 'When the host agent claimed it',
    finished_at   TIMESTAMP       NULL,
    exit_code     INT             NULL     COMMENT 'redeploy.sh exit status',
    output_tail   TEXT            NULL     COMMENT 'Last few KB of redeploy output, for the UI. Never the full log: it can contain registry URLs and is written by a root process.',

    PRIMARY KEY (id),
    -- The hot read is "the newest request", and the agent claims "the oldest
    -- pending one" — both are this index.
    KEY idx_deploy_requests_status (status, id),
    CONSTRAINT fk_deploy_requests_user FOREIGN KEY (requested_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Agent heartbeat ─────────────────────────────────────────────────────────
-- Without this the button is a stub that fakes success: on an install whose
-- operator never set up the systemd units, pressing it would queue a row that
-- nothing will ever service, and the UI would sit on "pending" forever with no
-- way to tell that from a slow deploy. CLAUDE.md calls a stub whose UI fakes
-- success a bug rather than a feature, so the agent stamps this every poll and
-- the UI refuses to offer the button when it has gone stale.
--
-- Single row, id pinned to 1.
CREATE TABLE IF NOT EXISTS deploy_agent_status (
    id            TINYINT UNSIGNED NOT NULL DEFAULT 1,
    last_seen_at  TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    agent_version VARCHAR(40)      NULL,
    hostname      VARCHAR(255)     NULL,

    PRIMARY KEY (id),
    CONSTRAINT chk_deploy_agent_single_row CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
