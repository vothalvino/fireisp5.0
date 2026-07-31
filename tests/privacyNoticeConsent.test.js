'use strict';
// =============================================================================
// FireISP 5.0 — privacy notice display + acceptance (LFPDPPP, j25)
// =============================================================================
// The consent tables and staff routes existed since migration 314, but nothing
// ever DISPLAYED a notice or WROTE a consent row through the product — so
// "prove this subscriber accepted your aviso" had no answer. These tests pin
// the new chain:
//
//   * GET /portal/privacy-notice — org text wins; otherwise a bundled template
//     in the org's language (Spanish aviso for MX, English with NO Mexican
//     terminology for everyone else), interpolated with the org's identity.
//   * POST /portal/privacy-notice/accept — records version + SHA-256 of the
//     exact text served, channel 'web'; idempotent per version; a version
//     bump makes the old acceptance stale.
//   * Staff POST /regulatory-compliance/consent — previously had NO validation
//     (an invalid ENUM 500'd) and NO client-org check (a cross-tenant write).
// =============================================================================

const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(), execute: jest.fn(), getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
}));

const config = require('../src/config');
const db = require('../src/config/database');
const app = require('../src/app');

const portalToken = () => jwt.sign({ sub: 9, type: 'portal' }, config.jwt.secret, { expiresIn: '1h' });
const staffToken = () => jwt.sign({ sub: 1, email: 'a@b.c', role: 'admin', orgId: 1 }, config.jwt.secret, { expiresIn: '1h' });
const ADMIN = { id: 1, email: 'a@b.c', role: 'admin', status: 'active', organization_id: 1 };

const MX_ORG = {
  name: 'Fibra Norte', legal_name: 'Fibra Norte SA de CV', email: 'privacidad@fibranorte.mx',
  phone: '6641234567', address: 'Av. Revolución 100', city: 'Tijuana', state: 'BC',
  zip_code: '22000', country: 'MX', locale: 'MX', privacy_notice: null, privacy_notice_version: null,
};
const GLOBAL_ORG = {
  ...MX_ORG, name: 'Panama Net', legal_name: 'Panama Net Corp', email: 'privacy@panamanet.pa',
  city: 'Panamá', state: 'Panamá', zip_code: '0801', country: 'PA', locale: 'global',
};

const insertOf = () => db.query.mock.calls.find(c => /INSERT INTO subscriber_consents/.test(c[0]));

/** Portal-side DB wiring. `consents` answers the active-consent lookup. */
function wirePortal({ org = MX_ORG, consents = [] } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (/FROM clients WHERE id = \?/.test(sql)) {
      return [[{ id: 9, organization_id: 5, name: 'Alice', email: 'alice@example.com', status: 'active' }]];
    }
    if (/FROM organizations WHERE id = \?/.test(sql)) return [[org]];
    if (/FROM subscriber_consents/.test(sql)) return [consents];
    if (/INSERT INTO subscriber_consents/.test(sql)) return [{ insertId: 77 }];
    return [[]];
  });
}

const getNotice = () => request(app)
  .get('/api/v1/portal/privacy-notice')
  .set('Authorization', `Bearer ${portalToken()}`);
const accept = () => request(app)
  .post('/api/v1/portal/privacy-notice/accept')
  .set('Authorization', `Bearer ${portalToken()}`);

beforeEach(() => jest.clearAllMocks());

describe('GET /portal/privacy-notice — bundled templates', () => {
  it('serves a Spanish aviso for an MX org, filled with the org identity', async () => {
    wirePortal({ org: MX_ORG });
    const res = await getNotice();
    expect(res.status).toBe(200);
    const { content, version, accepted } = res.body.data;
    expect(version).toBe('default-1');
    expect(accepted).toBe(false);
    expect(content).toMatch(/Aviso de Privacidad/);
    expect(content).toMatch(/Fibra Norte SA de CV/);          // legal_name wins
    expect(content).toMatch(/privacidad@fibranorte\.mx/);
    expect(content).toMatch(/ARCO/);                          // LFPDPPP rights block
  });

  it('serves an English notice with no Mexican terminology for a global org', async () => {
    wirePortal({ org: GLOBAL_ORG });
    const { body } = await getNotice();
    const { content } = body.data;
    expect(content).toMatch(/Privacy Notice/);
    expect(content).toMatch(/Panama Net Corp/);
    // The rule the tax-rules work follows: global orgs see zero MX vocabulary.
    expect(content).not.toMatch(/LFPDPPP|ARCO|Aviso|CFDI|SAT|IFT/);
  });

  it('org-authored text wins over the template, with its own version', async () => {
    wirePortal({ org: { ...MX_ORG, privacy_notice: '# Nuestro aviso propio', privacy_notice_version: '2026-07' } });
    const { body } = await getNotice();
    expect(body.data.content).toBe('# Nuestro aviso propio');
    expect(body.data.version).toBe('2026-07');
  });

  it('org text with NO version gets "custom-1", never the template version', async () => {
    // An acceptance of the bundled template must not count for custom text.
    wirePortal({ org: { ...MX_ORG, privacy_notice: '# Propio' } });
    const { body } = await getNotice();
    expect(body.data.version).toBe('custom-1');
  });

  it('never prints a dead placeholder when the org has no email or address', async () => {
    // Found in live testing after a deploy: an org with no contact email
    // produced "exercise your ARCO rights by writing to **—**", and claimed the
    // responsable was "located at —". A privacy notice whose legally-required
    // contact is an em-dash is a broken legal document, not a cosmetic gap.
    wirePortal({ org: { name: 'Bare Org', locale: 'MX', privacy_notice: null, privacy_notice_version: null } });
    const { body } = await getNotice();
    const { content } = body.data;
    // Match the DEAD PLACEHOLDER shape, not the character. A bare /—/ is the
    // wrong assertion: the English template legitimately uses an em-dash as a
    // clause separator ("...consent you have given — open a ticket..."), so a
    // character-level check both misses the English regression it should catch
    // and would fire on innocent Spanish prose. What is actually forbidden is a
    // dash standing WHERE A VALUE SHOULD BE.
    expect(content).not.toMatch(/\*\*—\*\*/);
    expect(content).not.toMatch(/(?:en|at|a)\s+—/);
    expect(content).not.toMatch(/\{\{/);          // no unreplaced template vars either
    // The portal is always a real channel — the subscriber is reading this in it.
    expect(content).toMatch(/abra un ticket desde este portal/);
    // And no dangling "con domicilio en ," from the omitted address.
    expect(content).toMatch(/\*\*Bare Org\*\* \(el "Responsable"\) es responsable/);
  });

  it('the ENGLISH template is equally free of dead placeholders', async () => {
    // The MX case above cannot cover this: the two templates have different
    // prose, and only the English one uses an em-dash as a separator — so the
    // English path was the one a character-level check could never guard.
    wirePortal({ org: { name: 'Bare Global Org', locale: 'global', privacy_notice: null, privacy_notice_version: null } });
    const { content } = (await getNotice()).body.data;
    expect(content).not.toMatch(/\*\*—\*\*/);
    expect(content).not.toMatch(/located at\s*—/);
    expect(content).not.toMatch(/\{\{/);
    expect(content).toMatch(/open a ticket from this customer portal/);
    expect(content).toMatch(/\*\*Bare Global Org\*\* \("we"\) is responsible/);
  });

  it('uses the real contact channels when the org has them', async () => {
    wirePortal({ org: MX_ORG });
    const { body } = await getNotice();
    expect(body.data.content).toMatch(/privacidad@fibranorte\.mx/);
    expect(body.data.content).toMatch(/6641234567/);
    expect(body.data.content).toMatch(/con domicilio en Av\. Revolución 100, Tijuana/);
  });

  it('reports accepted with the acceptance date when a matching consent exists', async () => {
    wirePortal({ consents: [{ id: 4, given_at: '2026-07-01T00:00:00.000Z' }] });
    const { body } = await getNotice();
    expect(body.data.accepted).toBe(true);
    expect(body.data.accepted_at).toBe('2026-07-01T00:00:00.000Z');
  });
});

describe('POST /portal/privacy-notice/accept', () => {
  it('writes version, channel web, and the SHA-256 of the exact text served', async () => {
    wirePortal({ org: MX_ORG });
    const res = await accept();
    expect(res.status).toBe(201);
    const params = insertOf()[1];
    expect(params).toContain('default-1');
    // 64-hex document_hash — ties the acceptance to the text it covered.
    expect(params.some(p => typeof p === 'string' && /^[0-9a-f]{64}$/.test(p))).toBe(true);
    expect(insertOf()[0]).toMatch(/'web'/);
    expect(insertOf()[0]).toMatch(/'service_delivery'/);
  });

  it('is idempotent: an existing acceptance short-circuits with no INSERT', async () => {
    wirePortal({ consents: [{ id: 4, given_at: '2026-07-01T00:00:00.000Z' }] });
    const res = await accept();
    expect(res.status).toBe(200);
    expect(res.body.data.accepted_at).toBe('2026-07-01T00:00:00.000Z');
    expect(insertOf()).toBeUndefined();
  });

  it('binds the CURRENT version into the consent lookup, so a bump re-prompts', async () => {
    // The lookup must compare consent_version = <current>, not merely find any
    // active row — otherwise bumping the version could never force re-consent.
    wirePortal({ org: { ...MX_ORG, privacy_notice: '# v2', privacy_notice_version: 'v2' } });
    await accept();
    const lookup = db.query.mock.calls.find(c => /FROM subscriber_consents/.test(c[0]));
    expect(lookup[0]).toMatch(/consent_version = \?/);
    expect(lookup[1]).toContain('v2');
  });
});

describe('an edit to the notice text re-prompts even with the version unchanged', () => {
  // The failure this closes: an org pastes its own text, leaves the version box
  // empty (so it stays 'custom-1'), subscribers accept, then the org adds a new
  // finalidad and saves — still 'custom-1'. Version-only matching would report
  // every one of those acceptances as current against text that no longer
  // exists, which is precisely the claim the feature has to be able to prove.
  it('compares the content hash, not just the version string', async () => {
    wirePortal({ org: { ...MX_ORG, privacy_notice: '# v1 text' } });
    await getNotice();
    const lookup = db.query.mock.calls.find(c => /FROM subscriber_consents/.test(c[0]));
    expect(lookup[0]).toMatch(/document_hash/);
    // The bound hash is the SHA-256 of the text actually served.
    const served = require('crypto').createHash('sha256').update('# v1 text', 'utf8').digest('hex');
    expect(lookup[1]).toContain(served);
  });

  it('still honours a hash-less row — a staff-recorded paper consent stays valid', async () => {
    // Paper and phone consents are an operator attestation, not a hash of
    // served text. Invalidating them would nag subscribers who already signed.
    wirePortal({ consents: [{ id: 4, given_at: '2026-06-01T00:00:00.000Z' }] });
    const { body } = await getNotice();
    expect(body.data.accepted).toBe(true);
    const lookup = db.query.mock.calls.find(c => /FROM subscriber_consents/.test(c[0]));
    expect(lookup[0]).toMatch(/document_hash IS NULL OR document_hash = \?/);
  });
});

describe('staff POST /regulatory-compliance/consent — now validated and org-checked', () => {
  const isUserLookup = (sql) => typeof sql === 'string' && sql.includes('`users`');

  function wireStaff({ clientInOrg = true } = {}) {
    db.query.mockImplementation(async (sql) => {
      if (isUserLookup(sql)) return [[ADMIN]];
      if (/FROM clients WHERE id = \? AND organization_id <=> \?/.test(sql)) {
        return [clientInOrg ? [{ id: 42 }] : []];
      }
      if (/INSERT INTO subscriber_consents/.test(sql)) return [{ insertId: 8 }];
      return [[]];
    });
  }

  const post = (body) => request(app)
    .post('/api/v1/regulatory-compliance/consent')
    .set('Authorization', `Bearer ${staffToken()}`)
    .send(body);

  const GOOD = { client_id: 42, consent_version: '2026-07', purpose: 'service_delivery', channel: 'paper' };

  it('records a valid paper consent', async () => {
    wireStaff();
    const res = await post(GOOD);
    expect(res.status).toBe(201);
    expect(insertOf()[1]).toEqual(expect.arrayContaining([42, '2026-07', 'service_delivery', 'paper']));
  });

  it('422s an invalid purpose instead of 500ing on the ENUM column', async () => {
    wireStaff();
    const res = await post({ ...GOOD, purpose: 'because_i_said_so' });
    expect(res.status).toBe(422);
    expect(insertOf()).toBeUndefined();
  });

  it('422s a missing client_id instead of inserting NULL', async () => {
    wireStaff();
    const { client_id, ...rest } = GOOD;
    expect((await post(rest)).status).toBe(422);
  });

  it("404s a client that is not in the caller's org (cross-tenant write)", async () => {
    wireStaff({ clientInOrg: false });
    const res = await post(GOOD);
    expect(res.status).toBe(404);
    expect(insertOf()).toBeUndefined();
  });
});
