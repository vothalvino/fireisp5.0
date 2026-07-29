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

  it('never INVOKES a build', () => {
    // Targets invocation lines, not prose: the failure message legitimately
    // tells an ARM operator the build-override command to run by hand, and a
    // blanket text ban would forbid documenting the one supported escape hatch.
    const invocations = script
      .split('\n')
      .filter(l => /^\s*(dc|docker compose|\$COMPOSE)\b/.test(l));
    expect(invocations.length).toBeGreaterThan(0);
    for (const line of invocations) {
      expect(line).not.toMatch(/--build\b/);
      expect(line).not.toMatch(/--no-cache/);
    }
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

  it('accepts the rollback target as an ARGUMENT, ahead of the env var', () => {
    // `sudo` resets the environment by default, so `FIREISP_IMAGE_TAG=x sudo
    // redeploy` is silently discarded and the script falls through to HEAD —
    // redeploying the newest build, i.e. the thing being rolled back FROM, and
    // exiting 0. An argument cannot be stripped, so it must come first.
    const tagLine = script.split('\n').find(l => l.trimStart().startsWith('TAG='));
    expect(tagLine).toMatch(/^\s*TAG="\$\{1:-/);
  });

  it('enforces a retention policy, because a plain prune is inert here', () => {
    // Every pulled image carries a unique :<sha> tag, so NOTHING is ever
    // dangling and `docker image prune` alone reclaims zero. The retained set
    // would grow by one image per deploy forever — which is what grows the
    // daemons' resident metadata and shrinks the interval between wedges.
    expect(script).toMatch(/KEEP_IMAGES=/);
    expect(script).toMatch(/docker rmi/);
    expect(script).toMatch(/tail -n "\+\$\{KEEP_IMAGES\}"/);
    // `-a` would evict tagged images including the rollback target.
    expect(script).not.toMatch(/image prune\s+(-\w*a|--all)/);
  });

  it('waits for the container before migrating', () => {
    // Pulling is fast, so the race the old multi-minute build hid is now real:
    // `exec` against a crash-looping image fails with a bare "container is not
    // running", which reads as tooling trouble rather than a bad deploy.
    // Anchored on the INVOCATION line, not the first textual occurrence —
    // "migrate.js" also appears in the header comment explaining the rollback
    // semantics, which sits above everything and would pass trivially.
    const lines = script.split('\n');
    const migrateAt = lines.findIndex(l => /^\s*dc exec .*migrate\.js/.test(l));
    const waitAt = lines.findIndex(l => l.includes('become responsive'));
    expect(migrateAt).toBeGreaterThanOrEqual(0);
    expect(waitAt).toBeGreaterThanOrEqual(0);
    expect(migrateAt).toBeGreaterThan(waitAt);
  });
});

describe('the installer does not compile on the target box', () => {
  const install = read('install.sh');

  it('pulls the published image on the platform it is published for', () => {
    expect(install).toMatch(/\$COMPOSE pull/);
  });

  it('falls back to a source build ONLY behind an architecture check', () => {
    // The published image is amd64-only, and `install.sh` runs under `set -e`
    // AFTER the TLS certificate is issued — so an unmatched manifest on an ARM
    // VPS would abort the install and push the operator into a retry loop that
    // burns Let's Encrypt's 5/week duplicate-cert limit on something no retry
    // can fix. A build fallback is correct here; an UNGUARDED build is the
    // regression, because it puts a 1.43 GB compile back on the target box.
    const live = install.split('\n').filter(l => !l.trim().startsWith('#'));
    const archAt = live.findIndex(l => l.includes('uname -m'));
    expect(archAt).toBeGreaterThanOrEqual(0);

    live.forEach((line, i) => {
      if (line.includes('up -d --build')) {
        expect(i).toBeGreaterThan(archAt);
      }
    });
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

  it('fails main when no image was produced, instead of passing quietly', () => {
    // The Docker Hub warm step is continue-on-error so a third-party outage
    // cannot red a PR. On main that is now wrong: production pulls what this
    // job publishes, so "green" has to mean "an image exists". Otherwise a
    // commit lands with no image, redeploy fails on the pull, and the operator
    // is sent to an Actions page showing a green tick.
    const guard = steps.find(s => (s.name || '').includes('produced no image'));
    expect(guard).toBeDefined();
    expect(guard.if).toContain("refs/heads/main");
    expect(guard.if).toContain("outcome != 'success'");
    expect(guard.run).toContain('exit 1');
  });

  it('builds once and pushes those same tags, so the scanned bytes are the shipped bytes', () => {
    const build = steps[idx('Build Docker image')];
    expect(build.with.push).toBe(false);   // loaded locally for the scan first
    expect(build.with.load).toBe(true);
    expect(build.with.tags).toContain('RELEASE_IMAGE');
  });
});

describe('k8s and Helm point at the image that is actually published', () => {
  // These defaulted to `fireisp/fireisp`, which resolves to
  // docker.io/fireisp/fireisp — a namespace this project does not control, so a
  // squatter there would have been pulled and run. Worse, the cosign policies
  // shipped alongside glob ghcr.io/vothalvino/fireisp5.0:*, so they never
  // matched the deployed image and the signature check bought nothing.
  const REGISTRY = 'ghcr.io/vothalvino/fireisp5.0';

  it('the k8s Deployment uses the published image', () => {
    const dep = yaml.load(read('k8s/deployment.yaml'));
    const img = dep.spec.template.spec.containers[0].image;
    expect(img).toContain(REGISTRY);
  });

  it('the Helm chart defaults to the published image', () => {
    expect(yaml.load(read('charts/fireisp/values.yaml')).image.repository).toBe(REGISTRY);
  });

  it('the cosign policies verify that same path', () => {
    for (const f of ['k8s/cosign-policy.yaml', 'charts/fireisp/templates/cosign-policy.yaml']) {
      expect(read(f)).toContain(REGISTRY);
    }
  });
});
