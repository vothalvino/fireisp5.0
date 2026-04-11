-- Migration: 113_create_speed_tests_table
-- Description: Speed test results captured from the client portal, technician
--              tools, automated probes, or external measurement services.
--              Records download/upload throughput, latency, jitter, and packet
--              loss alongside the source device and contract for SLA correlation.

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS speed_tests (
    id               BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
    client_id        BIGINT UNSIGNED   NULL                      COMMENT 'Client who initiated or is associated with this test; NULL = probe-only',
    contract_id      BIGINT UNSIGNED   NULL                      COMMENT 'Contract (service) under test; NULL = not contract-specific',
    device_id        BIGINT UNSIGNED   NULL                      COMMENT 'CPE or probe device that ran the test; NULL = client browser test',
    test_source      ENUM('client_portal','technician','automated_probe','external')
                                        NOT NULL                  COMMENT 'How the test was initiated',
    server_location  VARCHAR(150)       NULL                      COMMENT 'Test server geographic location or identifier',
    download_mbps    DECIMAL(10, 3)     NOT NULL                  COMMENT 'Measured download speed in Mbps',
    upload_mbps      DECIMAL(10, 3)     NOT NULL                  COMMENT 'Measured upload speed in Mbps',
    latency_ms       DECIMAL(8, 2)      NULL                      COMMENT 'Round-trip latency in milliseconds',
    jitter_ms        DECIMAL(8, 2)      NULL                      COMMENT 'Latency jitter in milliseconds',
    packet_loss_pct  DECIMAL(5, 2)      NULL                      COMMENT 'Packet loss percentage (0.00–100.00)',
    ip_address       VARCHAR(45)        NULL                      COMMENT 'Public IP address observed during the test (IPv4 or IPv6)',
    notes            TEXT               NULL                      COMMENT 'Free-text observations or technician comments',
    tested_at        TIMESTAMP          NOT NULL                  COMMENT 'When the test measurement was taken',
    created_at       TIMESTAMP          NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_speed_tests_client_id (client_id),
    KEY idx_speed_tests_contract_id (contract_id),
    KEY idx_speed_tests_device_id (device_id),
    KEY idx_speed_tests_tested_at (tested_at),
    KEY idx_speed_tests_test_source (test_source),
    CONSTRAINT fk_speed_tests_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_speed_tests_contract FOREIGN KEY (contract_id)
        REFERENCES contracts (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_speed_tests_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
