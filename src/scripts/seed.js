// =============================================================================
// FireISP 5.0 — Development Seed Script
// =============================================================================
// Inserts sample data for development/testing: an organization, admin user,
// a few clients, plans, and contracts. Safe to re-run — uses INSERT IGNORE.
//
// Usage:  node src/scripts/seed.js
//         npm run seed
// =============================================================================

require('dotenv').config();
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const db = require('../config/database');
const logger = require('../utils/logger').child({ script: 'seed' });

async function seed() {
  const pool = mysql.createPool({
    ...db.baseConnectionConfig,
    waitForConnections: true,
    connectionLimit: 1,
    multipleStatements: true,
  });

  let conn;
  try {
    conn = await pool.getConnection();

    // 1. Organization
    logger.info('Seeding organization...');
    await conn.execute(`
      INSERT IGNORE INTO organizations (id, name, locale, country, status)
      VALUES (1, 'Demo ISP', 'global', 'US', 'active')
    `);

    // 2. Admin user — password is read from the ADMIN_PASSWORD env var (set by
    //    install.sh for production). Falls back to 'admin123!' for local dev/testing.
    //    The plaintext is never stored; only the bcrypt hash is written to the DB.
    logger.info('Seeding admin user...');
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123!';
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    await conn.execute(`
      INSERT IGNORE INTO users (id, first_name, last_name, email, password_hash, role, organization_id, status)
      VALUES (1, 'Admin', 'User', 'admin@demo-isp.com', ?, 'admin', 1, 'active')
    `, [passwordHash]);

    // Organization-user membership
    await conn.execute(`
      INSERT IGNORE INTO organization_users (organization_id, user_id, role)
      VALUES (1, 1, 'owner')
    `);

    // 3. Sites
    logger.info('Seeding sites...');
    await conn.execute(`
      INSERT IGNORE INTO sites (id, organization_id, name, site_type, address, city, state, zip_code, country, status)
      VALUES
        (1, 1, 'Main Office', 'pop', '123 Network Ave', 'Austin', 'TX', '78701', 'US', 'active'),
        (2, 1, 'North Tower', 'tower', '456 Fiber Rd', 'Austin', 'TX', '78702', 'US', 'active')
    `);

    // 4. Plans
    logger.info('Seeding plans...');
    await conn.execute(`
      INSERT IGNORE INTO plans (id, organization_id, name, download_speed, upload_speed, price, currency, billing_cycle, status)
      VALUES
        (1, 1, 'Basic 50 Mbps',   50,  10,  29.99, 'USD', 'monthly', 'active'),
        (2, 1, 'Standard 100 Mbps', 100, 25,  49.99, 'USD', 'monthly', 'active'),
        (3, 1, 'Premium 300 Mbps',  300, 50,  79.99, 'USD', 'monthly', 'active'),
        (4, 1, 'Business 500 Mbps', 500, 100, 149.99, 'USD', 'monthly', 'active')
    `);

    // 5. Clients
    logger.info('Seeding clients...');
    await conn.execute(`
      INSERT IGNORE INTO clients (id, organization_id, name, email, phone, client_type, status, city, state, country)
      VALUES
        (1, 1, 'John Doe',      'john@example.com',    '+15551234567', 'personal', 'active', 'Austin', 'TX', 'US'),
        (2, 1, 'Jane Smith',    'jane@example.com',    '+15559876543', 'personal', 'active', 'Austin', 'TX', 'US'),
        (3, 1, 'Acme Corp',     'billing@acme.com',    '+15555551234', 'company',  'active', 'Austin', 'TX', 'US'),
        (4, 1, 'Bob Wilson',    'bob@example.com',     '+15551112222', 'personal', 'active', 'Austin', 'TX', 'US'),
        (5, 1, 'Alice Johnson', 'alice@example.com',   '+15553334444', 'personal', 'active', 'Austin', 'TX', 'US')
    `);

    // 6. Contracts
    logger.info('Seeding contracts...');
    await conn.execute(`
      INSERT IGNORE INTO contracts (id, client_id, plan_id, site_id, start_date, status, connection_type)
      VALUES
        (1, 1, 1, 1, '2025-01-01', 'active', 'pppoe'),
        (2, 2, 2, 1, '2025-02-01', 'active', 'pppoe'),
        (3, 3, 4, 2, '2025-01-15', 'active', 'static'),
        (4, 4, 3, 1, '2025-03-01', 'active', 'pppoe'),
        (5, 5, 1, 2, '2025-04-01', 'active', 'static')
    `);

    // 7. Devices
    logger.info('Seeding devices...');
    await conn.execute(`
      INSERT IGNORE INTO devices (id, site_id, category, name, ip_address, type, status, snmp_enabled)
      VALUES
        (1, 1, 'pop', 'Core Router',     '10.0.0.1',   'router',  'online', 1),
        (2, 1, 'pop', 'Access Switch 1', '10.0.0.2',   'switch',  'online', 1),
        (3, 2, 'pop', 'North AP',        '10.0.1.1',   'ptmp_ap', 'online', 1),
        (4, 2, 'pop', 'North OLT',       '10.0.1.2',   'olt',     'online', 1)
    `);

    // 8. NAS (RADIUS)
    logger.info('Seeding NAS...');
    await conn.execute(`
      INSERT IGNORE INTO nas (id, name, ip_address, secret, type, status)
      VALUES
        (1, 'Main NAS', '10.0.0.1', 'testing123', 'mikrotik', 'active')
    `);

    // 9. A couple of tickets
    logger.info('Seeding tickets...');
    await conn.execute(`
      INSERT IGNORE INTO tickets (id, client_id, title, description, status, priority)
      VALUES
        (1, 1, 'Slow internet speeds', 'Customer reports download speed below 20 Mbps during peak hours', 'open', 'high'),
        (2, 3, 'New office connection', 'Need to set up a second connection at the new Acme Corp office', 'open', 'medium')
    `);

    logger.info('Seed data inserted successfully.');
    logger.info({ email: 'admin@demo-isp.com' }, 'Demo admin account ready');
  } finally {
    if (conn) conn.release();
    await pool.end();
    await db.close();
  }
}

// Run when invoked directly
if (require.main === module) {
  logger.info('FireISP 5.0 — Seeding development data...');
  seed()
    .then(() => {
      logger.info('Done.');
      process.exit(0);
    })
    .catch(err => {
      logger.error({ err }, 'Seed failed');
      process.exit(1);
    });
}

module.exports = { seed };
