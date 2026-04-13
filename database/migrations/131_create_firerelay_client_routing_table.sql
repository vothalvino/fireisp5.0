-- =============================================================================
-- FireISP 5.0 — Migration 131: Create firerelay_client_routing table
-- =============================================================================
-- Maps each client_id to the node that owns it so the master can route
-- single-entity requests to the correct worker.
-- Only used when FIRERELAY_MODE = master.
-- =============================================================================

CREATE TABLE IF NOT EXISTS firerelay_client_routing (
  client_id   BIGINT UNSIGNED NOT NULL COMMENT 'The client ID',
  node_id     VARCHAR(64)     NOT NULL COMMENT 'Which node owns this client',
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id),
  KEY idx_firerelay_client_routing_node (node_id),
  CONSTRAINT fk_firerelay_routing_node
    FOREIGN KEY (node_id) REFERENCES firerelay_nodes (id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
