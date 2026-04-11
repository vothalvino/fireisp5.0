// =============================================================================
// FireISP 5.0 — Backup Script Tests
// =============================================================================

const fs = require('fs');
const path = require('path');
const { rotate } = require('../src/scripts/backup');

describe('backup rotate', () => {
  const backupDir = path.resolve(__dirname, '../storage/backups');

  beforeEach(() => {
    // Ensure clean state — remove any test .sql.gz files
    if (fs.existsSync(backupDir)) {
      for (const f of fs.readdirSync(backupDir).filter(f => f.endsWith('.sql.gz'))) {
        fs.unlinkSync(path.join(backupDir, f));
      }
    }
  });

  afterEach(() => {
    // Clean up test files
    if (fs.existsSync(backupDir)) {
      for (const f of fs.readdirSync(backupDir).filter(f => f.endsWith('.sql.gz'))) {
        fs.unlinkSync(path.join(backupDir, f));
      }
    }
  });

  test('rotate removes oldest files when exceeding max', () => {
    // Create 10 fake backup files (MAX_BACKUPS defaults to 7)
    for (let i = 0; i < 10; i++) {
      const name = `fireisp_2025-01-${String(i + 1).padStart(2, '0')}T00-00-00.sql.gz`;
      fs.writeFileSync(path.join(backupDir, name), 'test');
    }

    // Verify 10 exist
    const before = fs.readdirSync(backupDir).filter(f => f.endsWith('.sql.gz'));
    expect(before.length).toBe(10);

    rotate();

    const after = fs.readdirSync(backupDir).filter(f => f.endsWith('.sql.gz'));
    expect(after.length).toBe(7);

    // Should keep the newest 7 (sorted alphabetically, last 7)
    expect(after[0]).toBe('fireisp_2025-01-04T00-00-00.sql.gz');
    expect(after[6]).toBe('fireisp_2025-01-10T00-00-00.sql.gz');
  });

  test('rotate does nothing when under limit', () => {
    // Create 3 files
    for (let i = 0; i < 3; i++) {
      const name = `fireisp_2025-02-${String(i + 1).padStart(2, '0')}T00-00-00.sql.gz`;
      fs.writeFileSync(path.join(backupDir, name), 'test');
    }

    rotate();

    const after = fs.readdirSync(backupDir).filter(f => f.endsWith('.sql.gz'));
    expect(after.length).toBe(3);
  });
});
