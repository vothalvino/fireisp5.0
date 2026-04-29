#!/usr/bin/env bash
# =============================================================================
# FireISP 5.0 — MySQL Replication Initialisation Script
# Runs once inside the db-replica container on first start.
#
# What it does:
#   1. Waits for the primary to be accepting connections
#   2. Creates the replication user on the primary (idempotent)
#   3. Points this replica at the primary using GTID auto-positioning
#
# Environment variables (set by docker-compose.prod.yml):
#   MYSQL_ROOT_PASSWORD  — password for the root user on both nodes
#   MYSQL_REPL_USER      — replication user to create (default: repl_user)
#   MYSQL_REPL_PASSWORD  — password for the replication user
# =============================================================================

set -euo pipefail

REPL_USER="${MYSQL_REPL_USER:-repl_user}"
REPL_PASS="${MYSQL_REPL_PASSWORD:?MYSQL_REPL_PASSWORD must be set}"
PRIMARY_HOST="db-primary"
PRIMARY_PORT=3306

echo "[init-replica] Waiting for primary at ${PRIMARY_HOST}:${PRIMARY_PORT} ..."
until mysqladmin ping -h "${PRIMARY_HOST}" -P "${PRIMARY_PORT}" \
      -u root -p"${MYSQL_ROOT_PASSWORD}" --silent 2>/dev/null; do
  echo "[init-replica] Primary not ready — sleeping 3s ..."
  sleep 3
done
echo "[init-replica] Primary is up."

# ── 1. Create the replication user on the PRIMARY (idempotent) ─────────────
echo "[init-replica] Creating replication user '${REPL_USER}' on primary ..."
mysql -h "${PRIMARY_HOST}" -P "${PRIMARY_PORT}" \
      -u root -p"${MYSQL_ROOT_PASSWORD}" --protocol=TCP <<-SQL
  CREATE USER IF NOT EXISTS '${REPL_USER}'@'%'
    IDENTIFIED WITH caching_sha2_password BY '${REPL_PASS}';
  GRANT REPLICATION SLAVE ON *.* TO '${REPL_USER}'@'%';
  FLUSH PRIVILEGES;
SQL

# ── 2. Point this replica at the primary using GTID auto-positioning ───────
echo "[init-replica] Configuring replica ..."
mysql -u root -p"${MYSQL_ROOT_PASSWORD}" --protocol=SOCKET <<-SQL
  STOP REPLICA;
  CHANGE REPLICATION SOURCE TO
    SOURCE_HOST      = '${PRIMARY_HOST}',
    SOURCE_PORT      = ${PRIMARY_PORT},
    SOURCE_USER      = '${REPL_USER}',
    SOURCE_PASSWORD  = '${REPL_PASS}',
    SOURCE_AUTO_POSITION = 1,
    GET_SOURCE_PUBLIC_KEY = 1;
  START REPLICA;
SQL

echo "[init-replica] Replication started. Checking status ..."
mysql -u root -p"${MYSQL_ROOT_PASSWORD}" --protocol=SOCKET \
      -e "SHOW REPLICA STATUS\G" | grep -E "(Replica_IO|Replica_SQL|Seconds_Behind)"

echo "[init-replica] Done."
