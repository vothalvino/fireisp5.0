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
//   create-user    --email <email> [--role admin|support|billing|technician|readonly]
//   reset-password --email <email>
//   list-users     [--role <role>] [--status active|inactive]
//   db-health      Check database connectivity and table counts
//   migration-status  Show applied vs pending migrations
//
// THE PASSWORD IS NEVER A COMMAND-LINE ARGUMENT. It is read from the
// FIREISP_ADMIN_PASSWORD environment variable, or prompted for interactively.
//
// NOT `ADMIN_PASSWORD`: seed.js already owns that name for the INITIAL password
// of the seeded admin account, install.sh writes it into .env.prod, and the app
// container loads that file. Reusing it would make `reset-password` run inside
// the container — which is exactly where an operator would run it — silently
// reset the account to the seed password instead of prompting.
//
// The old `--password <pw>` flag put the value in this process's argv, and
// /proc/<pid>/cmdline is mode 0444, so every local account on the box could read
// it for as long as the command ran. It is still accepted so existing scripts do
// not break, but it warns loudly.
// =============================================================================

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const logger = require('../utils/logger').child({ script: 'admin' });

const SALT_ROUNDS = 12;
const COMMANDS = ['create-user', 'reset-password', 'list-users', 'db-health', 'migration-status'];

/**
 * Prompt for a password without echoing it.
 *
 * Muting is done by intercepting the writes readline makes while the question
 * is open, rather than by putting the TTY in raw mode by hand — raw mode has to
 * be undone on every exit path, and a missed one leaves the operator with a
 * terminal that no longer echoes.
 */
function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    const realWrite = rl.output.write.bind(rl.output);
    rl.output.write = (chunk, ...rest) => (muted ? true : realWrite(chunk, ...rest));
    rl.question(question, (answer) => {
      rl.output.write = realWrite;
      rl.output.write('\n');
      rl.close();
      resolve(answer);
    });
    muted = true;
  });
}

/**
 * Resolve the password for a command, preferring channels that never reach argv.
 *
 * Order: FIREISP_ADMIN_PASSWORD (environment — /proc/<pid>/environ is 0400,
 * owner only) → interactive prompt → the deprecated flag, which works but warns.
 */
async function resolvePassword(args, { confirm = false } = {}) {
  if (process.env.FIREISP_ADMIN_PASSWORD) return process.env.FIREISP_ADMIN_PASSWORD;

  if (args.password && args.password !== true) {
    logger.warn(
      'The --password flag puts the password in this process\'s command line, which every '
      + 'local account can read from /proc/<pid>/cmdline. Use FIREISP_ADMIN_PASSWORD=... instead, '
      + 'or omit it and be prompted.',
    );
    return args.password;
  }

  if (!process.stdin.isTTY) {
    logger.error('No password supplied. Set FIREISP_ADMIN_PASSWORD in the environment, or run this attached to a terminal to be prompted.');
    process.exit(1);
  }

  const password = await promptHidden('Password: ');
  if (confirm) {
    const again = await promptHidden('Confirm password: ');
    if (again !== password) {
      logger.error('Passwords did not match');
      process.exit(1);
    }
  }
  return password;
}

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
  if (!args.email) {
    logger.error('Usage: FIREISP_ADMIN_PASSWORD=<password> admin.js create-user --email <email> [--role admin]');
    process.exit(1);
  }

  const role = args.role || 'admin';
  const validRoles = ['admin', 'support', 'billing', 'technician', 'readonly'];
  if (!validRoles.includes(role)) {
    logger.error({ role, validRoles: validRoles.join(', ') }, 'Invalid role');
    process.exit(1);
  }

  // Check for an existing user BEFORE asking for a password, so the operator is
  // not prompted for a secret only to be told the account already exists.
  const [existing] = await db.query('SELECT id FROM users WHERE email = ? AND deleted_at IS NULL', [args.email]);
  if (existing.length > 0) {
    logger.error({ email: args.email, existingId: existing[0].id }, 'User already exists');
    process.exit(1);
  }

  const password = await resolvePassword(args, { confirm: true });
  if (password.length < 8) {
    logger.error('Password must be at least 8 characters');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const [result] = await db.query(
    `INSERT INTO users (first_name, last_name, email, password_hash, role, group_id, status)
     VALUES (?, ?, ?, ?, ?, (SELECT id FROM roles WHERE name = ? AND deleted_at IS NULL LIMIT 1), 'active')`,
    [args['first-name'] || 'Admin', args['last-name'] || 'User', args.email, passwordHash, role, role],
  );

  logger.info({ id: result.insertId, email: args.email, role }, 'User created successfully');
}

async function resetPassword(args) {
  if (!args.email) {
    logger.error('Usage: FIREISP_ADMIN_PASSWORD=<new-password> admin.js reset-password --email <email>');
    process.exit(1);
  }

  // Resolve the user first: no point prompting for a new password for an
  // account that does not exist.
  const [users] = await db.query('SELECT id FROM users WHERE email = ? AND deleted_at IS NULL', [args.email]);
  if (users.length === 0) {
    logger.error({ email: args.email }, 'No user found with email');
    process.exit(1);
  }

  const password = await resolvePassword(args, { confirm: true });
  if (password.length < 8) {
    logger.error('Password must be at least 8 characters');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, users[0].id]);

  // Invalidate all sessions
  await db.query('DELETE FROM user_sessions WHERE user_id = ?', [users[0].id]);

  logger.info({ email: args.email, id: users[0].id }, 'Password reset');
  logger.info('All active sessions have been invalidated.');
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
    logger.info('No users found.');
    return;
  }

  logger.info(`\n  ${'ID'.padEnd(6)} ${'Name'.padEnd(25)} ${'Email'.padEnd(30)} ${'Role'.padEnd(12)} ${'Status'.padEnd(10)} Last Login`);
  logger.info(`  ${'─'.repeat(6)} ${'─'.repeat(25)} ${'─'.repeat(30)} ${'─'.repeat(12)} ${'─'.repeat(10)} ${'─'.repeat(20)}`);

  for (const u of users) {
    const name = `${u.first_name || ''} ${u.last_name || ''}`.trim();
    const lastLogin = u.last_login_at ? new Date(u.last_login_at).toISOString().slice(0, 16) : 'never';
    logger.info(`  ${String(u.id).padEnd(6)} ${name.padEnd(25)} ${u.email.padEnd(30)} ${u.role.padEnd(12)} ${u.status.padEnd(10)} ${lastLogin}`);
  }

  logger.info({ total: users.length }, 'Users listed');
}

async function dbHealth() {
  logger.info('FireISP 5.0 — Database Health Check');

  // 1. Connectivity
  const t0 = Date.now();
  try {
    await db.query('SELECT 1');
    logger.info({ latencyMs: Date.now() - t0 }, 'Database connected');
  } catch (err) {
    logger.error({ err }, 'Database connection failed');
    process.exit(1);
  }

  // 2. Version
  const [versionRows] = await db.query('SELECT VERSION() AS version');
  logger.info({ version: versionRows[0].version }, 'MySQL version');

  // 3. Event scheduler
  const [eventRows] = await db.query('SHOW VARIABLES LIKE \'event_scheduler\'');
  const eventScheduler = eventRows[0]?.Value || 'unknown';
  logger.info({ eventScheduler }, 'Event scheduler status');

  // 4. Table counts
  const [tables] = await db.query(
    `SELECT TABLE_NAME, TABLE_ROWS
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`,
  );
  logger.info({ tableCount: tables.length }, 'Tables');

  // 5. Key table row counts
  const keyTables = ['users', 'clients', 'contracts', 'invoices', 'payments', 'devices', 'tickets'];
  logger.info('Key Table Row Counts:');
  for (const tbl of keyTables) {
    try {
      const [rows] = await db.query(`SELECT COUNT(*) AS cnt FROM \`${tbl}\``);
      logger.info({ table: tbl, count: rows[0].cnt }, 'Table row count');
    } catch (_err) {
      logger.info({ table: tbl }, 'Table not found');
    }
  }

  // 6. Database size
  const [sizeRows] = await db.query(
    `SELECT ROUND(SUM(DATA_LENGTH + INDEX_LENGTH) / 1048576, 2) AS size_mb
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()`,
  );
  logger.info({ sizeMB: sizeRows[0].size_mb || 0 }, 'Database size');
}

async function migrationStatus() {
  logger.info('FireISP 5.0 — Migration Status');

  // Count migration files
  const migrationsDir = path.resolve(__dirname, '../../database/migrations');
  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  logger.info({ count: migrationFiles.length }, 'Migration files found');

  // Check schema_migrations table
  try {
    const [applied] = await db.query(
      'SELECT filename, applied_at FROM schema_migrations ORDER BY id',
    );

    logger.info({ count: applied.length }, 'Migrations applied');
    const pending = migrationFiles.filter(
      f => !applied.some(a => a.filename === f),
    );

    if (pending.length === 0) {
      logger.info('All migrations are up to date.');
    } else {
      logger.info({ count: pending.length }, 'Pending migrations');
      for (const p of pending) {
        logger.info({ file: p }, 'Pending migration');
      }
      logger.info('Run `npm run migrate` to apply pending migrations.');
    }

    // Show last 5 applied
    if (applied.length > 0) {
      logger.info('Last 5 applied:');
      const recent = applied.slice(-5);
      for (const m of recent) {
        const date = new Date(m.applied_at).toISOString().slice(0, 16);
        logger.info({ date, filename: m.filename }, 'Applied migration');
      }
    }
  } catch (_err) {
    logger.info('schema_migrations table not found — run `npm run migrate` first.');
  }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const command = process.argv[2];
  const args = parseArgs(process.argv.slice(3));

  if (!command || command === '--help' || command === '-h') {
    logger.info(`
  FireISP 5.0 — Admin CLI

  Usage: node src/scripts/admin.js <command> [options]

  Commands:
    create-user        Create a new user
      --email <email>        (required) User email
      --role <role>          User role (admin|support|billing|technician|readonly)
      --first-name <name>    First name (default: Admin)
      --last-name <name>     Last name (default: User)

    reset-password     Reset a user's password
      --email <email>        (required) User email

  THE PASSWORD (min 8 chars) IS NOT A FLAG. Supply it as the
  FIREISP_ADMIN_PASSWORD environment variable (NOT ADMIN_PASSWORD — that one is
  the seeded admin's initial password and lives in .env.prod), or omit it and
  you will be prompted without echo:

      FIREISP_ADMIN_PASSWORD='...' node src/scripts/admin.js create-user --email a@b.c
      node src/scripts/admin.js reset-password --email a@b.c        # prompts

  A command line is readable by every local account via /proc/<pid>/cmdline,
  which is why --password is deprecated; it still works but warns.

    list-users         List all users
      --role <role>          Filter by role
      --status <status>      Filter by status (active|inactive)

    db-health          Check database connectivity and statistics

    migration-status   Show migration status (applied vs pending)
`);
    process.exit(0);
  }

  if (!COMMANDS.includes(command)) {
    logger.error({ command, available: COMMANDS.join(', ') }, 'Unknown command');
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
    logger.error({ err }, 'Error');
    process.exit(1);
  } finally {
    await db.close();
  }
}

main();
