#!/usr/bin/env node
// =============================================================================
// FireISP 5.0 — Admin CLI
// =============================================================================
// Administrative command-line tools for user management, database health
// checks, and migration status.
//
// Usage:
//   node src/scripts/admin.js <command> [options]
//
// Commands:
//   create-user    --email <email> --password <password> [--role admin|support|billing|technician]
//   reset-password --email <email> --password <new-password>
//   list-users     [--role <role>] [--status active|inactive]
//   db-health      Check database connectivity and table counts
//   migration-status  Show applied vs pending migrations
// =============================================================================

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const path = require('path');
const fs = require('fs');

const SALT_ROUNDS = 12;
const COMMANDS = ['create-user', 'reset-password', 'list-users', 'db-health', 'migration-status'];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
      args[key] = val;
      if (val !== true) i++;
    }
  }
  return args;
}

// =============================================================================
// Commands
// =============================================================================

async function createUser(args) {
  if (!args.email || !args.password) {
    console.error('Usage: admin.js create-user --email <email> --password <password> [--role admin]');
    process.exit(1);
  }

  const role = args.role || 'admin';
  const validRoles = ['admin', 'support', 'billing', 'technician', 'readonly'];
  if (!validRoles.includes(role)) {
    console.error(`Invalid role "${role}". Must be one of: ${validRoles.join(', ')}`);
    process.exit(1);
  }

  if (args.password.length < 8) {
    console.error('Password must be at least 8 characters');
    process.exit(1);
  }

  // Check for existing user
  const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [args.email]);
  if (existing.length > 0) {
    console.error(`User with email "${args.email}" already exists (id=${existing[0].id})`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(args.password, SALT_ROUNDS);
  const [result] = await db.query(
    `INSERT INTO users (first_name, last_name, email, password_hash, role, status)
     VALUES (?, ?, ?, ?, ?, 'active')`,
    [args['first-name'] || 'Admin', args['last-name'] || 'User', args.email, passwordHash, role],
  );

  console.log('✓ User created successfully');
  console.log(`  ID:    ${result.insertId}`);
  console.log(`  Email: ${args.email}`);
  console.log(`  Role:  ${role}`);
}

async function resetPassword(args) {
  if (!args.email || !args.password) {
    console.error('Usage: admin.js reset-password --email <email> --password <new-password>');
    process.exit(1);
  }

  if (args.password.length < 8) {
    console.error('Password must be at least 8 characters');
    process.exit(1);
  }

  const [users] = await db.query('SELECT id FROM users WHERE email = ?', [args.email]);
  if (users.length === 0) {
    console.error(`No user found with email "${args.email}"`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(args.password, SALT_ROUNDS);
  await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, users[0].id]);

  // Invalidate all sessions
  await db.query('DELETE FROM user_sessions WHERE user_id = ?', [users[0].id]);

  console.log(`✓ Password reset for ${args.email} (id=${users[0].id})`);
  console.log('  All active sessions have been invalidated.');
}

async function listUsers(args) {
  let sql = 'SELECT id, first_name, last_name, email, role, status, last_login_at, created_at FROM users';
  const conditions = [];
  const params = [];

  if (args.role) {
    conditions.push('role = ?');
    params.push(args.role);
  }
  if (args.status) {
    conditions.push('status = ?');
    params.push(args.status);
  }

  if (conditions.length) sql += ` WHERE ${conditions.join(' AND ')}`;
  sql += ' ORDER BY id ASC';

  const [users] = await db.query(sql, params);

  if (users.length === 0) {
    console.log('No users found.');
    return;
  }

  console.log(`\n  ${'ID'.padEnd(6)} ${'Name'.padEnd(25)} ${'Email'.padEnd(30)} ${'Role'.padEnd(12)} ${'Status'.padEnd(10)} Last Login`);
  console.log(`  ${'─'.repeat(6)} ${'─'.repeat(25)} ${'─'.repeat(30)} ${'─'.repeat(12)} ${'─'.repeat(10)} ${'─'.repeat(20)}`);

  for (const u of users) {
    const name = `${u.first_name || ''} ${u.last_name || ''}`.trim();
    const lastLogin = u.last_login_at ? new Date(u.last_login_at).toISOString().slice(0, 16) : 'never';
    console.log(`  ${String(u.id).padEnd(6)} ${name.padEnd(25)} ${u.email.padEnd(30)} ${u.role.padEnd(12)} ${u.status.padEnd(10)} ${lastLogin}`);
  }

  console.log(`\n  Total: ${users.length} user(s)\n`);
}

async function dbHealth() {
  console.log('\n  FireISP 5.0 — Database Health Check\n');

  // 1. Connectivity
  const t0 = Date.now();
  try {
    await db.query('SELECT 1');
    console.log(`  ✓ Database connected (${Date.now() - t0}ms latency)`);
  } catch (err) {
    console.error(`  ✗ Database connection failed: ${err.message}`);
    process.exit(1);
  }

  // 2. Version
  const [versionRows] = await db.query('SELECT VERSION() AS version');
  console.log(`  ✓ MySQL version: ${versionRows[0].version}`);

  // 3. Event scheduler
  const [eventRows] = await db.query('SHOW VARIABLES LIKE \'event_scheduler\'');
  const eventScheduler = eventRows[0]?.Value || 'unknown';
  const eventIcon = eventScheduler === 'ON' ? '✓' : '✗';
  console.log(`  ${eventIcon} Event scheduler: ${eventScheduler}`);

  // 4. Table counts
  const [tables] = await db.query(
    `SELECT TABLE_NAME, TABLE_ROWS
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`,
  );
  console.log(`  ✓ Tables: ${tables.length}`);

  // 5. Key table row counts
  const keyTables = ['users', 'clients', 'contracts', 'invoices', 'payments', 'devices', 'tickets'];
  console.log('\n  Key Table Row Counts:');
  for (const tbl of keyTables) {
    try {
      const [rows] = await db.query(`SELECT COUNT(*) AS cnt FROM \`${tbl}\``);
      console.log(`    ${tbl.padEnd(20)} ${rows[0].cnt}`);
    } catch (_err) {
      console.log(`    ${tbl.padEnd(20)} (table not found)`);
    }
  }

  // 6. Database size
  const [sizeRows] = await db.query(
    `SELECT ROUND(SUM(DATA_LENGTH + INDEX_LENGTH) / 1048576, 2) AS size_mb
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()`,
  );
  console.log(`\n  ✓ Database size: ${sizeRows[0].size_mb || 0} MB\n`);
}

async function migrationStatus() {
  console.log('\n  FireISP 5.0 — Migration Status\n');

  // Count migration files
  const migrationsDir = path.resolve(__dirname, '../../database/migrations');
  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`  Migration files found: ${migrationFiles.length}`);

  // Check schema_migrations table
  try {
    const [applied] = await db.query(
      'SELECT filename, applied_at FROM schema_migrations ORDER BY id',
    );

    console.log(`  Migrations applied:   ${applied.length}`);
    const pending = migrationFiles.filter(
      f => !applied.some(a => a.filename === f),
    );

    if (pending.length === 0) {
      console.log('  ✓ All migrations are up to date.\n');
    } else {
      console.log(`  ✗ Pending migrations: ${pending.length}\n`);
      for (const p of pending) {
        console.log(`    → ${p}`);
      }
      console.log('\n  Run `npm run migrate` to apply pending migrations.\n');
    }

    // Show last 5 applied
    if (applied.length > 0) {
      console.log('  Last 5 applied:');
      const recent = applied.slice(-5);
      for (const m of recent) {
        const date = new Date(m.applied_at).toISOString().slice(0, 16);
        console.log(`    ${date}  ${m.filename}`);
      }
      console.log('');
    }
  } catch (_err) {
    console.log('  ✗ schema_migrations table not found — run `npm run migrate` first.\n');
  }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const command = process.argv[2];
  const args = parseArgs(process.argv.slice(3));

  if (!command || command === '--help' || command === '-h') {
    console.log(`
  FireISP 5.0 — Admin CLI

  Usage: node src/scripts/admin.js <command> [options]

  Commands:
    create-user        Create a new user
      --email <email>        (required) User email
      --password <password>  (required) User password (min 8 chars)
      --role <role>          User role (admin|support|billing|technician|readonly)
      --first-name <name>    First name (default: Admin)
      --last-name <name>     Last name (default: User)

    reset-password     Reset a user's password
      --email <email>        (required) User email
      --password <password>  (required) New password (min 8 chars)

    list-users         List all users
      --role <role>          Filter by role
      --status <status>      Filter by status (active|inactive)

    db-health          Check database connectivity and statistics

    migration-status   Show migration status (applied vs pending)
`);
    process.exit(0);
  }

  if (!COMMANDS.includes(command)) {
    console.error(`Unknown command: "${command}". Available: ${COMMANDS.join(', ')}`);
    process.exit(1);
  }

  try {
    switch (command) {
      case 'create-user':
        await createUser(args);
        break;
      case 'reset-password':
        await resetPassword(args);
        break;
      case 'list-users':
        await listUsers(args);
        break;
      case 'db-health':
        await dbHealth();
        break;
      case 'migration-status':
        await migrationStatus();
        break;
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  } finally {
    await db.close();
  }
}

main();
