'use strict';
// =============================================================================
// FireISP 5.0 — production pulls its image, it does not build one
// =============================================================================
// The production host used to compile the app on every deploy. The in-image
// frontend build (gen:api + a whole-program `tsc --noEmit` over 376 files +
// Vite) peaks around 1.43 GB RSS, and `up -d --build` ran it while the entire
// stack was still resident. On a box whose floor already includes two 512 MB
// InnoDB buffer pools, the kernel evicted cold pages into swap to make room;
// because the database is small those pages were never read again, so swap
// ratcheted up every deploy and never drained — until the machine thrashed
// hard enough to lock out SSH and need a reboot.
//
// These assertions are cheap and the failure they prevent is expensive and
// slow to diagnose (it presents as "the VPS gets stuck", days later, with no
// error attributable to the deploy that caused it).
// =============================================================================

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const prod = yaml.load(read('docker-compose.prod.yml'));

describe('the production compose file pulls the app image', () => {
  it('declares an image and NO build block for app', () => {
    expect(prod.services.app.image).toBeTruthy();
    // The regression: someone re-adds `build:` "so it picks up local changes".
    // That single line restores the whole failure mode.
    expect(prod.services.app.build).toBeUndefined();
  });

  it('points at the registry the cosign policies verify', () => {
    // k8s/cosign-policy.yaml and charts/.../cosign-policy.yaml both glob
    // ghcr.io/vothalvino/fireisp5.0:* — an image published anywhere else would
    // deploy fine and then fail signature verification in cluster installs.
    expect(prod.services.app.image).toContain('ghcr.io/vothalvino/fireisp5.0');
  });

  it('lets the tag be pinned, and defaults to latest when it is not', () => {
    // redeploy.sh pins FIREISP_IMAGE to the exact commit, which is what makes
    // `docker ps` and `git rev-parse HEAD` agree and rollback a tag change.
    expect(prod.services.app.image).toMatch(/^\$\{FIREISP_IMAGE:-/);
    expect(prod.services.app.image).toMatch(/:latest\}$/);
  });
});

describe('the build path still exists, just not in production', () => {
  const build = yaml.load(read('docker-compose.build.yml'));

  it('the override restores a build block for air-gapped/unmerged builds', () => {
    expect(build.services.app.build.context).toBe('.');
    expect(build.services.app.build.dockerfile).toBe('Dockerfile');
  });

  it('caps the frontend build heap so an oversized typecheck fails cleanly', () => {
    // Without a cap V8 grows until the machine says no, and on a small host
    // that means the kernel picks a victim rather than the build failing.
    expect(build.services.app.build.args.FRONTEND_BUILD_HEAP_MB).toMatch(/FRONTEND_BUILD_HEAP_MB/);
    expect(read('Dockerfile')).toMatch(/ARG FRONTEND_BUILD_HEAP_MB/);
    expect(read('Dockerfile')).toMatch(/max-old-space-size=\$\{FRONTEND_BUILD_HEAP_MB\}/);
  });
});

describe('redeploy.sh pulls and never builds', () => {
  const script = read('redeploy.sh');

  it('pulls the image', () => {
    expect(script).toMatch(/dc pull app/);
  });

  it('never passes --build or --no-cache', () => {
    expect(script).not.toMatch(/--build\b/);
    expect(script).not.toMatch(/--no-cache/);
  });

  it('pins the tag to the checked-out commit', () => {
    // Not :latest — otherwise the running image and the checked-out source can
    // silently diverge, which is exactly what makes a bad deploy hard to unpick.
    //
    // Asserted on the TAG ASSIGNMENT specifically. A looser `rev-parse HEAD`
    // match anywhere in the file passes even when the default is changed to
    // :latest, because the closing summary line also calls rev-parse.
    const tagLine = script.split('\n').find(l => l.trimStart().startsWith('TAG='));
    expect(tagLine).toBeDefined();
    expect(tagLine).toMatch(/rev-parse HEAD/);
    expect(tagLine).not.toMatch(/latest/);
    expect(script).toMatch(/export FIREISP_IMAGE=/);
  });

  it('reclaims superseded images, without touching tagged ones', () => {
    // The daemons hold resident metadata for every image they still know about,
    // which is what made the reboot interval SHRINK. `-a` would evict tagged
    // images too, including the one a rollback needs.
    expect(script).toMatch(/docker image prune -f/);
    expect(script).not.toMatch(/image prune\s+(-\w*a|--all)/);
  });
});

describe('the installer does not compile on the target box', () => {
  const install = read('install.sh');

  it('pulls instead of building', () => {
    expect(install).toMatch(/\$COMPOSE pull/);
    // Only the commented example of the deliberate build-override may mention it.
    const live = install.split('\n').filter(l => !l.trim().startsWith('#'));
    expect(live.some(l => l.includes('up -d --build'))).toBe(false);
  });
});

describe('CI publishes only what it scanned', () => {
  const ci = yaml.load(read('.github/workflows/ci.yml'));
  const steps = ci.jobs['container-scan'].steps;
  const idx = (needle) => steps.findIndex(s => (s.name || '').includes(needle));

  it('can write packages', () => {
    expect(ci.jobs['container-scan'].permissions.packages).toBe('write');
  });

  it('pushes AFTER the blocking vulnerability scan', () => {
    const scan = idx('Trivy (blocking)');
    const push = idx('Push the scanned image');
    expect(scan).toBeGreaterThanOrEqual(0);
    expect(push).toBeGreaterThan(scan);
  });

  it('builds once and pushes those same tags, so the scanned bytes are the shipped bytes', () => {
    const build = steps[idx('Build Docker image')];
    expect(build.with.push).toBe(false);   // loaded locally for the scan first
    expect(build.with.load).toBe(true);
    expect(build.with.tags).toContain('RELEASE_IMAGE');
  });
});
