-- =============================================================================
-- FireISP 5.0 — Test Helper Procedures
-- =============================================================================
-- Provides a lightweight test-assertion framework for MySQL.
--
-- Usage:
--   1. SOURCE this file first to create the helpers.
--   2. CALL test_begin('Test Suite Name');
--   3. CALL assert_true(condition, 'description');
--      CALL assert_equal(expected, actual, 'description');
--      CALL assert_sql_error('45000', 'SQL statement', 'description');
--   4. CALL test_summary();   -- prints pass/fail totals; exits 1 on failure
--
-- The helpers use a temporary table (__test_results) to track outcomes so that
-- a single pass through a test file produces a clear, machine-parseable report.
-- =============================================================================

DELIMITER $$

-- ---------------------------------------------------------------------------
-- Temporary results table
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS __test_results$$
CREATE TABLE __test_results (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    suite       VARCHAR(255),
    description VARCHAR(500),
    passed      BOOLEAN,
    message     VARCHAR(1000) NULL
) ENGINE=MEMORY$$

DROP PROCEDURE IF EXISTS test_begin$$
CREATE PROCEDURE test_begin(IN p_suite VARCHAR(255))
BEGIN
    SET @__test_suite = p_suite;
    SET @__test_pass  = 0;
    SET @__test_fail  = 0;
    SELECT CONCAT('=== ', p_suite, ' ===') AS '';
END$$

-- ---------------------------------------------------------------------------
-- assert_true: passes when p_condition is TRUE (non-zero/non-NULL)
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS assert_true$$
CREATE PROCEDURE assert_true(IN p_condition BOOLEAN, IN p_description VARCHAR(500))
BEGIN
    IF p_condition IS TRUE THEN
        SET @__test_pass = @__test_pass + 1;
        INSERT INTO __test_results (suite, description, passed)
        VALUES (@__test_suite, p_description, TRUE);
        SELECT CONCAT('  ✓ PASS: ', p_description) AS '';
    ELSE
        SET @__test_fail = @__test_fail + 1;
        INSERT INTO __test_results (suite, description, passed, message)
        VALUES (@__test_suite, p_description, FALSE, 'Condition was FALSE or NULL');
        SELECT CONCAT('  ✗ FAIL: ', p_description) AS '';
    END IF;
END$$

-- ---------------------------------------------------------------------------
-- assert_equal: passes when p_expected = p_actual (string comparison)
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS assert_equal$$
CREATE PROCEDURE assert_equal(
    IN p_expected VARCHAR(1000),
    IN p_actual   VARCHAR(1000),
    IN p_description VARCHAR(500)
)
BEGIN
    IF p_expected = p_actual OR (p_expected IS NULL AND p_actual IS NULL) THEN
        SET @__test_pass = @__test_pass + 1;
        INSERT INTO __test_results (suite, description, passed)
        VALUES (@__test_suite, p_description, TRUE);
        SELECT CONCAT('  ✓ PASS: ', p_description) AS '';
    ELSE
        SET @__test_fail = @__test_fail + 1;
        INSERT INTO __test_results (suite, description, passed, message)
        VALUES (@__test_suite, p_description, FALSE,
                CONCAT('Expected "', IFNULL(p_expected, 'NULL'),
                       '" but got "', IFNULL(p_actual, 'NULL'), '"'));
        SELECT CONCAT('  ✗ FAIL: ', p_description,
                       ' (expected "', IFNULL(p_expected, 'NULL'),
                       '", got "', IFNULL(p_actual, 'NULL'), '")') AS '';
    END IF;
END$$

-- ---------------------------------------------------------------------------
-- assert_sql_error: passes when SQL raises an error (optionally SQLSTATE)
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS assert_sql_error$$
CREATE PROCEDURE assert_sql_error(
    IN p_expected_sqlstate CHAR(5),
    IN p_sql               TEXT,
    IN p_description       VARCHAR(500)
)
BEGIN
    DECLARE v_sqlstate CHAR(5) DEFAULT NULL;
    DECLARE v_raised   BOOLEAN DEFAULT FALSE;
    DECLARE v_prepared BOOLEAN DEFAULT FALSE;

    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000'
    BEGIN
        SET v_raised = TRUE;
        SET v_sqlstate = '45000';
    END;

    DECLARE CONTINUE HANDLER FOR SQLEXCEPTION
    BEGIN
        SET v_raised = TRUE;
        IF v_sqlstate IS NULL THEN
            SET v_sqlstate = 'ERROR';
        END IF;
    END;

    SET @__assert_sql_error_stmt = p_sql;
    PREPARE _assert_sql_error_stmt FROM @__assert_sql_error_stmt;
    SET v_prepared = TRUE;
    EXECUTE _assert_sql_error_stmt;

    IF v_prepared THEN
        DEALLOCATE PREPARE _assert_sql_error_stmt;
    END IF;

    CALL assert_true(
        v_raised = TRUE AND (p_expected_sqlstate IS NULL OR v_sqlstate = p_expected_sqlstate),
        p_description
    );
END$$

-- ---------------------------------------------------------------------------
-- assert_row_count: passes when SELECT COUNT(*) matches expected
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS assert_row_count$$
CREATE PROCEDURE assert_row_count(
    IN p_table_name   VARCHAR(255),
    IN p_where_clause VARCHAR(1000),
    IN p_expected     INT,
    IN p_description  VARCHAR(500)
)
BEGIN
    DECLARE v_actual INT DEFAULT 0;

    SET @_arc_sql = CONCAT('SELECT COUNT(*) INTO @_arc_count FROM ', p_table_name);
    IF p_where_clause IS NOT NULL AND p_where_clause != '' THEN
        SET @_arc_sql = CONCAT(@_arc_sql, ' WHERE ', p_where_clause);
    END IF;

    PREPARE _arc_stmt FROM @_arc_sql;
    EXECUTE _arc_stmt;
    DEALLOCATE PREPARE _arc_stmt;

    SET v_actual = @_arc_count;
    CALL assert_equal(CAST(p_expected AS CHAR), CAST(v_actual AS CHAR), p_description);
END$$

-- ---------------------------------------------------------------------------
-- assert_table_exists: passes when INFORMATION_SCHEMA shows the table
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS assert_table_exists$$
CREATE PROCEDURE assert_table_exists(
    IN p_table_name  VARCHAR(255),
    IN p_description VARCHAR(500)
)
BEGIN
    DECLARE v_count INT DEFAULT 0;
    SELECT COUNT(*) INTO v_count
    FROM   INFORMATION_SCHEMA.TABLES
    WHERE  TABLE_SCHEMA = DATABASE()
      AND  TABLE_NAME   = p_table_name;

    CALL assert_true(v_count = 1, p_description);
END$$

-- ---------------------------------------------------------------------------
-- assert_trigger_exists: passes when INFORMATION_SCHEMA shows the trigger
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS assert_trigger_exists$$
CREATE PROCEDURE assert_trigger_exists(
    IN p_trigger_name VARCHAR(255),
    IN p_description  VARCHAR(500)
)
BEGIN
    DECLARE v_count INT DEFAULT 0;
    SELECT COUNT(*) INTO v_count
    FROM   INFORMATION_SCHEMA.TRIGGERS
    WHERE  TRIGGER_SCHEMA = DATABASE()
      AND  TRIGGER_NAME   = p_trigger_name;

    CALL assert_true(v_count = 1, p_description);
END$$

-- ---------------------------------------------------------------------------
-- assert_column_exists: passes when the table has the named column
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS assert_column_exists$$
CREATE PROCEDURE assert_column_exists(
    IN p_table_name  VARCHAR(255),
    IN p_column_name VARCHAR(255),
    IN p_description VARCHAR(500)
)
BEGIN
    DECLARE v_count INT DEFAULT 0;
    SELECT COUNT(*) INTO v_count
    FROM   INFORMATION_SCHEMA.COLUMNS
    WHERE  TABLE_SCHEMA = DATABASE()
      AND  TABLE_NAME   = p_table_name
      AND  COLUMN_NAME  = p_column_name;

    CALL assert_true(v_count = 1, p_description);
END$$

-- ---------------------------------------------------------------------------
-- assert_index_exists: passes when the table has the named index
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS assert_index_exists$$
CREATE PROCEDURE assert_index_exists(
    IN p_table_name VARCHAR(255),
    IN p_index_name VARCHAR(255),
    IN p_description VARCHAR(500)
)
BEGIN
    DECLARE v_count INT DEFAULT 0;
    SELECT COUNT(*) INTO v_count
    FROM   INFORMATION_SCHEMA.STATISTICS
    WHERE  TABLE_SCHEMA = DATABASE()
      AND  TABLE_NAME   = p_table_name
      AND  INDEX_NAME   = p_index_name;

    CALL assert_true(v_count > 0, p_description);
END$$

-- ---------------------------------------------------------------------------
-- test_summary: prints totals and returns exit status via user variable
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_summary$$
CREATE PROCEDURE test_summary()
BEGIN
    DECLARE v_total_pass INT DEFAULT 0;
    DECLARE v_total_fail INT DEFAULT 0;

    SELECT COUNT(*) INTO v_total_pass FROM __test_results WHERE passed = TRUE;
    SELECT COUNT(*) INTO v_total_fail FROM __test_results WHERE passed = FALSE;

    SELECT '' AS '';
    SELECT CONCAT('Results: ', v_total_pass, ' passed, ',
                  v_total_fail, ' failed, ',
                  v_total_pass + v_total_fail, ' total') AS '';

    -- Show failed tests
    IF v_total_fail > 0 THEN
        SELECT '' AS '';
        SELECT 'FAILED TESTS:' AS '';
        SELECT CONCAT('  ', suite, ' > ', description, ' — ', IFNULL(message, '')) AS ''
        FROM   __test_results
        WHERE  passed = FALSE;
    END IF;

    SELECT '' AS '';
    IF v_total_fail = 0 THEN
        SELECT 'ALL TESTS PASSED ✓' AS '';
    ELSE
        SELECT CONCAT('TESTS FAILED ✗ (', v_total_fail, ' failures)') AS '';
    END IF;

    -- Store result for shell script to pick up
    SET @__test_exit_code = IF(v_total_fail > 0, 1, 0);
END$$

DELIMITER ;
