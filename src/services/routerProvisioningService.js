// =============================================================================
// FireISP 5.0 — Router Provisioning Service (direct RouterOS API)
// =============================================================================
// Pushes provisioning DIRECTLY to a MikroTik RouterOS device over its binary
// API (no FireRelay/proxy agent). Builds a RouterOS connection descriptor from
// a NAS row (decrypting the stored API password) and delegates to the low-level
// routerosService client.
//
// Per-NAS API connection is configurable:
//   nas.ip_address            — RouterOS host
//   nas.api_port              — API port (defaults to ros.DEFAULT_PORT / 8728)
//   nas.api_username          — API username
//   nas.api_password_encrypted— AES-256-GCM encrypted API password
//   nas.api_use_tls           — use api-ssl (TLS) transport
// =============================================================================

const ros = require('./routerosService');
const { decrypt } = require('../utils/encryption');
const { ValidationError } = require('../utils/errors');
const logger = require('../utils/logger').child({ service: 'routerProvisioningService' });

// =============================================================================
// Connection descriptor
// =============================================================================

/**
 * Build a RouterOS connection descriptor from a NAS row.
 *
 * @param {object} nas
 * @param {string} nas.ip_address
 * @param {number} [nas.api_port]
 * @param {string} nas.api_username
 * @param {string} [nas.api_password_encrypted]
 * @param {boolean|number} [nas.api_use_tls]
 * @returns {{ host: string, port: number, user: string, password: string,
 *            secure: boolean, timeoutMs: number }}
 */
function nasToConn(nas) {
  // Report the specific missing field so the operator fixes the right one.
  if (!nas || !nas.ip_address) {
    throw new ValidationError('NAS has no IP address configured');
  }
  if (!nas.api_username) {
    throw new ValidationError('NAS has no RouterOS API username configured');
  }

  return {
    host: nas.ip_address,
    // Honor an explicit api_port; when unset, default to the api-ssl port (8729)
    // for TLS connections and the plain API port (8728) otherwise.
    port: nas.api_port || (nas.api_use_tls ? ros.DEFAULT_TLS_PORT : ros.DEFAULT_PORT),
    user: nas.api_username,
    password: decrypt(nas.api_password_encrypted) || '',
    secure: !!nas.api_use_tls,
    timeoutMs: 12000,
  };
}

// =============================================================================
// Operations
// =============================================================================

/**
 * Open a connection to the NAS and read basic system info to confirm the API
 * is reachable and the credentials are valid.
 *
 * Connection errors are allowed to propagate so the calling route can map them
 * to an HTTP 502 (ROUTER_UNREACHABLE).
 *
 * @param {object} nas
 * @returns {Promise<{ ok: true, host: string, port: number, tls: boolean,
 *                     version: string, boardName: string, identity: string }>}
 */
async function testConnection(nas) {
  const conn = nasToConn(nas);
  const client = await ros.createClient(conn);

  try {
    let version = '';
    let boardName = '';
    let identity = '';

    const resSentences = await client.run(['/system/resource/print']);
    for (const sentence of resSentences) {
      if (sentence[0] === '!re') {
        const attrs = ros.parseAttrs(sentence.slice(1));
        version = attrs.version || version;
        boardName = attrs['board-name'] || boardName;
      }
    }

    // Identity is best-effort — don't fail the whole probe if it errors.
    try {
      const idSentences = await client.run(['/system/identity/print']);
      for (const sentence of idSentences) {
        if (sentence[0] === '!re') {
          const attrs = ros.parseAttrs(sentence.slice(1));
          identity = attrs.name || identity;
        }
      }
    } catch (err) {
      logger.warn({ host: conn.host, err: err.message }, 'RouterOS identity probe failed (ignored)');
    }

    logger.info(
      { host: conn.host, port: conn.port, tls: conn.secure, version, boardName, identity },
      'RouterOS test-connection succeeded',
    );

    return {
      ok: true,
      host: conn.host,
      port: conn.port,
      tls: conn.secure,
      version,
      boardName,
      identity,
    };
  } finally {
    await client.close();
  }
}

/**
 * Create-or-update a PPPoE subscriber secret on the NAS.
 *
 * @param {object} nas
 * @param {{ username: string, password: string, profile?: string, comment?: string }} sub
 * @returns {Promise<{ id: string, created: boolean, updated: boolean }>}
 */
async function pushSubscriber(nas, { username, password, profile, comment }) {
  const conn = nasToConn(nas);
  return ros.pppoeUpsert(conn, {
    name: username,
    secretPassword: password,
    profile,
    comment,
    service: 'pppoe',
  });
}

// =============================================================================
// Device seeding (one-click bootstrap)
// =============================================================================
// Configures a fresh MikroTik so it works as a FireISP-managed BNG/NAS:
//   • RADIUS client pointing at FireISP's embedded RADIUS (service=ppp)
//   • PPP AAA (use-radius + accounting + interim-update)
//   • RADIUS incoming (CoA / Disconnect-Message listener)
//   • optional global queue-tree skeleton (parent HTB nodes for total bw)
//   • optional suspended-subscriber walled-garden firewall hook
//
// Every managed object carries a `fireisp-*` comment so re-running is idempotent
// and non-destructive: we look the object up by its tag and `set` it in place,
// or `add` it if absent. Nothing is ever removed. Per-step errors are captured
// (not thrown) so a partial failure still returns a useful report.
// =============================================================================

// Comment tag prefix marking every FireISP-managed object on the router.
const SEED_TAG = 'fireisp';

/**
 * Read the first `!re` row under a device-global singleton path (e.g. /ppp/aaa,
 * /radius/incoming) and return its attributes, or `{}` when there is no row.
 */
async function readFirst(client, basePath) {
  const sentences = await client.run([`${basePath}/print`]);
  for (const sentence of sentences) {
    if (sentence[0] === '!re') return ros.parseAttrs(sentence.slice(1));
  }
  return {};
}

/**
 * Normalise a rate value to a RouterOS limit string. A bare number (or numeric
 * string) is treated as Mbps and suffixed with `M`; anything else (e.g. "1G",
 * "500k") is passed through unchanged.
 */
function normalizeRate(value) {
  if (value === undefined || value === null || value === '') return null;
  // A zero cap means "no limit intended" → skip. We must NOT emit max-limit=0,
  // which RouterOS interprets as UNLIMITED (the opposite of the operator's intent).
  if (typeof value === 'number') return value === 0 ? null : `${value}M`;
  const str = String(value).trim();
  if (str === '' || /^0+$/.test(str)) return null;
  return /^\d+$/.test(str) ? `${str}M` : str;
}

/**
 * Upsert (set-if-tagged, else add) a single object identified by a comment tag.
 *
 * `addOnlyWords` are applied ONLY on the create (`/add`) path. Use them for
 * arguments that are invalid on `/set` (e.g. `place-before`) or that must not be
 * re-applied on a re-run (e.g. `disabled=yes`, which would otherwise re-disable a
 * rule the admin has since enabled).
 */
async function upsertByComment(client, basePath, comment, attrWords, addOnlyWords = []) {
  const id = await ros.findId(client, basePath, [`?comment=${comment}`]);
  if (id) {
    await client.run([`${basePath}/set`, `=.id=${id}`, ...attrWords]);
    return 'updated';
  }
  await client.run([`${basePath}/add`, ...attrWords, ...addOnlyWords]);
  return 'created';
}

/**
 * Seed a MikroTik NAS with the FireISP RADIUS/PPP/QoS bootstrap.
 *
 * Idempotent and non-destructive — safe to re-run. Connection/credential
 * problems propagate (so the route can map them to 422 / 502); per-command
 * RouterOS errors are captured into the step report rather than thrown.
 *
 * @param {object} nas  NAS row (provides ip/api credentials + RADIUS `secret`)
 * @param {object} [opts]
 * @param {string}  opts.radiusAddress      Address the router uses to reach FireISP's RADIUS (required)
 * @param {number} [opts.authPort=1812]
 * @param {number} [opts.acctPort=1813]
 * @param {number} [opts.coaPort]           CoA listener port (defaults to nas.coa_port || 3799)
 * @param {string} [opts.interimUpdate='5m']
 * @param {boolean}[opts.seedQueueTree=false]
 * @param {string} [opts.queueParent='global']
 * @param {number} [opts.totalDownloadMbps]
 * @param {number} [opts.totalUploadMbps]
 * @param {boolean}[opts.seedWalledGarden=false]
 * @param {string} [opts.suspendedListName='fireisp-suspended']
 * @param {string} [opts.portalAddress]     If set, lays down a (disabled) HTTP redirect-to-portal NAT rule
 * @returns {Promise<{ ok: boolean, host: string, port: number, tls: boolean,
 *                     steps: Array<{ step: string, status: string, detail: string }> }>}
 */
async function seedDevice(nas, opts = {}) {
  const {
    radiusAddress,
    authPort = 1812,
    acctPort = 1813,
    coaPort = nas.coa_port || 3799,
    interimUpdate = '5m',
    seedQueueTree = false,
    queueParent = 'global',
    totalDownloadMbps,
    totalUploadMbps,
    seedWalledGarden = false,
    suspendedListName = `${SEED_TAG}-suspended`,
    portalAddress,
  } = opts;

  // Pre-flight validation — these become a 422 (misconfiguration), not "unreachable".
  // Trim once and use the trimmed value everywhere it's pushed to the device, so a
  // stray space (from a direct API caller that skips the frontend) can't end up in
  // the RADIUS server address.
  const radiusAddr = String(radiusAddress ?? '').trim();
  if (!radiusAddr) {
    throw new ValidationError('radiusAddress is required to seed the RADIUS client');
  }
  const portalAddr = portalAddress ? String(portalAddress).trim() : '';
  if (!nas.secret) {
    throw new ValidationError('NAS has no RADIUS shared secret to push — set the secret on the NAS first');
  }

  const conn = nasToConn(nas);
  const client = await ros.createClient(conn);

  const steps = [];
  const record = (step, status, detail) => steps.push({ step, status, detail });
  // Run one managed operation, capturing RouterOS errors into the report so a
  // single failed command never aborts the rest of the bootstrap.
  const step = async (name, detail, fn) => {
    try {
      const out = await fn();
      // fn may return a bare status string, or `{ status, detail }` to refine the
      // recorded detail (e.g. note what a singleton's previous value was).
      if (out && typeof out === 'object') {
        record(name, out.status, out.detail !== undefined && out.detail !== null ? out.detail : detail);
      } else {
        record(name, out, detail);
      }
    } catch (err) {
      // A lost/unreachable connection is NOT a per-command failure — abort the
      // whole bootstrap and let it propagate so the route maps it to a 502
      // ROUTER_UNREACHABLE instead of a misleading "success with errors".
      if (err && err.routerUnreachable) throw err;
      record(name, 'error', err.message);
    }
  };

  try {
    // ── 1. RADIUS client → FireISP embedded RADIUS (service=ppp) ──────────────
    await step('radius-client', `RADIUS client → ${radiusAddr} (service=ppp, auth ${authPort}/acct ${acctPort})`, () =>
      upsertByComment(client, '/radius', `${SEED_TAG}-radius`, [
        '=service=ppp',
        `=address=${radiusAddr}`,
        `=secret=${nas.secret}`,
        `=authentication-port=${authPort}`,
        `=accounting-port=${acctPort}`,
        `=comment=${SEED_TAG}-radius`,
      ]));

    // ── 2. RADIUS incoming (CoA / Disconnect-Message listener) ────────────────
    // /radius/incoming is a device-global singleton with no comment tag, so read
    // it first: skip the write when it already matches, and surface the prior
    // value when we overwrite it (e.g. another CoA controller's port).
    await step('radius-incoming', `CoA/Disconnect listener accept=yes port=${coaPort}`, async () => {
      const prev = await readFirst(client, '/radius/incoming');
      // The API returns accept as "true"/"false" (not the CLI's yes/no) — read it
      // through ros.rosBool so the idempotency short-circuit actually fires.
      if (ros.rosBool(prev.accept) && String(prev.port) === String(coaPort)) {
        return { status: 'unchanged', detail: `CoA listener already accept=yes port=${coaPort}` };
      }
      await client.run(['/radius/incoming/set', '=accept=yes', `=port=${coaPort}`]);
      const had = prev.accept !== undefined || prev.port !== undefined;
      const was = had ? ` (was accept=${ros.rosBool(prev.accept) ? 'yes' : 'no'} port=${prev.port || '-'})` : '';
      return { status: 'updated', detail: `CoA/Disconnect listener accept=yes port=${coaPort}${was}` };
    });

    // ── 3. PPP AAA — authenticate + account PPPoE via RADIUS ──────────────────
    // /ppp/aaa is also a device-global singleton — read before write so a re-run
    // reports 'unchanged', and flag when we override a deliberate accounting=no.
    await step('ppp-aaa', `PPP AAA use-radius=yes accounting=yes interim-update=${interimUpdate}`, async () => {
      const prev = await readFirst(client, '/ppp/aaa');
      // use-radius/accounting come back as "true"/"false" from the API (not the
      // CLI's yes/no) — interpret via ros.rosBool so 'unchanged' can fire.
      const already = ros.rosBool(prev['use-radius'])
        && ros.rosBool(prev.accounting)
        && String(prev['interim-update']) === String(interimUpdate);
      if (already) {
        return { status: 'unchanged', detail: `PPP AAA already use-radius=yes accounting=yes interim-update=${interimUpdate}` };
      }
      await client.run(['/ppp/aaa/set', '=use-radius=yes', '=accounting=yes', `=interim-update=${interimUpdate}`]);
      // Only warn when accounting was explicitly off (present and false), so the
      // operator sees that the seed overrode a deliberate accounting=no.
      const note = (prev.accounting !== undefined && !ros.rosBool(prev.accounting)) ? ' (overrode accounting=no)' : '';
      return { status: 'updated', detail: `PPP AAA use-radius=yes accounting=yes interim-update=${interimUpdate}${note}` };
    });

    // ── 4. Global queue-tree skeleton (optional) ──────────────────────────────
    if (seedQueueTree) {
      const dl = normalizeRate(totalDownloadMbps);
      const ul = normalizeRate(totalUploadMbps);
      if (!dl && !ul) {
        record('queue-tree', 'skipped', 'no total download/upload bandwidth provided');
      } else {
        if (dl) {
          await step('queue-tree:download', `${SEED_TAG}-total-download parent=${queueParent} max-limit=${dl}`, () =>
            upsertByComment(client, '/queue/tree', `${SEED_TAG}-total-download`, [
              `=name=${SEED_TAG}-total-download`,
              `=parent=${queueParent}`,
              `=max-limit=${dl}`,
              `=comment=${SEED_TAG}-total-download`,
            ]));
        }
        if (ul) {
          await step('queue-tree:upload', `${SEED_TAG}-total-upload parent=${queueParent} max-limit=${ul}`, () =>
            upsertByComment(client, '/queue/tree', `${SEED_TAG}-total-upload`, [
              `=name=${SEED_TAG}-total-upload`,
              `=parent=${queueParent}`,
              `=max-limit=${ul}`,
              `=comment=${SEED_TAG}-total-upload`,
            ]));
        }
      }
    }

    // ── 5. Suspended-subscriber walled garden (optional) ──────────────────────
    if (seedWalledGarden) {
      // Forward reject for any source in the suspended address-list. This is the
      // hook the suspension flow targets by adding the subscriber IP to the list.
      await step('walled-garden:block', `forward reject src-address-list=${suspendedListName} (placed first)`, () =>
        upsertByComment(client, '/ip/firewall/filter', `${SEED_TAG}-suspended-block`, [
          '=chain=forward',
          `=src-address-list=${suspendedListName}`,
          '=action=reject',
          '=reject-with=icmp-network-unreachable',
          `=comment=${SEED_TAG}-suspended-block`,
        // Insert at the TOP of the forward chain on create so a pre-existing
        // accept/established rule can't shadow the reject (suspended traffic
        // would otherwise keep flowing). Only the new src-address-list is matched,
        // so this can't affect non-suspended subscribers.
        ], ['=place-before=0']));

      // Optional captive-portal redirect, laid down DISABLED — enabling + correct
      // rule ordering (allow the portal before the reject) is left to the admin.
      if (portalAddr) {
        await step('walled-garden:redirect', `dst-nat tcp/80 → ${portalAddr} (disabled on create — review ordering)`, () =>
          upsertByComment(client, '/ip/firewall/nat', `${SEED_TAG}-suspended-redirect`, [
            '=chain=dstnat',
            `=src-address-list=${suspendedListName}`,
            '=protocol=tcp',
            '=dst-port=80',
            '=action=dst-nat',
            `=to-addresses=${portalAddr}`,
            `=comment=${SEED_TAG}-suspended-redirect`,
          // Lay the rule down DISABLED on first create only. On a re-run we must
          // NOT re-send disabled=yes, or we'd silently turn off a redirect the
          // admin has since enabled (correct ordering is left to the admin).
          ], ['=disabled=yes']));
      }
    }
  } finally {
    await client.close();
  }

  const ok = steps.every((s) => s.status !== 'error');
  logger.info(
    { host: conn.host, port: conn.port, tls: conn.secure, ok, steps: steps.length },
    'RouterOS device seed complete',
  );
  return { ok, host: conn.host, port: conn.port, tls: conn.secure, steps };
}

module.exports = {
  nasToConn,
  testConnection,
  pushSubscriber,
  seedDevice,
};
