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

// Blueprint §4 — global priority-class simple-queue names. The numeric prefixes
// keep them ordered at the top of the simple-queue list (RouterOS evaluates
// simple queues top-to-bottom). Business (priority 2) out-ranks Residential (5).
const POP_LIMIT_NAME = '01-GLOBAL-POP-LIMIT';
const BUSINESS_CLASS_NAME = '02-BUSINESS-CLASS';
const RESIDENTIAL_CLASS_NAME = '03-RESIDENTIAL-CLASS';

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
 * Read the first `!re` row matching a query under `basePath` (e.g. a queue type
 * by name), returning its attributes or `null`. Unlike `readFirst`, this narrows
 * with a query so it targets one named row rather than a device-global singleton.
 */
async function readRow(client, basePath, queries = []) {
  const sentences = await client.run([`${basePath}/print`, ...queries]);
  for (const sentence of sentences) {
    if (sentence[0] === '!re') return ros.parseAttrs(sentence.slice(1));
  }
  return null;
}

/**
 * Upsert (set-if-present, else add) an object matched by NAME rather than by a
 * comment tag. Used for objects whose stable identity IS their name — the §4
 * priority-class simple queues and the base PPP profile — so a re-run updates the
 * existing named object instead of failing on RouterOS's "name already used".
 */
async function upsertByName(client, basePath, name, attrWords, addOnlyWords = []) {
  const id = await ros.findId(client, basePath, [`?name=${name}`]);
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
 * @param {number} [opts.totalDownloadMbps]   Also used as the §4 POP-limit download cap
 * @param {number} [opts.totalUploadMbps]     Also used as the §4 POP-limit upload cap
 * @param {boolean}[opts.seedQueueTypes=false]     §3 — set default/default-small queue kinds to fq-codel
 * @param {boolean}[opts.seedPriorityQueues=false] §4 — GLOBAL-POP-LIMIT → BUSINESS(2)/RESIDENTIAL(5) simple queues
 * @param {boolean}[opts.seedPppoeServer=false]    §2 — base PPP profile + pppoe-server on pppoeInterface
 * @param {string} [opts.pppoeInterface]           Required when seedPppoeServer (e.g. 'ether2')
 * @param {string} [opts.pppoeServiceName='FireISP-Internet']
 * @param {string} [opts.pppoeProfileName='fireisp-pppoe']
 * @param {string} [opts.pppoeLocalAddress]        PPP profile local-address (gateway IP)
 * @param {string} [opts.pppoeParentQueue]         PPP profile parent-queue (defaults to POP limit when §4 seeded)
 * @param {boolean}[opts.seedWalledGarden=false]
 * @param {string} [opts.suspendedListName='fireisp-suspended']
 * @param {string} [opts.portalAddress]     If set, lays down a redirect-to-portal NAT rule for the suspended list
 * @param {string} [opts.redirectPorts='80,443']   §5 — dst-ports the walled-garden redirect matches
 * @param {number} [opts.redirectToPort=80]        §5 — port the portal listens on (dst-nat to-ports)
 * @param {boolean}[opts.redirectEnabled=true]     §5 — lay the redirect down live (false = disabled on create)
 * @param {boolean}[opts.seedRealtimePriority=false] Realtime/VoIP priority: classify → DSCP EF → priority-1 queue
 * @param {string} [opts.sipRtpPorts='5060,5061,10000-20000'] UDP ports treated as SIP/RTP
 * @param {string} [opts.voipNetworks]              CIDRs (comma/space) added to the fireisp-voip address-list (OTT providers)
 * @param {boolean}[opts.trustClientDscp=false]     Also mark packets the client already tags DSCP EF (spoofable — capped)
 * @param {string} [opts.realtimeParent='global']   Parent for the priority-1 realtime queue-tree node
 * @param {number} [opts.realtimeMaxMbps]           Optional cap (Mbps) on the realtime queue — the anti-abuse limit
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
    seedQueueTypes = false,
    seedPriorityQueues = false,
    seedPppoeServer = false,
    pppoeInterface,
    pppoeServiceName = 'FireISP-Internet',
    pppoeProfileName = `${SEED_TAG}-pppoe`,
    pppoeLocalAddress,
    pppoeParentQueue,
    seedWalledGarden = false,
    suspendedListName = `${SEED_TAG}-suspended`,
    portalAddress,
    redirectPorts = '80,443',
    redirectToPort = 80,
    redirectEnabled = true,
    seedRealtimePriority = false,
    sipRtpPorts = '5060,5061,10000-20000',
    voipNetworks,
    trustClientDscp = false,
    realtimeParent = 'global',
    realtimeMaxMbps,
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

    // ── 5. Modern queue types — fq-codel (bufferbloat prevention, §3) ─────────
    // /queue/type is a device-global list; `default` and `default-small` are the
    // built-in kinds every dynamic/simple queue inherits. Flip both to fq-codel.
    if (seedQueueTypes) {
      for (const typeName of ['default', 'default-small']) {
        await step(`queue-type:${typeName}`, `${typeName} kind=fq-codel`, async () => {
          const row = await readRow(client, '/queue/type', [`?name=${typeName}`]);
          if (!row || !row['.id']) {
            return { status: 'skipped', detail: `built-in queue type "${typeName}" not present on device` };
          }
          // The API reports kind as a plain string; short-circuit when already set.
          if (String(row.kind || '').toLowerCase() === 'fq-codel') {
            return { status: 'unchanged', detail: `${typeName} already kind=fq-codel` };
          }
          await client.run(['/queue/type/set', `=.id=${row['.id']}`, '=kind=fq-codel']);
          return { status: 'updated', detail: `${typeName} kind=fq-codel (was ${row.kind || '?'})` };
        });
      }
    }

    // ── 6. Business/Residential priority simple queues (§4) ────────────────────
    // A master POP limit with two priority child classes. Business (priority 2)
    // wins contention over Residential (priority 5) under the shared POP cap. Rate
    // per subscriber still comes from RADIUS (Mikrotik-Rate-Limit); this is the
    // parent hierarchy those per-session queues (and the base PPP profile) hang under.
    if (seedPriorityQueues) {
      const popDl = normalizeRate(totalDownloadMbps);
      const popUl = normalizeRate(totalUploadMbps);
      if (!popDl && !popUl) {
        record('priority-queues', 'skipped', 'no total download/upload bandwidth provided for the POP limit');
      } else {
        // "<download>/<upload>"; fall back to whichever side was supplied so a
        // one-sided cap still forms a valid RouterOS rate pair.
        const popLimit = `${popDl || popUl}/${popUl || popDl}`;
        // priority on /queue/simple is a DUAL upload/download field (confirmed on ROS
        // 7.21: a single "=priority=2" is stored as "2/8", prioritising only one
        // direction). Send "2/2" / "5/5" so both directions are prioritised — the
        // blueprint form. target="" makes each node a pure HTB parent that shapes the
        // sum of its children rather than matching a target itself.
        await step('priority-queues:pop', `${POP_LIMIT_NAME} max-limit=${popLimit}`, () =>
          upsertByName(client, '/queue/simple', POP_LIMIT_NAME, [
            `=name=${POP_LIMIT_NAME}`,
            `=max-limit=${popLimit}`,
            '=target=',
            `=comment=${SEED_TAG}-pop-limit`,
          ]));
        await step('priority-queues:business', `${BUSINESS_CLASS_NAME} parent=${POP_LIMIT_NAME} priority=2/2`, () =>
          upsertByName(client, '/queue/simple', BUSINESS_CLASS_NAME, [
            `=name=${BUSINESS_CLASS_NAME}`,
            `=parent=${POP_LIMIT_NAME}`,
            `=max-limit=${popLimit}`,
            '=priority=2/2',
            '=target=',
            `=comment=${SEED_TAG}-business-class`,
          ]));
        await step('priority-queues:residential', `${RESIDENTIAL_CLASS_NAME} parent=${POP_LIMIT_NAME} priority=5/5`, () =>
          upsertByName(client, '/queue/simple', RESIDENTIAL_CLASS_NAME, [
            `=name=${RESIDENTIAL_CLASS_NAME}`,
            `=parent=${POP_LIMIT_NAME}`,
            `=max-limit=${popLimit}`,
            '=priority=5/5',
            '=target=',
            `=comment=${SEED_TAG}-residential-class`,
          ]));
      }
    }

    // ── 7. PPPoE server + base profile (§2) ────────────────────────────────────
    // A single base profile (rate/IP come from RADIUS per session; no per-plan
    // profile is needed) and one pppoe-server on the access interface. The profile's
    // parent-queue defaults to the §4 POP limit so dynamic sessions inherit it.
    if (seedPppoeServer) {
      const iface = String(pppoeInterface ?? '').trim();
      if (!iface) {
        record('pppoe-server', 'skipped', 'no PPPoE interface provided (set pppoeInterface, e.g. ether2)');
      } else {
        const profileName = String(pppoeProfileName || `${SEED_TAG}-pppoe`).trim();
        const serviceName = String(pppoeServiceName || 'FireISP-Internet').trim();
        const localAddr = pppoeLocalAddress ? String(pppoeLocalAddress).trim() : '';
        // Explicit parent-queue wins; otherwise hang sessions under the POP limit
        // ONLY when §4 actually creates it (flag set AND POP bandwidth provided).
        // Referencing a queue that was skipped would make RouterOS reject the whole
        // /ppp/profile/add — parent-queue is a validated object reference, not free text.
        const popLimitSeeded = seedPriorityQueues
          && !!(normalizeRate(totalDownloadMbps) || normalizeRate(totalUploadMbps));
        const parentQueue = (pppoeParentQueue && String(pppoeParentQueue).trim())
          || (popLimitSeeded ? POP_LIMIT_NAME : '');

        await step('pppoe-profile',
          `${profileName} change-tcp-mss=yes${localAddr ? ` local-address=${localAddr}` : ''}${parentQueue ? ` parent-queue=${parentQueue}` : ''}`,
          () => {
            const attrWords = [
              `=name=${profileName}`,
              '=change-tcp-mss=yes',
              `=comment=${SEED_TAG}-pppoe-profile`,
            ];
            if (localAddr) attrWords.push(`=local-address=${localAddr}`);
            if (parentQueue) attrWords.push(`=parent-queue=${parentQueue}`);
            return upsertByName(client, '/ppp/profile', profileName, attrWords);
          });

        await step('pppoe-server',
          `service-name=${serviceName} interface=${iface} default-profile=${profileName} disabled=no`,
          async () => {
            // A physical interface hosts one pppoe-server, so match by interface.
            const attrWords = [
              `=service-name=${serviceName}`,
              `=interface=${iface}`,
              `=default-profile=${profileName}`,
            ];
            const id = await ros.findId(client, '/interface/pppoe-server/server', [`?interface=${iface}`]);
            if (id) {
              // On a re-run, update config but do NOT re-toggle disabled — respect an
              // admin who deliberately took the server down.
              await client.run(['/interface/pppoe-server/server/set', `=.id=${id}`, ...attrWords]);
              return 'updated';
            }
            await client.run(['/interface/pppoe-server/server/add', ...attrWords, '=disabled=no']);
            return 'created';
          });
      }
    }

    // ── 8. Suspended-subscriber walled garden (optional) ──────────────────────
    if (seedWalledGarden) {
      const ports = String(redirectPorts || '80,443').trim();
      const toPort = redirectToPort || 80;
      const redirectOn = redirectEnabled !== false;
      // When an ENABLED redirect points at an OFF-router portal, the dst-nat'd portal
      // traffic still traverses the forward chain and would be dropped by the reject
      // below (leaving the portal unreachable). Spare portal-bound (post-NAT) traffic
      // by negating its destination on the reject so the captive portal stays reachable.
      const sparePortal = !!(portalAddr && redirectOn);

      // Forward reject for any source in the suspended address-list. This is the
      // hook the suspension flow targets by adding the subscriber IP to the list.
      await step('walled-garden:block',
        `forward reject src-address-list=${suspendedListName}${sparePortal ? ` (except → ${portalAddr})` : ''} (placed first)`,
        () => upsertByComment(client, '/ip/firewall/filter', `${SEED_TAG}-suspended-block`, [
          '=chain=forward',
          `=src-address-list=${suspendedListName}`,
          // Exempt the captive portal so the redirect above can actually reach it.
          ...(sparePortal ? [`=dst-address=!${portalAddr}`] : []),
          '=action=reject',
          '=reject-with=icmp-network-unreachable',
          `=comment=${SEED_TAG}-suspended-block`,
        // Insert at the TOP of the forward chain on create so a pre-existing
        // accept/established rule can't shadow the reject (suspended traffic
        // would otherwise keep flowing). Only the new src-address-list is matched,
        // so this can't affect non-suspended subscribers.
        ], ['=place-before=0']));

      // Captive-portal redirect for the suspended list. Blueprint §5 wants a
      // PERMANENT redirect on 80+443 → portal:80. Enabled by default; the operator
      // can opt into the conservative disabled-on-create path via redirectEnabled=false.
      // NOTE on 443: dst-nat'ing HTTPS to a plaintext portal breaks the TLS handshake
      // (cert mismatch) — the user still gets bounced to the portal, they just see a
      // browser warning first. The §5 block rule drops everything else fast.
      if (portalAddr) {
        const stateNote = redirectOn
          ? 'enabled — permanent walled garden'
          : 'disabled on create — review ordering before enabling';
        await step('walled-garden:redirect', `dst-nat tcp/${ports} → ${portalAddr}:${toPort} (${stateNote})`, () =>
          upsertByComment(client, '/ip/firewall/nat', `${SEED_TAG}-suspended-redirect`, [
            '=chain=dstnat',
            `=src-address-list=${suspendedListName}`,
            '=protocol=tcp',
            `=dst-port=${ports}`,
            '=action=dst-nat',
            `=to-addresses=${portalAddr}`,
            `=to-ports=${toPort}`,
            `=comment=${SEED_TAG}-suspended-redirect`,
          // When disabled is requested, lay it down disabled on FIRST CREATE only —
          // on a re-run we never re-send disabled, so an admin who has since enabled
          // (or disabled) the rule keeps their choice. When enabled (default), create
          // it live and likewise never re-toggle it.
          ], redirectOn ? [] : ['=disabled=yes']));
      }
    }

    // ── 9. Real-time (VoIP / calling) priority (optional) ──────────────────────
    // Classify real-time media, stamp DSCP EF, and give it a priority-1 queue so
    // calls stay crisp while the same subscriber saturates the link. Layers on top
    // of §3 fq-codel (the biggest low-latency win). RADIUS still governs per-plan
    // rate; this prioritises voice WITHIN each pipe. Encrypted OTT calls (WhatsApp,
    // FaceTime, Meet…) can't be matched by port — the operator-fillable fireisp-voip
    // address-list (provider netblocks) covers those; SIP/RTP is matched by port.
    if (seedRealtimePriority) {
      const RT_CONN = `${SEED_TAG}-rt-conn`;
      const RT_PKT = `${SEED_TAG}-realtime`;
      const VOIP_LIST = `${SEED_TAG}-voip`;
      const ports = String(sipRtpPorts || '5060,5061,10000-20000').trim();
      const rtParent = String(realtimeParent || 'global').trim();

      // (a) Seed operator-supplied OTT provider networks into the fireisp-voip list.
      const voipNets = String(voipNetworks || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
      for (const cidr of voipNets) {
        await step(`realtime:voip-list:${cidr}`, `address-list ${VOIP_LIST} += ${cidr}`, async () => {
          const existing = await ros.findId(client, '/ip/firewall/address-list', [`?list=${VOIP_LIST}`, `?address=${cidr}`]);
          if (existing) return { status: 'unchanged', detail: `${cidr} already in ${VOIP_LIST}` };
          await client.run(['/ip/firewall/address-list/add', `=list=${VOIP_LIST}`, `=address=${cidr}`, `=comment=${SEED_TAG}-voip`]);
          return { status: 'created', detail: `${cidr} → ${VOIP_LIST}` };
        });
      }

      // (b) Mangle: mark realtime CONNECTIONS by SIP/RTP ports, by voip-list membership
      //     (both directions), and — only if opted-in — by client-set DSCP EF.
      await step('realtime:mark-ports', `mangle mark-connection udp dst-port=${ports}`, () =>
        upsertByComment(client, '/ip/firewall/mangle', `${SEED_TAG}-rt-ports`, [
          '=chain=prerouting', '=protocol=udp', `=dst-port=${ports}`,
          '=action=mark-connection', `=new-connection-mark=${RT_CONN}`, '=passthrough=yes',
          `=comment=${SEED_TAG}-rt-ports`,
        ]));
      await step('realtime:mark-voip-src', `mangle mark-connection src-address-list=${VOIP_LIST}`, () =>
        upsertByComment(client, '/ip/firewall/mangle', `${SEED_TAG}-rt-voip-src`, [
          '=chain=prerouting', `=src-address-list=${VOIP_LIST}`,
          '=action=mark-connection', `=new-connection-mark=${RT_CONN}`, '=passthrough=yes',
          `=comment=${SEED_TAG}-rt-voip-src`,
        ]));
      await step('realtime:mark-voip-dst', `mangle mark-connection dst-address-list=${VOIP_LIST}`, () =>
        upsertByComment(client, '/ip/firewall/mangle', `${SEED_TAG}-rt-voip-dst`, [
          '=chain=prerouting', `=dst-address-list=${VOIP_LIST}`,
          '=action=mark-connection', `=new-connection-mark=${RT_CONN}`, '=passthrough=yes',
          `=comment=${SEED_TAG}-rt-voip-dst`,
        ]));
      if (trustClientDscp) {
        await step('realtime:trust-dscp', 'mangle mark-connection dscp=46 (trust client EF)', async () => {
          // A mark-connection rule must sit BEFORE the mark-packet rule. On first seed
          // that happens naturally (created earlier). But if trust is enabled on a
          // LATER re-run, /add would append this to the chain tail — after rt-packet —
          // so a DSCP-only flow's first packet would miss its mark. Anchor it before
          // rt-packet when that rule already exists (add-path only).
          const packetId = await ros.findId(client, '/ip/firewall/mangle', [`?comment=${SEED_TAG}-rt-packet`]);
          const addOnly = packetId ? [`=place-before=${packetId}`] : [];
          return upsertByComment(client, '/ip/firewall/mangle', `${SEED_TAG}-rt-dscp`, [
            '=chain=prerouting', '=dscp=46',
            '=action=mark-connection', `=new-connection-mark=${RT_CONN}`, '=passthrough=yes',
            `=comment=${SEED_TAG}-rt-dscp`,
          ], addOnly);
        });
      }
      // Mark PACKETS from the realtime connection, then stamp DSCP EF so the whole path honours it.
      await step('realtime:mark-packet', `mangle mark-packet ${RT_PKT}`, () =>
        upsertByComment(client, '/ip/firewall/mangle', `${SEED_TAG}-rt-packet`, [
          '=chain=prerouting', `=connection-mark=${RT_CONN}`,
          '=action=mark-packet', `=new-packet-mark=${RT_PKT}`, '=passthrough=no',
          `=comment=${SEED_TAG}-rt-packet`,
        ]));
      await step('realtime:set-dscp', 'mangle change-dscp=46 on realtime connection', () =>
        upsertByComment(client, '/ip/firewall/mangle', `${SEED_TAG}-rt-setdscp`, [
          '=chain=postrouting', `=connection-mark=${RT_CONN}`,
          '=action=change-dscp', '=new-dscp=46', '=passthrough=yes',
          `=comment=${SEED_TAG}-rt-setdscp`,
        ]));

      // (c) Priority-1 queue-tree node for the realtime packet-mark. priority on
      //     /queue/tree is a SINGLE 1-8 value (confirmed on ROS7). The optional
      //     max-limit is the anti-abuse cap for the trust-DSCP path.
      const rtMax = normalizeRate(realtimeMaxMbps);
      await step('realtime:queue', `queue-tree ${RT_PKT} parent=${rtParent} priority=1${rtMax ? ` max-limit=${rtMax}` : ''}`, () => {
        const words = [
          `=name=${SEED_TAG}-realtime`,
          `=parent=${rtParent}`,
          `=packet-mark=${RT_PKT}`,
          '=priority=1',
          `=comment=${SEED_TAG}-realtime`,
        ];
        if (rtMax) words.push(`=max-limit=${rtMax}`);
        return upsertByComment(client, '/queue/tree', `${SEED_TAG}-realtime`, words);
      });
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

// =============================================================================
// VoIP address-list reconciliation (auto-updater push target)
// =============================================================================

/**
 * Reconcile the `fireisp-voip` firewall address-list on one NAS against a desired
 * set of RTC/VoIP CIDRs. Only entries THIS updater owns (comment `fireisp-voip-auto`)
 * are managed — operator-added entries (seed-time `fireisp-voip`, or untagged) are
 * left untouched. Adds missing CIDRs, removes stale auto-entries, and no-ops the rest.
 *
 * Skips NAS that never seeded real-time priority (no `fireisp-realtime` queue or
 * `fireisp-rt-packet` mangle), so we never create an orphan list on an opted-out device.
 *
 * @param {object} nas  NAS row (ip/api credentials)
 * @param {string[]} ranges  desired IPv4 CIDRs
 * @param {{ listName?: string }} [opts]
 * @returns {Promise<{ skipped?: boolean, reason?: string, added?: number,
 *                     removed?: number, kept?: number, desired?: number }>}
 */
async function syncVoipAddressList(nas, ranges, opts = {}) {
  const listName = opts.listName || `${SEED_TAG}-voip`;
  const autoComment = `${SEED_TAG}-voip-auto`;

  const conn = nasToConn(nas);
  const client = await ros.createClient(conn);
  try {
    // Only manage the list where real-time priority is actually configured.
    const realtimeSeeded = (await ros.findId(client, '/queue/tree', [`?comment=${SEED_TAG}-realtime`]))
      || (await ros.findId(client, '/ip/firewall/mangle', [`?comment=${SEED_TAG}-rt-packet`]));
    if (!realtimeSeeded) {
      return { skipped: true, reason: 'real-time priority not seeded on this NAS' };
    }

    // Print the list once; track ALL addresses (any comment) for the add decision
    // and only OUR auto-managed rows (address → .id) for the remove decision.
    const printed = await client.run(['/ip/firewall/address-list/print', `?list=${listName}`]);
    const allAddresses = new Set(); // every address in the list, regardless of comment
    const autoEntries = new Map();  // address → .id (only fireisp-voip-auto rows)
    for (const s of printed) {
      if (s[0] !== '!re') continue;
      const a = ros.parseAttrs(s.slice(1));
      if (!a.address) continue;
      allAddresses.add(a.address);
      if (a['.id'] && a.comment === autoComment) autoEntries.set(a.address, a['.id']);
    }

    const desired = new Set(ranges);
    let added = 0;
    let removed = 0;

    // Add only CIDRs not already on the list under ANY comment — a duplicate
    // (list,address) add is rejected by RouterOS ("already have such entry"), and an
    // operator-seeded entry already covers that CIDR, so re-adding it is pointless.
    for (const cidr of desired) {
      if (!allAddresses.has(cidr)) {
        await client.run(['/ip/firewall/address-list/add', `=list=${listName}`, `=address=${cidr}`, `=comment=${autoComment}`]);
        added++;
      }
    }
    // Remove only OUR auto entries no longer desired (never operator entries).
    for (const [addr, id] of autoEntries) {
      if (!desired.has(addr)) {
        await client.run(['/ip/firewall/address-list/remove', `=.id=${id}`]);
        removed++;
      }
    }

    logger.info({ host: conn.host, listName, added, removed, desired: desired.size }, 'RouterOS: VoIP address-list reconciled');
    return { added, removed, kept: desired.size - added, desired: desired.size };
  } finally {
    await client.close();
  }
}

module.exports = {
  nasToConn,
  syncVoipAddressList,
  testConnection,
  pushSubscriber,
  seedDevice,
};
