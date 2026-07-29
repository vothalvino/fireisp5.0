// =============================================================================
// FireISP 5.0 — TLS certificate expiry monitor
// =============================================================================
// The product already watches two kinds of certificate and neither is the one
// customers actually hit:
//   • check_certificate_expiry → subscriber_certificates (EAP-TLS for RADIUS)
//   • csd_expiry_monitor       → csd_certificates       (SAT fiscal signing)
//
// Nothing watched the server's own TLS certificate. Combined with a renewal
// loop that used to run `certbot renew --quiet` under `restart: unless-stopped`,
// a broken renewal produced no output, no alert and no failed container — the
// first symptom would have been the customer portal serving an expired
// certificate roughly 60-90 days later. (#538 removed the --quiet; this is the
// detection half.)
//
// Deliberately checks the LIVE endpoint rather than a file on disk: the app may
// run in a different container from nginx, certificates live in different paths
// across install methods (compose, k8s, install.sh), and what matters is what a
// browser is actually served — not what is sitting on a volume somewhere.
// =============================================================================

const tls = require('node:tls');
const config = require('../config');
const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'tlsMonitor' });

// Mirrors the CSD monitor's escalation shape. 30 days is the Let's Encrypt
// renewal window opening, so an alert at 30 means renewal has already had its
// first chance and missed; 14 and 7 are increasingly urgent.
const THRESHOLDS = [7, 14, 30];

// How long the check may go WITHOUT SUCCEEDING before that itself is an alert.
// The monitor returning { checked: false } forever is the same silent failure
// it exists to prevent, one level up — an install that can never reach its own
// hostname reported a clean run and never warned anyone.
//
// Days rather than run-counts: 5 consecutive failures means 5 hours or 5 days
// depending on the cron, and staleness is what the operator actually cares
// about. Escalating milestones so a persistent outage keeps nagging, while
// each milestone alerts once (the title is the dedupe key).
const STALE_DAY_MILESTONES = [1, 3, 7, 14, 30];

const CONNECT_TIMEOUT_MS = 10_000;

/**
 * Read the certificate a TLS client is actually served for `hostname`.
 *
 * rejectUnauthorized is FALSE on purpose. An already-expired certificate fails
 * verification, so a validating handshake would throw before we could read the
 * expiry — the monitor would go blind in exactly the situation it exists for.
 * Nothing is sent over this socket and no response is trusted; it is opened
 * solely to read certificate metadata, then closed.
 */
function fetchPeerCertificate(hostname, port) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };

    const socket = tls.connect(
      { host: hostname, port, servername: hostname, rejectUnauthorized: false, timeout: CONNECT_TIMEOUT_MS },
      () => {
        // rejectUnauthorized is off so an expired cert can still be read, but
        // the verdict it would have produced is still available — keep it, or a
        // self-signed or wrong-hostname certificate reads as perfectly healthy.
        const cert = socket.getPeerCertificate();
        const authorized = socket.authorized;
        const authorizationError = socket.authorizationError ? String(socket.authorizationError) : null;
        socket.end();
        if (!cert || !cert.valid_to) done(reject, new Error('server presented no certificate'));
        else done(resolve, { cert, authorized, authorizationError });
      },
    );
    socket.on('timeout', () => { socket.destroy(); done(reject, new Error(`TLS connect to ${hostname}:${port} timed out`)); });
    socket.on('error', (err) => { socket.destroy(); done(reject, err); });
  });
}

/**
 * One notification per recipient per threshold, deduped on title exactly as the
 * CSD monitor does — the scheduled task runs daily and must not re-alert every
 * run for the same certificate and the same threshold.
 */
/**
 * Deliver one alert to an organization's admins/managers.
 *
 * `title` IS the dedupe key: one row per recipient per distinct title, so the
 * title must carry whatever makes this alert distinct from the last one. The
 * scheduled task runs daily and must not re-alert every run for the same
 * certificate and threshold — but it MUST alert again for a new certificate.
 */
/**
 * Deliver an infrastructure alert to the configured ops contact.
 *
 * Email only, by design: there is no user row to attach a bell notification to,
 * and creating one would drop a host-level message into some tenant's list.
 *
 * Dedupe is an INSERT IGNORE on the UNIQUE alert_key rather than a
 * SELECT-then-INSERT, so two runs racing cannot both decide the alert is new.
 * The row is written FIRST and rolled back if nothing could be delivered — the
 * marker must never outlive a failed send, or the alert is suppressed forever.
 */
async function deliverToOps({ opsEmails, title, body }) {
  const emailTransport = require('./emailTransport');

  const [claim] = await db.query(
    'INSERT IGNORE INTO ops_alert_deliveries (alert_key, channel) VALUES (?, ?)',
    [title.slice(0, 255), 'email'],
  );
  if (claim.affectedRows === 0) return 0;   // already alerted for this exact title

  let sent = 0;
  for (const to of opsEmails) {
    try {
      await emailTransport.sendEmail({ to, subject: title, text: body });
      sent += 1;
    } catch (err) {
      logger.warn({ err: err.message, to }, 'Ops alert email failed');
    }
  }

  if (sent === 0) {
    // Nothing went out. Release the claim so the next run retries instead of
    // treating a total delivery failure as "already handled".
    await db.query('DELETE FROM ops_alert_deliveries WHERE alert_key = ?', [title.slice(0, 255)])
      .catch(() => {});
    logger.error({ title }, 'Ops alert could not be delivered to any configured address');
  }
  return sent;
}

async function deliver({ organizationId, type, title, body }) {
  const Notification = require('../models/Notification');
  const User = require('../models/User');
  const emailTransport = require('./emailTransport');

  // A configured ops contact wins. It is addressed by email only — there is no
  // user row to hang a bell notification on, and inventing one would put a
  // tenant-visible notification in somebody's list.
  const { opsAlertRecipients } = require('./opsContact');
  const opsEmails = await opsAlertRecipients();
  if (opsEmails.length > 0) {
    return deliverToOps({ opsEmails, title, body });
  }

  const recipients = await User.getStaffByEffectiveRole(organizationId, ['admin', 'manager']);
  if (recipients.length === 0) {
    logger.error({ organizationId, title },
      'TLS alert has NO recipients — organization has no active admin/manager');
    return 0;
  }

  let sent = 0;
  for (const r of recipients) {
    const [already] = await db.query(
      "SELECT id FROM notifications WHERE entity_type = 'tls_certificate' AND title = ? AND user_id = ? LIMIT 1",
      [title, r.id],
    );
    if (already[0]) continue;

    // Count only what actually persisted. The bell row is also the dedupe
    // marker, so if it fails to write the alert is NOT suppressed next run.
    let stored = false;
    try {
      await Notification.create({
        user_id: r.id, type, title, body,
        entity_type: 'tls_certificate', entity_id: null,
      });
      stored = true;
    } catch (err) {
      logger.warn({ err: err.message, userId: r.id }, 'TLS alert bell failed');
    }

    if (r.email) {
      await emailTransport.sendEmail({ to: r.email, subject: title, text: body, organizationId })
        .catch(err => logger.warn({ err: err.message, userId: r.id }, 'TLS alert email failed'));
    }
    if (stored) sent += 1;
  }
  return sent;
}

/** Certificate is approaching, or past, its expiry date. */
async function notifyTlsExpiry({ hostname, validTo, daysLeft, threshold, organizationId }) {
  const validToDay = validTo.toISOString().slice(0, 10);
  const expired = threshold === 0;

  // The certificate's own expiry date is IN THE TITLE on purpose: the title is
  // the dedupe key, so it must change when the certificate does. Without it the
  // key is just threshold+hostname — constant for the life of the install — and
  // since notifications are never purged (no delete route, and retentionService
  // does not cover the table), the first alert would suppress every future one.
  // The monitor would become a one-shot alarm that silently stops warning: the
  // exact failure this feature exists to prevent. The CSD monitor avoids it the
  // same way, by embedding certificate_number.
  const title = expired
    ? `TLS certificate EXPIRED ${validToDay} — ${hostname}`
    : `TLS certificate expires ${validToDay} (≤${threshold} days) — ${hostname}`;

  // Remediation is deliberately service-scoped rather than naming a container:
  // `fireisp-certbot` only exists if the compose project happens to be named
  // that, and it does not exist at all on k8s.
  const remedy = 'Check the renewal service — `docker compose -f docker-compose.prod.yml logs certbot` '
    + '(or `kubectl logs` for the cert-manager pod on k8s) — and see docs/runbook.md.';

  const body = expired
    ? `The TLS certificate for ${hostname} expired on ${validToDay} UTC. Every visitor, including the customer `
      + `portal, is now seeing a browser security warning. ${remedy}`
    : `The TLS certificate for ${hostname} expires on ${validToDay} UTC (${daysLeft} days). `
      + `Automatic renewal should already have run — if this alert repeats, renewal is failing silently. ${remedy}`;

  return deliver({ organizationId, type: expired ? 'error' : 'warning', title, body });
}

/**
 * Run `notify` once per organization. A global run (organizationId null) fans
 * out to every ACTIVE organization — the certificate is install-wide — while a
 * scoped run touches only the one asked for. Inactive orgs are skipped: their
 * staff cannot act on it and should not be paged.
 */
async function notifyForAllOrgs(organizationId, notify) {
  let orgIds = [organizationId];
  if (organizationId === null || organizationId === undefined) {
    // A dedicated ops contact REPLACES the fan-out (migration 436). The
    // certificate is install-wide, so with an operator on file there is no
    // reason to page every tenant's admins about a host they cannot reach.
    // Delivered once, under organizationId null.
    const { hasOpsContact } = require('./opsContact');
    if (await hasOpsContact()) return notify(null);

    const [orgs] = await db.query(
      "SELECT id FROM organizations WHERE deleted_at IS NULL AND status = 'active'",
    );
    orgIds = orgs.map(o => o.id);
  }
  let sent = 0;
  for (const orgId of orgIds) sent += await notify(orgId);
  return sent;
}

/** Certificate is untrustworthy for a reason other than expiry. */
async function notifyTlsInvalid({ hostname, reason, validTo, organizationId }) {
  const validToDay = validTo.toISOString().slice(0, 10);
  return deliver({
    organizationId,
    type: 'error',
    // reason is in the title so a DIFFERENT failure still alerts.
    title: `TLS certificate is not trusted (${reason}) — ${hostname}`,
    body: `The certificate served by ${hostname} fails verification: ${reason}. `
      + `It expires ${validToDay} UTC, so this is not an expiry problem — visitors are seeing a security `
      + 'warning. Check that the renewal wrote the certificate the web server is actually serving.',
  });
}

/**
 * Record that the check could actually READ the certificate. Clears the streak.
 *
 * Best-effort: a failure to write monitor bookkeeping must never turn a healthy
 * check into a failed task. Worst case the staleness clock is a run behind.
 */
async function recordCheckSuccess(hostname) {
  try {
    await db.query(
      `UPDATE tls_monitor_state
          SET hostname = ?, last_success_at = NOW(), consecutive_failures = 0, last_error = NULL
        WHERE id = 1`,
      [hostname],
    );
  } catch (err) {
    logger.warn({ err: err.message }, 'Could not record TLS check success');
  }
}

/**
 * Record that the check could not reach the endpoint, and alert if it has now
 * been failing long enough to matter.
 *
 * Returns the number of notifications sent so the caller can report it.
 */
async function recordCheckFailure(hostname, errorMessage, organizationId) {
  let row;
  try {
    await db.query(
      `UPDATE tls_monitor_state
          SET hostname = ?, last_failure_at = NOW(),
              consecutive_failures = consecutive_failures + 1, last_error = ?
        WHERE id = 1`,
      [hostname, errorMessage],
    );
    const [rows] = await db.query(
      'SELECT last_success_at, consecutive_failures FROM tls_monitor_state WHERE id = 1',
    );
    row = rows[0];
  } catch (err) {
    logger.warn({ err: err.message }, 'Could not record TLS check failure');
    return 0;
  }
  if (!row) return 0;

  // A brand-new install has never succeeded. Counting "days since never" as
  // infinite would alert on the very first blip, so fall back to the run
  // streak and only speak up once it is clearly not a one-off.
  let staleDays;
  if (row.last_success_at) {
    staleDays = Math.floor((Date.now() - new Date(row.last_success_at).getTime()) / 86_400_000);
  } else {
    staleDays = row.consecutive_failures >= 3 ? 1 : 0;
  }

  const milestone = [...STALE_DAY_MILESTONES].reverse().find(m => staleDays >= m);
  if (milestone === undefined) return 0;

  logger.warn({ hostname, staleDays, consecutive: row.consecutive_failures },
    'TLS expiry check has been unable to read the certificate');

  return notifyForAllOrgs(organizationId, (orgId) => notifyTlsCheckStale({
    hostname, milestone, staleDays, lastSuccessAt: row.last_success_at,
    consecutive: row.consecutive_failures, reason: errorMessage, organizationId: orgId,
  }));
}

/** The monitor itself is broken — it has not been able to read the cert. */
async function notifyTlsCheckStale({ hostname, milestone, lastSuccessAt, consecutive, reason, organizationId }) {
  const since = lastSuccessAt
    ? `since ${new Date(lastSuccessAt).toISOString().slice(0, 10)}`
    : 'ever (it has never succeeded)';
  // The milestone is in the title because the title is the dedupe key: without
  // it, the first "check is failing" alert would suppress every escalation, and
  // the alarm about a silent monitor would itself go silent.
  return deliver({
    organizationId,
    type: 'error',
    title: `TLS expiry check has not succeeded for ${milestone}+ days — ${hostname}`,
    body: `The TLS certificate expiry monitor has been unable to read the certificate at ${hostname} `
      + `for ${milestone}+ days (${consecutive} consecutive attempts, no success ${since}). `
      + `Last error: ${reason}. `
      + 'This means NOTHING is currently watching that certificate for expiry — the renewal could be '
      + 'broken and no expiry warning would ever arrive. Common causes: APP_URL points somewhere the '
      + 'app cannot reach itself (load balancer, split-horizon DNS), APP_URL does not match the '
      + 'certificate hostname, or a WAF is blocking the connection.',
  });
}

/**
 * Scheduled task entry point. Returns a result object the task log can render.
 * Never throws for an unreachable host — an outage is not a monitor failure,
 * and a throwing task would mark the scheduled run failed on every blip.
 */
async function checkTlsExpiry(organizationId = null) {
  let url;
  try {
    url = new URL(config.appUrl);
  } catch {
    return { skipped: `APP_URL is not a valid URL: ${config.appUrl}` };
  }

  if (url.protocol !== 'https:') {
    // A plain-HTTP install has no certificate to watch. This is the default for
    // local development, so it must be a quiet skip rather than an error.
    return { skipped: `APP_URL is ${url.protocol}// — no TLS certificate to check` };
  }

  const hostname = url.hostname;
  const port = url.port ? Number(url.port) : 443;

  let cert; let authorized; let authorizationError;
  try {
    ({ cert, authorized, authorizationError } = await fetchPeerCertificate(hostname, port));
  } catch (err) {
    logger.warn({ err: err.message, hostname, port }, 'TLS expiry check could not reach the endpoint');
    const sent = await recordCheckFailure(hostname, err.message, organizationId);
    return { checked: false, hostname, error: err.message, notifications_sent: sent };
  }

  const validTo = new Date(cert.valid_to);
  if (Number.isNaN(validTo.getTime())) {
    // Reached the host but the certificate is unreadable — still "nothing is
    // watching this cert", so it counts as a failure, not a quiet return.
    const reason = `unparseable valid_to: ${cert.valid_to}`;
    const sent = await recordCheckFailure(hostname, reason, organizationId);
    return { checked: false, hostname, error: reason, notifications_sent: sent };
  }

  const daysLeft = Math.ceil((validTo.getTime() - Date.now()) / 86_400_000);
  const threshold = daysLeft <= 0 ? 0 : THRESHOLDS.find(t => daysLeft <= t);

  await recordCheckSuccess(hostname);

  const result = {
    checked: true,
    hostname,
    valid_to: validTo.toISOString(),
    days_left: daysLeft,
    issuer: cert.issuer?.O || cert.issuer?.CN || null,
    authorized: authorized === true,
    authorization_error: authorizationError,
    notifications_sent: 0,
  };

  // A certificate can be untrustworthy without being expired — self-signed, or
  // issued for a different hostname. Those read as "plenty of days left" and
  // would otherwise be reported healthy. Expiry has its own alert below, so
  // only surface OTHER verification failures here.
  const expiryError = /EXPIRED|NOT_YET_VALID/i.test(authorizationError || '');
  if (!authorized && authorizationError && !expiryError) {
    result.notifications_sent += await notifyForAllOrgs(organizationId, (orgId) => notifyTlsInvalid({
      hostname, reason: authorizationError, validTo, organizationId: orgId,
    }));
    logger.warn({ hostname, authorizationError }, 'TLS certificate fails verification');
  }

  if (threshold === undefined) return result;   // healthy, nothing to say

  // Global task: the certificate is install-wide, so every organization's
  // admins are affected by it. Scoped runs (organizationId given) notify only
  // that organization.
  result.notifications_sent += await notifyForAllOrgs(organizationId, (orgId) => notifyTlsExpiry({
    hostname, validTo, daysLeft, threshold, organizationId: orgId,
  }));

  logger.warn({ hostname, daysLeft, threshold, sent: result.notifications_sent },
    'TLS certificate expiry alert raised');
  return result;
}

module.exports = { checkTlsExpiry, fetchPeerCertificate, THRESHOLDS, STALE_DAY_MILESTONES };
