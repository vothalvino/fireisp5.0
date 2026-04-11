-- =============================================================================
-- FireISP 5.0 — Migration 131: Create firerelay_client_routing table
-- =============================================================================
-- Maps each client_id to the node that owns it.  Only used when
-- FIRERELAY_MODE = master.  Workers and standalone installs ignore this table.
-- =============================================================================

CREATE TABLE IF NOT EXISTS firerelay_client_routing (
  client_id   BIGINT UNSIGNED NOT NULL,
  node_id     VARCHAR(64)     NOT NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id),
  KEY idx_firerelay_client_routing_node (node_id),
  CONSTRAINT fk_firerelay_routing_node
    FOREIGN KEY (node_id) REFERENCES firerelay_nodes (id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
