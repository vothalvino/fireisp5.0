#!/usr/bin/env bash
# =============================================================================
# FireISP 5.0 — Test Runner
# =============================================================================
# Runs all SQL test files against a MySQL database.
#
# Usage:
#   ./tests/run_tests.sh                          # use env vars for connection
#   ./tests/run_tests.sh -u root -p secret -d fireisp_test
#   MYSQL_HOST=127.0.0.1 MYSQL_PORT=3306 ./tests/run_tests.sh
#
# Environment variables:
#   MYSQL_HOST     — default: 127.0.0.1
#   MYSQL_PORT     — default: 3306
#   MYSQL_USER     — default: root
#   MYSQL_PASSWORD — default: (empty)
#   MYSQL_DATABASE — default: fireisp_test
#
# Prerequisites:
#   1. MySQL 8.0+ or MariaDB 10.6+ running
#   2. Database created:  CREATE DATABASE fireisp_test;
#   3. Schema applied:    mysql -u root fireisp_test < database/schema.sql
# =============================================================================

set -euo pipefail

# ---- Defaults ---------------------------------------------------------------
MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_USER="${MYSQL_USER:-root}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-}"
MYSQL_DATABASE="${MYSQL_DATABASE:-fireisp_test}"

# ---- Parse CLI args ---------------------------------------------------------
while getopts "h:P:u:p:d:" opt; do
    case $opt in
        h) MYSQL_HOST="$OPTARG"     ;;
        P) MYSQL_PORT="$OPTARG"     ;;
        u) MYSQL_USER="$OPTARG"     ;;
        p) MYSQL_PASSWORD="$OPTARG" ;;
        d) MYSQL_DATABASE="$OPTARG" ;;
        *) echo "Usage: $0 [-h host] [-P port] [-u user] [-p password] [-d database]"; exit 1 ;;
    esac
done

# ---- Build mysql command ----------------------------------------------------
MYSQL_CMD="mysql"
MYSQL_CMD+=" --host=${MYSQL_HOST}"
MYSQL_CMD+=" --port=${MYSQL_PORT}"
MYSQL_CMD+=" --user=${MYSQL_USER}"
if [ -n "$MYSQL_PASSWORD" ]; then
    MYSQL_CMD+=" --password=${MYSQL_PASSWORD}"
fi
MYSQL_CMD+=" --database=${MYSQL_DATABASE}"
MYSQL_CMD+=" --batch"
MYSQL_CMD+=" --verbose"

# ---- Resolve project root (relative to this script) -------------------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ---- Test files to run (in order) -------------------------------------------
TEST_FILES=(
    "tests/test_schema_integrity.sql"
    "tests/test_seed_data.sql"
    "tests/test_check_constraints.sql"
    "tests/test_unique_constraints.sql"
    "tests/test_referential_integrity.sql"
    "tests/test_triggers.sql"
)

# ---- Run tests --------------------------------------------------------------
echo "============================================="
echo " FireISP 5.0 — Database Test Suite"
echo "============================================="
echo " Host:     ${MYSQL_HOST}:${MYSQL_PORT}"
echo " Database: ${MYSQL_DATABASE}"
echo " User:     ${MYSQL_USER}"
echo "============================================="
echo ""

TOTAL_PASS=0
TOTAL_FAIL=0
FAILED_SUITES=()

for test_file in "${TEST_FILES[@]}"; do
    full_path="${PROJECT_ROOT}/${test_file}"

    if [ ! -f "$full_path" ]; then
        echo "WARNING: ${test_file} not found, skipping."
        continue
    fi

    echo "---------------------------------------------"
    echo "Running: ${test_file}"
    echo "---------------------------------------------"

    # Run the test file from the project root so SOURCE paths resolve
    cd "${PROJECT_ROOT}"
    output=$(${MYSQL_CMD} < "${full_path}" 2>&1) || true
    echo "$output"

    # Parse results from output (look for "Results: X passed, Y failed")
    result_line=$(echo "$output" | grep -oP 'Results: \K\d+ passed, \d+ failed' || echo "")
    if [ -n "$result_line" ]; then
        pass=$(echo "$result_line" | grep -oP '^\d+')
        fail=$(echo "$result_line" | grep -oP '\d+(?= failed)')
        TOTAL_PASS=$((TOTAL_PASS + pass))
        TOTAL_FAIL=$((TOTAL_FAIL + fail))
        if [ "$fail" -gt 0 ]; then
            FAILED_SUITES+=("$test_file")
        fi
    else
        echo "WARNING: Could not parse results from ${test_file}"
        FAILED_SUITES+=("$test_file (parse error)")
    fi

    echo ""
done

# ---- Summary ----------------------------------------------------------------
echo "============================================="
echo " OVERALL RESULTS"
echo "============================================="
echo " Passed: ${TOTAL_PASS}"
echo " Failed: ${TOTAL_FAIL}"
echo " Total:  $((TOTAL_PASS + TOTAL_FAIL))"
echo "============================================="

if [ ${#FAILED_SUITES[@]} -gt 0 ]; then
    echo ""
    echo "Failed suites:"
    for suite in "${FAILED_SUITES[@]}"; do
        echo "  ✗ ${suite}"
    done
    echo ""
    exit 1
else
    echo ""
    echo "All test suites passed ✓"
    echo ""
    exit 0
fi
