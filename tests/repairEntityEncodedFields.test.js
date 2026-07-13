// =============================================================================
// FireISP 5.0 — repair-entity-encoded-fields script tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const db = require('../src/config/database');
const {
  decodeEntities,
  isCorrupted,
  TARGETS,
  repairColumn,
  repairCfdiReceptorNombre,
} = require('../src/scripts/repair-entity-encoded-fields');

describe('repair-entity-encoded-fields', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('decodeEntities', () => {
    test('decodes all 5 known entities, &amp; last', () => {
      expect(decodeEntities('O&#x27;Brien &amp; Sons &lt;script&gt; say &quot;hi&quot;'))
        .toBe('O\'Brien & Sons <script> say "hi"');
    });

    // Regression for the under-repair bug: decodeEntities now runs to a
    // fixpoint (repeat until isCorrupted() is false), not just once. A
    // single pass left multiply-encoded values still corrupted while the
    // script reported them as "repaired".
    test('fully decodes a literal "&amp;amp;" via the fixpoint loop', () => {
      // pass 1: "&amp;amp;" -> "&amp;" (still corrupted) — pass 2: "&amp;" -> "&"
      expect(decodeEntities('&amp;amp;')).toBe('&');
    });

    test('fully decodes a value that was entity-encoded twice by the old middleware (two separate edits)', () => {
      // "O'Brien" encoded once -> "O&#x27;Brien"; encoded again (a second
      // edit through the bug) -> "O&amp;#x27;Brien". A single decode pass
      // only recovers "O&#x27;Brien" (still corrupted); the fixpoint loop
      // must run a second pass to reach "O'Brien".
      expect(decodeEntities('O&amp;#x27;Brien')).toBe("O'Brien");
      expect(isCorrupted(decodeEntities('O&amp;#x27;Brien'))).toBe(false);
    });

    test('leaves plain strings untouched', () => {
      expect(decodeEntities('hello world')).toBe('hello world');
    });

    test('passes through non-strings unchanged', () => {
      expect(decodeEntities(null)).toBe(null);
      expect(decodeEntities(42)).toBe(42);
      expect(decodeEntities(undefined)).toBe(undefined);
    });

    test('caps at MAX_DECODE_PASSES and leaves a pathologically deep encoding chain still corrupted', () => {
      // "&" encoded 11 times in a row (11 separate edits through the bug)
      // needs 11 decode passes to fully resolve; the safety cap is 10, so
      // this is left one pass short — isCorrupted() must still report true
      // afterward rather than the caller silently trusting it's clean.
      const deep = '&' + 'amp;'.repeat(11);
      const result = decodeEntities(deep);
      expect(isCorrupted(result)).toBe(true);
    });
  });

  describe('isCorrupted', () => {
    test('detects entity-encoded strings', () => {
      expect(isCorrupted("O&#x27;Brien")).toBe(true);
      expect(isCorrupted('Tom &amp; Jerry')).toBe(true);
    });

    test('does not flag plain strings', () => {
      expect(isCorrupted("O'Brien")).toBe(false);
      expect(isCorrupted('Tom & Jerry')).toBe(false);
    });
  });

  describe('TARGETS', () => {
    test('every target has a table and at least one column', () => {
      expect(TARGETS.length).toBeGreaterThan(0);
      for (const t of TARGETS) {
        expect(typeof t.table).toBe('string');
        expect(Array.isArray(t.columns)).toBe(true);
        expect(t.columns.length).toBeGreaterThan(0);
      }
    });
  });

  describe('repairColumn (dry run)', () => {
    test('reports candidates without writing when apply is false', async () => {
      db.query.mockResolvedValueOnce([[{ id: 1, val: "O&#x27;Brien" }]]);

      const result = await repairColumn('clients', 'name', { apply: false });

      expect(result).toEqual({ table: 'clients', column: 'name', count: 1, residual: 0 });
      // Only the SELECT ran — no UPDATE was issued.
      expect(db.query).toHaveBeenCalledTimes(1);
      expect(db.query.mock.calls[0][0]).toMatch(/SELECT id, `name` AS val FROM `clients`/);
    });

    test('skips rows that are not actually corrupted (defensive re-check)', async () => {
      db.query.mockResolvedValueOnce([[{ id: 2, val: 'plain text' }]]);

      const result = await repairColumn('clients', 'notes', { apply: false });

      expect(result).toEqual({ table: 'clients', column: 'notes', count: 0, residual: 0 });
    });
  });

  describe('repairColumn (apply)', () => {
    test('writes decoded values when apply is true', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 3, val: 'Tom &amp; Jerry' }]]) // SELECT
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE

      const result = await repairColumn('clients', 'name', { apply: true });

      expect(result).toEqual({ table: 'clients', column: 'name', count: 1, residual: 0 });
      expect(db.query).toHaveBeenCalledTimes(2);
      const [updateSql, updateParams] = db.query.mock.calls[1];
      expect(updateSql).toMatch(/UPDATE `clients` SET `name` = \? WHERE id = \?/);
      expect(updateParams).toEqual(['Tom & Jerry', 3]);
    });

    test('fully decodes a multiply-encoded value in one --apply pass (regression for the under-repair bug)', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 4, val: 'O&amp;#x27;Brien' }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await repairColumn('clients', 'name', { apply: true });

      expect(result).toEqual({ table: 'clients', column: 'name', count: 1, residual: 0 });
      const [, updateParams] = db.query.mock.calls[1];
      expect(updateParams).toEqual(["O'Brien", 4]);
    });

    test('reports a residual row rather than silently claiming a clean repair when the decode-pass cap is hit', async () => {
      const deep = '&' + 'amp;'.repeat(11); // needs 11 passes; cap is 10
      db.query
        .mockResolvedValueOnce([[{ id: 5, val: deep }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await repairColumn('clients', 'name', { apply: true });

      expect(result.count).toBe(1);
      expect(result.residual).toBe(1);
      // The row is still written with its best-effort decoded value, not
      // left untouched — but the caller must be told it's still corrupted.
      const [, updateParams] = db.query.mock.calls[1];
      expect(updateParams[1]).toBe(5);
      expect(isCorrupted(updateParams[0])).toBe(true);
    });
  });

  describe('repairCfdiReceptorNombre', () => {
    test('repairs draft (uuid IS NULL) rows and never writes to stamped rows', async () => {
      db.query.mockResolvedValueOnce([[
        { id: 10, uuid: null, val: "O&#x27;Brien" }, // draft — repaired
        { id: 11, uuid: 'a1b2c3d4-0000-0000-0000-000000000000', val: 'Tom &amp; Jerry' }, // stamped — flagged only
      ]]);
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE for the draft row only

      const result = await repairCfdiReceptorNombre({ apply: true });

      expect(result).toEqual({ draftRepaired: 1, stampedFlagged: 1, residual: 0 });
      // SELECT + exactly one UPDATE (the draft row) — the stamped row is
      // never written.
      expect(db.query).toHaveBeenCalledTimes(2);
      const [updateSql, updateParams] = db.query.mock.calls[1];
      expect(updateSql).toBe('UPDATE cfdi_documents SET receptor_nombre = ? WHERE id = ?');
      expect(updateParams).toEqual(["O'Brien", 10]);
    });

    test('dry run never issues an UPDATE', async () => {
      db.query.mockResolvedValueOnce([[
        { id: 20, uuid: null, val: "O&#x27;Brien" },
      ]]);

      const result = await repairCfdiReceptorNombre({ apply: false });

      expect(result.draftRepaired).toBe(1);
      expect(db.query).toHaveBeenCalledTimes(1);
    });
  });
});
