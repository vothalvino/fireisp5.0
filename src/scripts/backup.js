// =============================================================================
// FireISP 5.0 — Database Backup Script
// =============================================================================
// Creates a gzipped mysqldump backup in storage/backups/ with rotation.
// Keeps the last N backups (default 7) and removes older ones.
//
// Usage:  node src/scripts/backup.js
//         npm run backup
//
// Requires: mysqldump binary available in PATH (standard MySQL client tools).
// =============================================================================

require('dotenv').config();
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BACKUP_DIR = path.resolve(__dirname, '../../storage/backups');
const MAX_BACKUPS = parseInt(process.env.BACKUP_RETENTION || '7', 10);

function backup() {
  // Ensure backup directory exists
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const host = process.env.DB_HOST || '127.0.0.1';
  const port = process.env.DB_PORT || '3306';
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';
  const database = process.env.DB_NAME || 'fireisp';

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${database}_${timestamp}.sql.gz`;
  const filepath = path.join(BACKUP_DIR, filename);

  console.log(`  Creating backup: ${filename}`);

  // Build mysqldump command — pipe through gzip for compression
  const dumpCmd = [
    'mysqldump',
    `--host=${host}`,
    `--port=${port}`,
    `--user=${user}`,
    password ? `--password=${password}` : '',
    '--single-transaction',
    '--routines',
    '--triggers',
    '--events',
    database,
    `| gzip > ${filepath}`,
  ].filter(Boolean).join(' ');

  try {
    execSync(dumpCmd, { stdio: 'pipe', shell: true });
    const stats = fs.statSync(filepath);
    console.log(`  ✓ Backup created: ${filename} (${(stats.size / 1024).toFixed(1)} KB)`);
  } catch (err) {
    console.error(`  ✗ Backup failed: ${err.message}`);
    // Clean up partial file
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }
    throw err;
  }

  // Rotate old backups
  rotate();

  return filepath;
}

/**
 * Remove oldest backups if count exceeds MAX_BACKUPS.
 */
function rotate() {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.sql.gz'))
    .sort();

  if (files.length > MAX_BACKUPS) {
    const toRemove = files.slice(0, files.length - MAX_BACKUPS);
    for (const file of toRemove) {
      const fp = path.join(BACKUP_DIR, file);
      fs.unlinkSync(fp);
      console.log(`  Rotated: ${file}`);
    }
  }
}

// Run when invoked directly
if (require.main === module) {
  console.log('FireISP 5.0 — Creating database backup...');
  try {
    backup();
    console.log('Done.');
    process.exit(0);
  } catch (_err) {
    process.exit(1);
  }
}

module.exports = { backup, rotate };
