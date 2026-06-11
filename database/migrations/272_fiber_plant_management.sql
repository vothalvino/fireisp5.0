-- =============================================================================
-- Migration 272: Fiber Plant Management tables (§7.4)
-- =============================================================================
-- Tables created:
--   fiber_routes        — CO → splitter → ONU path topology records
--   odf_frames          — Optical Distribution Frame chassis inventory
--   odf_ports           — Individual ODF fiber ports per frame
--   odf_cross_connects  — Cross-connect patch records between ODF ports
--   otdr_test_results   — OTDR test records + fault location data
--   sfp_inventory       — SFP/SFP+ module lifecycle tracking per device port
--
-- Design notes:
--   • fiber_routes link devices (OLT/splitter), olt_ports, olt_splitters,
--     and onu_details to model the complete passive optical path.
--   • ODF tables are standalone CRUD with optional linkage to sites and
--     olt_splitters.
--   • OTDR: test result + fault events stored as JSON; live device I/O is
--     stubbed (scheduled job pattern, §7.1).
--   • SFP inventory: links to devices.id (port) + optional inventory_items.id
--     (catalog entry) for unit cost / lifecycle tracking.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: fiber_routes
-- Purpose: Central-office → splitter → ONU topology path records.
--          Each row describes one fiber segment of the passive optical path.
--          Segments can be chained via parent_route_id to represent a
--          multi-hop path (CO trunk → distribution splitter → drop splitter).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fiber_routes (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    name                VARCHAR(100)    NOT NULL
                            COMMENT 'Human-readable segment name, e.g. "CO-1 → SPL-034"',
    route_type          ENUM('trunk','distribution','drop','feeder','other')
                            NOT NULL DEFAULT 'drop'
                            COMMENT 'Segment class in the PON fiber hierarchy',
    parent_route_id     BIGINT UNSIGNED NULL
                            COMMENT 'FK to fiber_routes — parent trunk segment (nullable)',
    -- Endpoints
    from_device_id      BIGINT UNSIGNED NULL
                            COMMENT 'FK to devices — upstream device (OLT or intermediate)',
    from_olt_port_id    BIGINT UNSIGNED NULL
                            COMMENT 'FK to olt_ports — upstream PON port (for trunk routes)',
    from_splitter_id    BIGINT UNSIGNED NULL
                            COMMENT 'FK to olt_splitters — upstream splitter (for distribution routes)',
    to_device_id        BIGINT UNSIGNED NULL
                            COMMENT 'FK to devices — downstream device (splitter premise or ONU)',
    to_splitter_id      BIGINT UNSIGNED NULL
                            COMMENT 'FK to olt_splitters — downstream splitter',
    to_onu_detail_id    BIGINT UNSIGNED NULL
                            COMMENT 'FK to onu_details — terminal ONU on this drop',
    -- Physical attributes
    cable_length_m      INT UNSIGNED    NULL
                            COMMENT 'Fiber cable length in metres (measured or estimated)',
    cable_type          VARCHAR(50)     NULL
                            COMMENT 'Fiber cable spec, e.g. G.652D, G.657A2',
    attenuation_db      DECIMAL(6,3)    NULL
                            COMMENT 'Measured or calculated span attenuation in dB',
    -- Installation
    installed_at        DATE            NULL,
    status              ENUM('active','inactive','damaged','removed') NOT NULL DEFAULT 'active',
    gis_path            JSON            NULL
                            COMMENT 'GeoJSON LineString of the cable route (for map display)',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    KEY idx_fiber_routes_organization_id (organization_id),
    KEY idx_fiber_routes_parent_route_id (parent_route_id),
    KEY idx_fiber_routes_from_device_id (from_device_id),
    KEY idx_fiber_routes_from_olt_port_id (from_olt_port_id),
    KEY idx_fiber_routes_from_splitter_id (from_splitter_id),
    KEY idx_fiber_routes_to_device_id (to_device_id),
    KEY idx_fiber_routes_to_splitter_id (to_splitter_id),
    KEY idx_fiber_routes_to_onu_detail_id (to_onu_detail_id),
    KEY idx_fiber_routes_status (status),
    KEY idx_fiber_routes_deleted_at (deleted_at),
    CONSTRAINT fk_fiber_routes_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_fiber_routes_parent FOREIGN KEY (parent_route_id)
        REFERENCES fiber_routes (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_fiber_routes_from_device FOREIGN KEY (from_device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_fiber_routes_from_olt_port FOREIGN KEY (from_olt_port_id)
        REFERENCES olt_ports (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_fiber_routes_from_splitter FOREIGN KEY (from_splitter_id)
        REFERENCES olt_splitters (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_fiber_routes_to_device FOREIGN KEY (to_device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_fiber_routes_to_splitter FOREIGN KEY (to_splitter_id)
        REFERENCES olt_splitters (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_fiber_routes_to_onu FOREIGN KEY (to_onu_detail_id)
        REFERENCES onu_details (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='CO → splitter → ONU fiber topology segments (§7.4)';

-- ---------------------------------------------------------------------------
-- Table: odf_frames
-- Purpose: Optical Distribution Frame chassis inventory.
--          A frame is a physical rack unit or wall-mount enclosure that
--          holds a set of fiber termination ports (odf_ports).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS odf_frames (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    name                VARCHAR(100)    NOT NULL
                            COMMENT 'ODF frame identifier, e.g. "ODF-CO1-R01"',
    site_id             BIGINT UNSIGNED NULL
                            COMMENT 'FK to sites — physical location of this ODF frame',
    frame_type          ENUM('rack','wall_mount','splice_closure','patch_panel','other')
                            NOT NULL DEFAULT 'rack',
    port_count          SMALLINT UNSIGNED NOT NULL DEFAULT 12
                            COMMENT 'Total port capacity of this frame',
    fiber_type          ENUM('sm','mm','om3','om4','other') NOT NULL DEFAULT 'sm'
                            COMMENT 'Fiber type: SM = single-mode, MM = multi-mode',
    connector_type      ENUM('sc','lc','fc','st','mtp','other') NOT NULL DEFAULT 'sc',
    installed_at        DATE            NULL,
    status              ENUM('active','inactive','decommissioned') NOT NULL DEFAULT 'active',
    location_detail     VARCHAR(255)    NULL
                            COMMENT 'Rack row/column or cabinet position',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    KEY idx_odf_frames_organization_id (organization_id),
    KEY idx_odf_frames_site_id (site_id),
    KEY idx_odf_frames_status (status),
    KEY idx_odf_frames_deleted_at (deleted_at),
    CONSTRAINT fk_odf_frames_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_odf_frames_site FOREIGN KEY (site_id)
        REFERENCES sites (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='ODF chassis inventory (§7.4)';

-- ---------------------------------------------------------------------------
-- Table: odf_ports
-- Purpose: Individual fiber termination ports within an ODF frame.
--          Tracks port status (empty/connected/dirty/damaged) and what is
--          connected to each port (device, cable label).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS odf_ports (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    odf_frame_id        BIGINT UNSIGNED NOT NULL
                            COMMENT 'FK to odf_frames — parent frame',
    port_number         SMALLINT UNSIGNED NOT NULL
                            COMMENT 'Port position in the frame (1-based)',
    port_label          VARCHAR(50)     NULL
                            COMMENT 'Physical label on the port, e.g. "P-01-A"',
    port_status         ENUM('empty','connected','dirty','damaged','reserved')
                            NOT NULL DEFAULT 'empty',
    -- What is connected to this port
    connected_device_id BIGINT UNSIGNED NULL
                            COMMENT 'FK to devices — device whose fiber terminates here',
    cable_label         VARCHAR(100)    NULL
                            COMMENT 'Cable/tube label for tracing',
    splitter_id         BIGINT UNSIGNED NULL
                            COMMENT 'FK to olt_splitters — if this port feeds a splitter',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_odf_ports_frame_port (odf_frame_id, port_number),
    KEY idx_odf_ports_organization_id (organization_id),
    KEY idx_odf_ports_odf_frame_id (odf_frame_id),
    KEY idx_odf_ports_port_status (port_status),
    KEY idx_odf_ports_connected_device_id (connected_device_id),
    KEY idx_odf_ports_splitter_id (splitter_id),
    KEY idx_odf_ports_deleted_at (deleted_at),
    CONSTRAINT fk_odf_ports_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_odf_ports_frame FOREIGN KEY (odf_frame_id)
        REFERENCES odf_frames (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_odf_ports_device FOREIGN KEY (connected_device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_odf_ports_splitter FOREIGN KEY (splitter_id)
        REFERENCES olt_splitters (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='ODF fiber port records (§7.4)';

-- ---------------------------------------------------------------------------
-- Table: odf_cross_connects
-- Purpose: Patch-cord cross-connect records between two ODF ports.
--          Models the physical jumper that links a port on one panel (or frame)
--          to a port on another (or the same) frame.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS odf_cross_connects (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    port_a_id           BIGINT UNSIGNED NOT NULL
                            COMMENT 'FK to odf_ports — first end of the cross-connect',
    port_b_id           BIGINT UNSIGNED NOT NULL
                            COMMENT 'FK to odf_ports — second end of the cross-connect',
    patch_cord_label    VARCHAR(100)    NULL
                            COMMENT 'Color or label of the patch cord',
    patch_cord_length_m DECIMAL(6,1)   NULL
                            COMMENT 'Physical patch cord length in metres',
    installed_at        DATE            NULL,
    status              ENUM('active','inactive','removed') NOT NULL DEFAULT 'active',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    KEY idx_odf_cross_connects_organization_id (organization_id),
    KEY idx_odf_cross_connects_port_a_id (port_a_id),
    KEY idx_odf_cross_connects_port_b_id (port_b_id),
    KEY idx_odf_cross_connects_status (status),
    KEY idx_odf_cross_connects_deleted_at (deleted_at),
    CONSTRAINT fk_odf_cross_connects_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_odf_cross_connects_port_a FOREIGN KEY (port_a_id)
        REFERENCES odf_ports (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_odf_cross_connects_port_b FOREIGN KEY (port_b_id)
        REFERENCES odf_ports (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='ODF patch-cord cross-connect records (§7.4)';

-- ---------------------------------------------------------------------------
-- Table: otdr_test_results
-- Purpose: OTDR (Optical Time-Domain Reflectometer) test results per fiber
--          route or OLT port.
--          Stores test parameters + event table (reflections, splices, breaks)
--          as JSON.  Live OTDR device I/O is stubbed — results can be imported
--          manually (SOR/JSON upload) or triggered via a job record.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS otdr_test_results (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    -- What was tested
    fiber_route_id      BIGINT UNSIGNED NULL
                            COMMENT 'FK to fiber_routes — route under test',
    olt_port_id         BIGINT UNSIGNED NULL
                            COMMENT 'FK to olt_ports — PON port under test (alternate)',
    olt_device_id       BIGINT UNSIGNED NULL
                            COMMENT 'FK to devices (type=''olt'')',
    -- Test context
    test_type           ENUM('manual','scheduled','fault_locate','baseline','acceptance')
                            NOT NULL DEFAULT 'manual',
    -- Test parameters
    wavelength_nm       SMALLINT UNSIGNED NULL
                            COMMENT 'Test wavelength in nm, e.g. 1310, 1490, 1550, 1625',
    pulse_width_ns      INT UNSIGNED    NULL
                            COMMENT 'Pulse width in nanoseconds',
    range_m             INT UNSIGNED    NULL
                            COMMENT 'Test range in metres',
    -- Results
    total_loss_db       DECIMAL(6,3)    NULL
                            COMMENT 'Total fiber span loss in dB',
    total_length_m      INT UNSIGNED    NULL
                            COMMENT 'Measured fiber length in metres (OFS distance)',
    -- Fault location (if test_type=fault_locate)
    fault_detected      TINYINT(1)      NOT NULL DEFAULT 0,
    fault_distance_m    INT UNSIGNED    NULL
                            COMMENT 'Fault location in metres from launch point',
    fault_type          ENUM('reflection','break','high_splice','end_of_fiber','unknown') NULL,
    -- Full event table (splices, connectors, reflections)
    events              JSON            NULL
                            COMMENT 'Array of OTDR event objects: [{distance_m, loss_db, type}]',
    -- SOR file reference (uploaded binary, stored as file path or object-store key)
    sor_file_path       VARCHAR(512)    NULL
                            COMMENT 'Path/key to the .SOR trace file',
    -- Scheduling (for job-dispatched tests — live OTDR I/O is stubbed)
    job_status          ENUM('pending','in_progress','completed','failed','imported')
                            NOT NULL DEFAULT 'imported'
                            COMMENT 'Status of the test acquisition job',
    tested_at           DATETIME        NULL
                            COMMENT 'When the test was actually performed',
    tested_by           BIGINT UNSIGNED NULL
                            COMMENT 'FK to users — technician who ran the test',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    KEY idx_otdr_test_results_organization_id (organization_id),
    KEY idx_otdr_test_results_fiber_route_id (fiber_route_id),
    KEY idx_otdr_test_results_olt_port_id (olt_port_id),
    KEY idx_otdr_test_results_olt_device_id (olt_device_id),
    KEY idx_otdr_test_results_fault_detected (fault_detected),
    KEY idx_otdr_test_results_tested_at (tested_at),
    KEY idx_otdr_test_results_deleted_at (deleted_at),
    CONSTRAINT fk_otdr_test_results_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_otdr_test_results_fiber_route FOREIGN KEY (fiber_route_id)
        REFERENCES fiber_routes (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_otdr_test_results_olt_port FOREIGN KEY (olt_port_id)
        REFERENCES olt_ports (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_otdr_test_results_olt_device FOREIGN KEY (olt_device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_otdr_test_results_tested_by FOREIGN KEY (tested_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='OTDR test results and fault location records (§7.4)';

-- ---------------------------------------------------------------------------
-- Table: sfp_inventory
-- Purpose: SFP/SFP+ module lifecycle tracking per device port.
--          Links to:
--            • devices.id — device where the SFP is installed
--            • inventory_items.id — catalog entry (for cost/model tracking)
--          Lifecycle: in_stock → installed → removed → failed → retired.
--          SFP DDM diagnostics (Tx/Rx power, temp, voltage) are polled via
--          SNMP (snmp_metrics.sfp_tx_power_dbm / sfp_rx_power_dbm from
--          migration 255) and stored there — this table holds the physical
--          inventory and lifecycle record.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sfp_inventory (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    -- Identification
    serial_number       VARCHAR(64)     NULL
                            COMMENT 'SFP/SFP+ module serial number',
    vendor_name         VARCHAR(64)     NULL
                            COMMENT 'Transceiver vendor (from SFP EEPROM)',
    part_number         VARCHAR(64)     NULL
                            COMMENT 'Vendor part number',
    form_factor         ENUM('sfp','sfp_plus','sfp28','qsfp','qsfp_plus','xfp','gbic','other')
                            NOT NULL DEFAULT 'sfp',
    fiber_type          ENUM('sm','mm','copper') NOT NULL DEFAULT 'sm',
    wavelength_nm       SMALLINT UNSIGNED NULL
                            COMMENT 'Nominal wavelength in nm (e.g. 1310, 1490, 1550)',
    max_distance_m      INT UNSIGNED    NULL
                            COMMENT 'Rated maximum distance in metres',
    speed_gbps          DECIMAL(6,1)    NULL
                            COMMENT 'Rated speed in Gbps (e.g. 1.0, 10.0, 25.0)',
    -- Lifecycle
    lifecycle_status    ENUM('in_stock','installed','removed','failed','retired')
                            NOT NULL DEFAULT 'in_stock',
    installed_device_id BIGINT UNSIGNED NULL
                            COMMENT 'FK to devices — device this SFP is currently in',
    port_name           VARCHAR(50)     NULL
                            COMMENT 'Port/interface name on the device, e.g. "0/0/1"',
    installed_at        DATE            NULL,
    removed_at          DATE            NULL,
    failure_reason      TEXT            NULL,
    -- Catalog linkage (optional)
    inventory_item_id   BIGINT UNSIGNED NULL
                            COMMENT 'FK to inventory_items — catalog entry for cost tracking',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    KEY idx_sfp_inventory_organization_id (organization_id),
    KEY idx_sfp_inventory_serial_number (serial_number),
    KEY idx_sfp_inventory_lifecycle_status (lifecycle_status),
    KEY idx_sfp_inventory_installed_device_id (installed_device_id),
    KEY idx_sfp_inventory_inventory_item_id (inventory_item_id),
    KEY idx_sfp_inventory_deleted_at (deleted_at),
    CONSTRAINT fk_sfp_inventory_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_sfp_inventory_device FOREIGN KEY (installed_device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_sfp_inventory_item FOREIGN KEY (inventory_item_id)
        REFERENCES inventory_items (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='SFP/SFP+ module lifecycle inventory (§7.4)';
