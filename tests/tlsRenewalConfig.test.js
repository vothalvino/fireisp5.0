'use strict';
// =============================================================================
// FireISP 5.0 — TLS renewal configuration consistency
// =============================================================================
// A static guard over deployment config, because the failure it prevents is
// invisible for 90 days and then takes the site down, and there is no container
// to exercise in CI.
//
// History worth keeping, because it is the reason these assertions exist:
//
//   * The renewal loop ran `certbot renew --quiet` under
//     `restart: unless-stopped`. A failing renewal printed nothing, restarted
//     forever, and raised no alert — the first symptom was an expired
//     certificate served to every visitor. (#538)
//   * Cloudflare DNS-01 support existed for issuance but the renewal image had
//     no plugin and the credentials were deleted right after issuance, so those
//     certificates could be ISSUED but never RENEWED. (#540)
//   * That DNS-01 support was then removed entirely as unused. (2026-07-26)
//
// The provider-specific code is gone; the trap it fell into is not. If DNS-01
// is ever reintroduced, `certbot renew` reads the authenticator back out of
// /etc/letsencrypt/renewal/<domain>.conf and needs BOTH the matching plugin in
// the renewal image AND the credentials still present at the recorded path.
// The last test below enforces that pairing generically, for any provider.
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
  expect(start).toBeGreaterThan(-1);
  const rest = compose.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z0-9_-]+:\s*\n/);
  const block = next === -1 ? rest : rest.slice(0, next + 1);
  expect(block.length).toBeGreaterThan(200);   // never assert against an empty block
  return block;
}

describe('renewal failures stay visible', () => {
  it('the renewal loop does not use --quiet', () => {
    // With --quiet a failing renewal printed nothing, the container kept
    // restarting, and nothing else watched TLS expiry.
    expect(certbotService()).not.toMatch(/certbot renew[^\n]*--quiet/);
  });

  it('the loop still runs on a schedule', () => {
    expect(certbotService()).toMatch(/certbot renew/);
    expect(certbotService()).toMatch(/sleep 12h/);
  });
});

describe('certbot images are pinned', () => {
  it('no certbot image anywhere is :latest', () => {
    const tags = [
      ...[...compose.matchAll(/certbot\/[a-z-]+:(\S+)/g)].map(m => m[1]),
      ...[...initScript.matchAll(/certbot\/[a-z-]+:(\S+)/g)].map(m => m[1]),
    ];
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      expect(tag).not.toBe('latest');
      expect(tag).toMatch(/^v?\d+\.\d+/);
    }
  });
});

describe('a DNS challenge, if ever reintroduced, must be renewable', () => {
  // Generic and provider-agnostic on purpose. DNS-01 support was removed as
  // unused, but the shape of the bug is easy to reintroduce for ANY provider:
  // wire up issuance, forget that renewal needs the same plugin and the same
  // credentials path, and ship something that works for 90 days.
  const dnsFlag = /--dns-([a-z0-9-]+)\b(?!-)/;

  it('issuing with --dns-<provider> requires a renewal image carrying that plugin', () => {
    const m = initScript.match(dnsFlag);
    if (!m) return;                       // no DNS challenge configured — nothing to check
    const provider = m[1];
    expect(certbotService()).toMatch(new RegExp(`image:\\s*certbot/dns-${provider}:`));
  });

  it('DNS credentials are kept, and live where the renewal container can read them', () => {
    if (!dnsFlag.test(initScript)) return;
    // Deleting them after issuance, or writing them outside the mounted
    // certificate store, both produce a silent failure 60-90 days later.
    expect(initScript).not.toMatch(/rm\s+-f\s+"\$[A-Z_]*INI"/);
    const creds = [...initScript.matchAll(/--dns-[a-z0-9-]+-credentials\s+(\S+)/g)].map(x => x[1]);
    for (const p of creds) expect(p.startsWith('/etc/letsencrypt/')).toBe(true);
    expect(certbotService()).toMatch(/letsencrypt:\/etc\/letsencrypt/);
  });
});
