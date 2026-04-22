// =============================================================================
// FireISP 5.0 — Load Test Fixture Seeder
// =============================================================================
// Inserts the realistic ISP workload fixture defined in roadmap item 4.1:
// 500 clients, 5000 invoices, 100 devices (plus the supporting org, admin
// user, site, plan, and contracts).
//
// Idempotent: rows are scoped to a dedicated load-test organization
// (slug: `loadtest-isp`). Re-running first wipes that organization and
// everything that references it, then re-inserts a fresh fixture.
//
// Usage:
//   node src/scripts/loadtest-seed.js
//   npm run loadtest:seed
//
// Configuration (env vars, all optional):
//   LOADTEST_CLIENTS   — number of clients to insert       (default 500)
//   LOADTEST_INVOICES  — number of invoices to insert      (default 5000)
//   LOADTEST_DEVICES   — number of devices to insert       (default 100)
//   LOADTEST_EMAIL     — admin email                       (default loadtest@fireisp.local)
//   LOADTEST_PASSWORD  — admin password                    (default loadtest123!)
// =============================================================================

require('dotenv').config();
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const db = require('../config/database');
const logger = require('../utils/logger').child({ script: 'loadtest-seed' });

const NUM_CLIENTS = parseInt(process.env.LOADTEST_CLIENTS, 10) || 500;
const NUM_INVOICES = parseInt(process.env.LOADTEST_INVOICES, 10) || 5000;
const NUM_DEVICES = parseInt(process.env.LOADTEST_DEVICES, 10) || 100;
const ADMIN_EMAIL = process.env.LOADTEST_EMAIL || 'loadtest@fireisp.local';
const ADMIN_PASSWORD = process.env.LOADTEST_PASSWORD || 'loadtest123!';

const ORG_NAME = 'Load Test ISP (4.1)';
const BATCH_SIZE = 500;

/**
 * Insert rows in chunks of BATCH_SIZE using a single multi-row INSERT per
 * chunk. `columns` is an array of column names; `rows` is an array of arrays
 * holding the values in the same order as `columns`.
 */
async function bulkInsert(conn, table, columns, rows) {
  if (rows.length === 0) return;
  const colList = columns.map(c => `\`${c}\``).join(', ');
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const placeholders = chunk
      .map(() => `(${columns.map(() => '?').join(', ')})`)
      .join(', ');
    const values = chunk.flat();
    await conn.query(
      `INSERT INTO ${table} (${colList}) VALUES ${placeholders}`,
      values,
    );
  }
}

async function seedLoadTestFixture() {
  const pool = mysql.createPool({
    ...db.baseConnectionConfig,
    waitForConnections: true,
    connectionLimit: 1,
    multipleStatements: false,
  });

  let conn;
  try {
    conn = await pool.getConnection();
    logger.info({ NUM_CLIENTS, NUM_INVOICES, NUM_DEVICES }, 'Seeding load-test fixture');

    // ------------------------------------------------------------------
    // 1. Wipe any previous load-test organization and its dependents
    // ------------------------------------------------------------------
    const [existing] = await conn.execute(
      'SELECT id FROM organizations WHERE name = ?',
      [ORG_NAME],
    );
    if (existing.length > 0) {
      const oldOrgId = existing[0].id;
      logger.info({ oldOrgId }, 'Removing previous load-test data');
      // Order matters because of FKs.
      await conn.execute(
        'DELETE i FROM invoices i JOIN clients c ON i.client_id = c.id WHERE c.organization_id = ?',
        [oldOrgId],
      );
      await conn.execute(
        'DELETE d FROM devices d LEFT JOIN sites s ON d.site_id = s.id WHERE s.organization_id = ? OR d.client_id IN (SELECT id FROM clients WHERE organization_id = ?)',
        [oldOrgId, oldOrgId],
      );
      await conn.execute(
        'DELETE FROM contracts WHERE client_id IN (SELECT id FROM clients WHERE organization_id = ?)',
        [oldOrgId],
      );
      await conn.execute(
        'DELETE FROM clients WHERE organization_id = ?',
        [oldOrgId],
      );
      await conn.execute(
        'DELETE FROM plans WHERE organization_id = ?',
        [oldOrgId],
      );
      await conn.execute(
        'DELETE FROM sites WHERE organization_id = ?',
        [oldOrgId],
      );
      await conn.execute(
        'DELETE FROM organization_users WHERE organization_id = ?',
        [oldOrgId],
      );
      await conn.execute(
        'DELETE FROM users WHERE organization_id = ?',
        [oldOrgId],
      );
      await conn.execute(
        'DELETE FROM organizations WHERE id = ?',
        [oldOrgId],
      );
    }

    // ------------------------------------------------------------------
    // 2. Organization + admin user (admin role bypasses RBAC)
    // ------------------------------------------------------------------
    const [orgResult] = await conn.execute(
      `INSERT INTO organizations (name, locale, country, status)
       VALUES (?, 'global', 'US', 'active')`,
      [ORG_NAME],
    );
    const organizationId = orgResult.insertId;
    logger.info({ organizationId }, 'Created organization');

    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    const [userResult] = await conn.execute(
      `INSERT INTO users (organization_id, first_name, last_name, email, password_hash, role, status)
       VALUES (?, 'Load', 'Tester', ?, ?, 'admin', 'active')`,
      [organizationId, ADMIN_EMAIL, passwordHash],
    );
    const adminUserId = userResult.insertId;
    await conn.execute(
      `INSERT INTO organization_users (organization_id, user_id, role)
       VALUES (?, ?, 'owner')`,
      [organizationId, adminUserId],
    );

    // ------------------------------------------------------------------
    // 3. Supporting site + plan + (one-per-client) contract scaffolding
    // ------------------------------------------------------------------
    const [siteResult] = await conn.execute(
      `INSERT INTO sites (organization_id, name, site_type, address, city, state, country, status)
       VALUES (?, 'Load Test POP', 'pop', '1 Load Way', 'Austin', 'TX', 'US', 'active')`,
      [organizationId],
    );
    const siteId = siteResult.insertId;

    const [planResult] = await conn.execute(
      `INSERT INTO plans (organization_id, name, download_speed, upload_speed, price, currency, billing_cycle, status)
       VALUES (?, 'LoadTest 100 Mbps', 100, 25, 49.99, 'USD', 'monthly', 'active')`,
      [organizationId],
    );
    const planId = planResult.insertId;

    // ------------------------------------------------------------------
    // 4. Clients (NUM_CLIENTS rows)
    // ------------------------------------------------------------------
    logger.info({ count: NUM_CLIENTS }, 'Inserting clients');
    const clientCols = ['organization_id', 'name', 'email', 'phone', 'client_type', 'status', 'city', 'state', 'country'];
    const clientRows = [];
    for (let i = 1; i <= NUM_CLIENTS; i++) {
      clientRows.push([
        organizationId,
        `Load Client ${i}`,
        `client${i}@loadtest.local`,
        `+1555${String(i).padStart(7, '0').slice(-7)}`,
        i % 10 === 0 ? 'company' : 'personal',
        'active',
        'Austin',
        'TX',
        'US',
      ]);
    }
    await bulkInsert(conn, 'clients', clientCols, clientRows);

    const [clientIdRows] = await conn.execute(
      'SELECT id FROM clients WHERE organization_id = ? ORDER BY id ASC',
      [organizationId],
    );
    const clientIds = clientIdRows.map(r => r.id);

    // ------------------------------------------------------------------
    // 5. Contracts (one per client — needed for invoice FK paths and to
    //    represent an "active service" for each client)
    // ------------------------------------------------------------------
    logger.info({ count: clientIds.length }, 'Inserting contracts');
    const contractCols = ['client_id', 'plan_id', 'site_id', 'start_date', 'status', 'connection_type', 'created_by'];
    const contractRows = clientIds.map(cid => [
      cid, planId, siteId, '2025-01-01', 'active', 'pppoe', adminUserId,
    ]);
    await bulkInsert(conn, 'contracts', contractCols, contractRows);

    const [contractIdRows] = await conn.execute(
      'SELECT id, client_id FROM contracts WHERE client_id IN (SELECT id FROM clients WHERE organization_id = ?) ORDER BY id ASC',
      [organizationId],
    );
    const contractByClient = new Map(contractIdRows.map(r => [r.client_id, r.id]));

    // ------------------------------------------------------------------
    // 6. Invoices (NUM_INVOICES rows distributed round-robin across clients)
    // ------------------------------------------------------------------
    logger.info({ count: NUM_INVOICES }, 'Inserting invoices');
    const invoiceCols = ['client_id', 'contract_id', 'invoice_number', 'issue_date', 'due_date', 'subtotal', 'tax_rate', 'tax_amount', 'total', 'status', 'created_by'];
    const invoiceRows = [];
    const statuses = ['draft', 'sent', 'paid', 'overdue'];
    for (let i = 1; i <= NUM_INVOICES; i++) {
      const clientId = clientIds[i % clientIds.length];
      const contractId = contractByClient.get(clientId);
      const subtotal = 49.99;
      const taxRate = 0.08;
      const tax = +(subtotal * taxRate).toFixed(2);
      invoiceRows.push([
        clientId,
        contractId,
        `LT-${String(i).padStart(7, '0')}`,
        '2025-03-01',
        '2025-03-15',
        subtotal,
        taxRate,
        tax,
        +(subtotal + tax).toFixed(2),
        statuses[i % statuses.length],
        adminUserId,
      ]);
    }
    await bulkInsert(conn, 'invoices', invoiceCols, invoiceRows);

    // ------------------------------------------------------------------
    // 7. Devices (NUM_DEVICES POP devices on the load-test site)
    // ------------------------------------------------------------------
    logger.info({ count: NUM_DEVICES }, 'Inserting devices');
    const deviceCols = ['site_id', 'category', 'name', 'type', 'manufacturer', 'model', 'mac_address', 'ip_address', 'snmp_enabled', 'status'];
    const deviceTypes = ['router', 'switch', 'ptp', 'ptmp_ap', 'olt'];
    const deviceRows = [];
    for (let i = 1; i <= NUM_DEVICES; i++) {
      const oct3 = Math.floor(i / 256);
      const oct4 = i % 256;
      const macTail = String(i).padStart(8, '0');
      deviceRows.push([
        siteId,
        'pop',
        `LT-Device-${String(i).padStart(3, '0')}`,
        deviceTypes[i % deviceTypes.length],
        'MikroTik',
        'CCR2004',
        `02:00:${macTail.slice(0, 2)}:${macTail.slice(2, 4)}:${macTail.slice(4, 6)}:${macTail.slice(6, 8)}`,
        `10.99.${oct3}.${oct4}`,
        1,
        'online',
      ]);
    }
    await bulkInsert(conn, 'devices', deviceCols, deviceRows);

    // ------------------------------------------------------------------
    // 8. Summary
    // ------------------------------------------------------------------
    const [[{ c: numClients }]] = await conn.query(
      'SELECT COUNT(*) AS c FROM clients WHERE organization_id = ?',
      [organizationId],
    );
    const [[{ c: numInvoices }]] = await conn.query(
      'SELECT COUNT(*) AS c FROM invoices i JOIN clients c ON i.client_id = c.id WHERE c.organization_id = ?',
      [organizationId],
    );
    const [[{ c: numDevices }]] = await conn.query(
      'SELECT COUNT(*) AS c FROM devices WHERE site_id = ?',
      [siteId],
    );

    logger.info({
      organizationId,
      adminEmail: ADMIN_EMAIL,
      clients: numClients,
      invoices: numInvoices,
      devices: numDevices,
    }, 'Load-test fixture ready');

    return { organizationId, adminEmail: ADMIN_EMAIL, adminPassword: ADMIN_PASSWORD };
  } finally {
    if (conn) conn.release();
    await pool.end();
    await db.close();
  }
}

if (require.main === module) {
  seedLoadTestFixture()
    .then(() => process.exit(0))
    .catch(err => {
      logger.error({ err }, 'Load-test seed failed');
      process.exit(1);
    });
}

module.exports = { seedLoadTestFixture };
