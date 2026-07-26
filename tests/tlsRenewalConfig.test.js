'use strict';
// =============================================================================
// FireISP 5.0 — TLS renewal configuration consistency
// =============================================================================
// A static guard over deployment config, because the failure it prevents is
// invisible for 90 days and then takes the site down.
//
// init-letsencrypt.sh --cloudflare issues via DNS-01, the only option for a
// host that cannot accept inbound HTTP-01 validation. `certbot renew` reads the
// authenticator AND the credentials path back out of
// /etc/letsencrypt/renewal/<domain>.conf. So renewal only works if BOTH hold:
//
//   1. the renewal container's image contains the dns-cloudflare plugin, and
//   2. the credentials file still exists, at the path recorded at issuance.
//
// Break either and the certificate is issued fine, renews never, and expires
// silently three months later. That is exactly what this repo shipped until
// 2026-07-26: the plain certbot image, and an `rm -f` on the credentials
// immediately after issuance.
//
// Nothing else tests these files — there is no container to run in CI — so
// these assertions are the only thing standing between a config edit and a
// silent expiry on every self-hosted install.
// =============================================================================

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const compose = read('docker-compose.prod.yml');
const initScript = read('nginx/init-letsencrypt.sh');

/**
 * The certbot service block: from its key to the next 2-space-indented key, or
 * end of file. certbot is currently the LAST service, so the end-of-file case
 * is the live one — an earlier version of this helper required a following
 * service and silently returned '', which made every assertion vacuous.
 */
function certbotService() {
  const start = compose.indexOf('\n  certbot:\n');
  if (start === -1) return '';
  const rest = compose.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z0-9_-]+:\s*\n/);
  const block = next === -1 ? rest : rest.slice(0, next + 1);
  expect(block.length).toBeGreaterThan(200);   // never assert against an empty block
  return block;
}

describe('DNS-01 certificates must be renewable, not just issuable', () => {
  const svc = certbotService();

  it('the renewal image includes the Cloudflare plugin', () => {
    // certbot/dns-cloudflare is plain certbot PLUS the plugin, and renews
    // webroot certificates identically — one image covers both challenge types.
    expect(svc).toMatch(/image:\s*certbot\/dns-cloudflare:/);
    expect(svc).not.toMatch(/image:\s*certbot\/certbot:/);
  });

  it('every certbot image reference is pinned, never :latest', () => {
    const refs = [...compose.matchAll(/certbot\/[a-z-]+:(\S+)/g)].map(m => m[1]);
    const initRefs = [...initScript.matchAll(/certbot\/[a-z-]+:(\S+)/g)].map(m => m[1]);
    for (const tag of [...refs, ...initRefs]) {
      expect(tag).not.toBe('latest');
      expect(tag).toMatch(/^v?\d+\.\d+/);
    }
  });

  it('the issuance script does NOT delete the credentials it just wrote', () => {
    // `certbot renew` needs this file every 60-90 days, forever.
    expect(initScript).not.toMatch(/rm\s+-f\s+"\$CF_INI"/);
  });

  it('credentials are written inside the mounted certificate store', () => {
    // The renewal container mounts ./nginx/letsencrypt at /etc/letsencrypt.
    // Anything written outside that is invisible to `certbot renew`.
    expect(initScript).toMatch(/CF_INI="\$LE_DIR\/cloudflare\.ini"/);
    expect(svc).toMatch(/letsencrypt:\/etc\/letsencrypt/);
  });

  it('the credentials path passed at issuance is the one the renewal container sees', () => {
    // certbot writes this path verbatim into renewal/<domain>.conf and re-reads
    // it on every renew — a path that only exists during issuance breaks it.
    const flags = [...initScript.matchAll(/--dns-cloudflare-credentials\s+(\S+)/g)].map(m => m[1]);
    expect(flags.length).toBeGreaterThan(0);
    for (const p of flags) expect(p).toBe('/etc/letsencrypt/cloudflare.ini');
  });

  it('the credentials file is created 0600', () => {
    expect(initScript).toMatch(/chmod 600 "\$CF_INI"/);
  });
});

describe('renewal failures stay visible', () => {
  it('the renewal loop does not use --quiet', () => {
    // With --quiet a failing renewal printed nothing, `restart: unless-stopped`
    // kept it looping, and the first symptom was an expired certificate.
    expect(certbotService()).not.toMatch(/certbot renew[^\n]*--quiet/);
  });

  it('the loop still runs on a schedule', () => {
    expect(certbotService()).toMatch(/certbot renew/);
    expect(certbotService()).toMatch(/sleep 12h/);
  });
});
