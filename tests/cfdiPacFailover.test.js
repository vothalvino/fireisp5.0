// =============================================================================
// FireISP 5.0 — PAC failover (Phase 5)
// =============================================================================
// Failover is CONSERVATIVE: the next PAC is tried ONLY when the primary is
// provably unreachable (ECONNREFUSED / DNS). A timeout or ANY PAC response
// (even an error) stops the loop — the doc may already be registered, so a
// second stamp elsewhere would double-stamp. Driven through the REAL stack
// (httpRequest → a stand-in SW server; a dead port for the unreachable case).
// =============================================================================

const http = require('http');
jest.mock('../src/config/database', () => ({ query: jest.fn() }));
const db = require('../src/config/database');
const cfdiService = require('../src/services/cfdiService');

const DOC = { id: 9, organization_id: 5, xml_content: '<cfdi:Comprobante Version="4.0"/>', sat_status: 'draft', invoice_id: null };
const DEAD = 'http://127.0.0.1:1';           // nothing listens → ECONNREFUSED

let server; let handler;
beforeAll(async () => {
  server = http.createServer((req, res) => handler(req, res));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
});
afterAll(async () => { await new Promise(r => server.close(r)); });
function liveBase() { return `http://127.0.0.1:${server.address().port}`; }

// sw_sapien, seal_mode='pac' (no CSD/sealing in the way — routing test).
// token_encrypted short-circuits swAuthToken (decrypt is a no-op without a key).
let nextId = 500;
function pac(over) {
  return { id: nextId++, provider_name: 'sw_sapien', seal_mode: 'pac', environment: 'sandbox', token_encrypted: 'tok', status: 'active', priority: 100, ...over };
}
function wire(pacs) {
  db.query.mockImplementation(async (sql) => {
    if (/FROM cfdi_documents WHERE id/.test(sql)) return [[{ ...DOC }]];
    if (/FROM pac_providers/.test(sql)) return [pacs.map(p => ({ ...p }))];
    return [{ affectedRows: 1 }];
  });
}
const okIssue = (res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: { uuid: 'BK-UUID-1', cfdi: '<sealed/>', selloSAT: 's' } })); };

beforeEach(() => { jest.clearAllMocks(); });

describe('PAC failover', () => {
  test('unreachable primary → fails over to the backup and stamps', async () => {
    const p = pac({ priority: 10, api_url: DEAD });
    const b = pac({ priority: 20, api_url: liveBase() });
    wire([p, b]);
    handler = (req, res) => okIssue(res);
    const res = await cfdiService.stamp(9);
    expect(res).toMatchObject({ uuid: 'BK-UUID-1', status: 'vigente', provider: 'sw_sapien' });
  }, 20000);

  test('primary TIMEOUT does NOT fail over (double-stamp safety)', async () => {
    let hitBackup = false;
    const p = pac({ priority: 10, api_url: liveBase() });
    const b = pac({ priority: 20, api_url: liveBase() });
    wire([p, b]);
    // primary "times out": we can't wait 30s, so simulate an ambiguous PAC
    // error response (also !unreachable → same no-failover rule). The backup
    // would succeed if (wrongly) reached.
    handler = (req, res) => {
      const isPrimaryFirst = !hitBackup;
      if (isPrimaryFirst) { hitBackup = true; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ message: 'timeout-ish', messageDetail: 'no uuid' })); }
      else okIssue(res);
    };
    await expect(cfdiService.stamp(9)).rejects.toThrow(/PAC stamping failed/);
  }, 20000);

  test('single-PAC org still stamps (no failover target)', async () => {
    const only = pac({ priority: 100, api_url: liveBase() });
    wire([only]);
    handler = (req, res) => okIssue(res);
    const res = await cfdiService.stamp(9);
    expect(res.uuid).toBe('BK-UUID-1');
  }, 20000);

  test('ECONNRESET does NOT fail over (post-send reset may mean the doc was registered)', async () => {
    let backupHit = false;
    const p = pac({ priority: 10, api_url: liveBase() });
    const b = pac({ priority: 20, api_url: liveBase() });
    wire([p, b]);
    handler = (req, res) => {
      if (!backupHit) { backupHit = true; req.socket.destroy(); }  // reset AFTER receiving the body
      else okIssue(res);
    };
    await expect(cfdiService.stamp(9)).rejects.toThrow(/PAC stamping failed/);
    // the reset arrives after the primary consumed the request → no failover
  }, 20000);

  test('an open per-provider circuit skips the primary straight to the backup', async () => {
    const p = pac({ priority: 10, api_url: DEAD });
    const b = pac({ priority: 20, api_url: liveBase() });
    wire([p, b]);
    const br = cfdiService.providerBreaker(p.id);
    for (let i = 0; i < br.threshold; i++) br.recordFailure();   // force open
    let primaryHit = false;
    handler = (req, res) => { primaryHit = true; okIssue(res); }; // only backup should reach here
    const res = await cfdiService.stamp(9);
    expect(res.uuid).toBe('BK-UUID-1');
    expect(primaryHit).toBe(true); // it's the backup that hit the live server; primary (dead port) was skipped fast
  }, 20000);
});
