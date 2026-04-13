-- Migration: 150_outage_temporal_logic_trigger
-- Description: Adds BEFORE INSERT and BEFORE UPDATE triggers on outages that
--              ensure resolved_at is always after started_at when set.
--
--              Business rule: an outage cannot be resolved before it started.
--              Allowing inverted timestamps would produce nonsensical duration
--              calculations and corrupt SLA/uptime reporting.
--
--              The trigger only fires when resolved_at IS NOT NULL; setting
--              resolved_at to NULL (re-opening an outage) is always allowed.
--
--              The triggers raise SQLSTATE '45000' with a descriptive message
--              so the application layer can surface a user-friendly error.
--
--              Uses DROP TRIGGER IF EXISTS before CREATE TRIGGER so the
--              migration is safe to re-run.

DELIMITER $$

-- -------------------------------------------------------------------------
-- 1. BEFORE INSERT — resolved_at must be after started_at
-- -------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_outages_temporal_bi$$

CREATE TRIGGER trg_outages_temporal_bi
BEFORE INSERT ON outages
FOR EACH ROW
BEGIN
    IF NEW.resolved_at IS NOT NULL AND NEW.resolved_at <= NEW.started_at THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Outage resolved_at must be after started_at';
    END IF;
END$$

-- -------------------------------------------------------------------------
-- 2. BEFORE UPDATE — resolved_at must be after started_at
-- -------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_outages_temporal_bu$$

CREATE TRIGGER trg_outages_temporal_bu
BEFORE UPDATE ON outages
FOR EACH ROW
BEGIN
    IF NEW.resolved_at IS NOT NULL AND NEW.resolved_at <= NEW.started_at THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Outage resolved_at must be after started_at';
    END IF;
END$$

DELIMITER ;
