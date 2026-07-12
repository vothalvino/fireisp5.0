// =============================================================================
// FireISP 5.0 — Permission seed coverage (Pattern G regression guard)
// =============================================================================
// Every slug passed to requirePermission() must have a `permissions` row seeded
// by a migration. rbac.js resolves permissions by exact-name lookup against
// role_permissions, so an unseeded slug 403s every account except legacy
// users.role='admin' — silently. Migration 377 backfilled 126 such slugs; this
// test fails the build if a new route ships a slug without its seed.
//
// Pure file parsing — no DB, no app boot.
// =============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function listFiles(dir, ext) {
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .map((f) => path.join(dir, f));
}

function usedSlugs() {
  const dirs = ['src/routes', 'src/middleware', 'src/controllers'];
  const used = new Map(); // slug -> [files]
  for (const dir of dirs) {
    for (const file of listFiles(path.join(ROOT, dir), '.js')) {
      const txt = fs.readFileSync(file, 'utf8');
      for (const call of txt.matchAll(/requirePermission\(([^)]*)\)/g)) {
        for (const [, slug] of call[1].matchAll(/'([A-Za-z0-9_.]+)'/g)) {
          if (!used.has(slug)) used.set(slug, []);
          used.get(slug).push(path.relative(ROOT, file));
        }
      }
    }
  }
  return used;
}

function seededSlugs() {
  const seeded = new Set();
  for (const file of listFiles(path.join(ROOT, 'database/migrations'), '.sql')) {
    const txt = fs.readFileSync(file, 'utf8');
    // Style A (119/205): INSERT [IGNORE] INTO permissions (...) VALUES ('slug', ...), ...
    for (const block of txt.matchAll(/INSERT\s+(?:IGNORE\s+)?INTO\s+permissions\s*\([^)]*\)\s*VALUES([\s\S]*?);/gi)) {
      for (const [, slug] of block[1].matchAll(/\(\s*'([A-Za-z0-9_.]+)'/g)) {
        seeded.add(slug);
      }
    }
    // Style B (321/335/377): INSERT INTO permissions (...) SELECT 'slug', ...
    for (const m of txt.matchAll(/INSERT\s+(?:IGNORE\s+)?INTO\s+permissions\s*\([^)]*\)\s*SELECT\s*'([A-Za-z0-9_.]+)'/gi)) {
      seeded.add(m[1]);
    }
  }
  return seeded;
}

describe('permission seed coverage', () => {
  const used = usedSlugs();
  const seeded = seededSlugs();

  test('sanity: parsers found a realistic number of slugs', () => {
    expect(used.size).toBeGreaterThan(500);
    expect(seeded.size).toBeGreaterThan(500);
  });

  test('every requirePermission slug is module-namespaced (module.action)', () => {
    const malformed = [...used.keys()].filter((s) => !/^[a-z0-9_]+(\.[a-z0-9_]+)+$/.test(s));
    expect(malformed).toEqual([]);
  });

  test('every requirePermission slug is seeded by a migration', () => {
    const missing = [...used.entries()]
      .filter(([slug]) => !seeded.has(slug))
      .map(([slug, files]) => `${slug} (used in ${[...new Set(files)].join(', ')})`);
    expect(missing).toEqual([]);
  });
});
