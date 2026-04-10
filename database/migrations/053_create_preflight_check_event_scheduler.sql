-- Migration: 053_create_preflight_check_event_scheduler
-- Description: Creates a preflight check stored procedure that validates the
--              MySQL Event Scheduler is enabled (event_scheduler = ON).
--
-- Background:  The following scheduled events rely on the MySQL Event Scheduler:
--
--              SNMP monitoring (migration 028):
--                evt_snmp_rollup_1hr             — hourly SNMP rollup
--                evt_snmp_rollup_1day            — daily SNMP rollup
--                evt_snmp_retention              — purge hourly data > 1 year
--                evt_snmp_partition_maintenance  — add/drop snmp_metrics partitions
--
--              Connection logs compliance (migration 033):
--                evt_connection_logs_partition_maintenance
--                    — adds future partitions and drops partitions > 2 years
--                    — if this event does not run:
--                        * inserts will fail once p_future fills up
--                        * old partitions accumulate beyond the 2-year retention window
--
-- Usage:       Call this procedure during deployment or application startup to
--              detect a misconfigured server before it causes data loss or
--              compliance violations:
--
--                  CALL preflight_check_event_scheduler();
--
--              The procedure raises SQLSTATE '45000' with a descriptive message
--              if the event scheduler is OFF or DISABLED.  It returns silently
--              (no rows) when the scheduler is ON.

DELIMITER $$

-- ---------------------------------------------------------------------------
-- Procedure: preflight_check_event_scheduler
-- Purpose:   Raise a SIGNAL SQLSTATE '45000' error if the MySQL Event
--            Scheduler is not enabled.  Call this during deployment or
--            application startup to detect a misconfigured server early.
-- ---------------------------------------------------------------------------
CREATE PROCEDURE IF NOT EXISTS preflight_check_event_scheduler()
BEGIN
    DECLARE v_scheduler VARCHAR(16);

    SELECT variable_value INTO v_scheduler
    FROM performance_schema.global_variables
    WHERE variable_name = 'event_scheduler';

    IF UPPER(v_scheduler) != 'ON' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT =
                'MySQL Event Scheduler is not enabled (event_scheduler = ON is required). '
                'Scheduled events for SNMP rollup/retention and connection_logs partition '
                'maintenance will not run, risking insert failures and compliance retention '
                'violations. Enable it with: SET GLOBAL event_scheduler = ON; or add '
                'event_scheduler = ON under [mysqld] in my.cnf and restart MySQL.';
    END IF;
END$$

DELIMITER ;
