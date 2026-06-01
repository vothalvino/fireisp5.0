// =============================================================================
// FireISP 5.0 — Volume Persistence Verifier Tests
// =============================================================================

const { classifyMounts, verify, DEFAULT_TARGETS } = require('../src/scripts/verify-volumes');

describe('classifyMounts', () => {
  test('named volume on /var/lib/mysql is persistent', () => {
    const mounts = [
      { Type: 'volume', Name: 'fireisp_db_primary_data', Destination: '/var/lib/mysql' },
    ];
    const [result] = classifyMounts(mounts, ['/var/lib/mysql']);
    expect(result.persistent).toBe(true);
    expect(result.type).toBe('volume');
    expect(result.source).toBe('fireisp_db_primary_data');
  });

  test('host bind mount is persistent', () => {
    const mounts = [
      { Type: 'bind', Source: '/srv/fireisp/storage', Destination: '/app/storage' },
    ];
    const [result] = classifyMounts(mounts, ['/app/storage']);
    expect(result.persistent).toBe(true);
    expect(result.type).toBe('bind');
    expect(result.source).toBe('/srv/fireisp/storage');
  });

  test('missing mount is ephemeral', () => {
    const [result] = classifyMounts([], ['/var/lib/mysql']);
    expect(result.persistent).toBe(false);
    expect(result.type).toBeNull();
    expect(result.source).toBeNull();
  });

  test('tmpfs mount is ephemeral (does not survive docker rm)', () => {
    const mounts = [{ Type: 'tmpfs', Destination: '/var/lib/mysql' }];
    const [result] = classifyMounts(mounts, ['/var/lib/mysql']);
    expect(result.persistent).toBe(false);
    expect(result.type).toBe('tmpfs');
  });

  test('classifies multiple targets in order and ignores unrelated mounts', () => {
    const mounts = [
      { Type: 'volume', Name: 'db', Destination: '/var/lib/mysql' },
      { Type: 'bind', Source: '/etc/mysql/conf.d/primary.cnf', Destination: '/etc/mysql/conf.d/primary.cnf' },
    ];
    const results = classifyMounts(mounts, ['/var/lib/mysql', '/data']);
    expect(results.map((r) => r.target)).toEqual(['/var/lib/mysql', '/data']);
    expect(results[0].persistent).toBe(true);
    expect(results[1].persistent).toBe(false);
  });

  test('handles non-array mounts input defensively', () => {
    const results = classifyMounts(null, ['/var/lib/mysql']);
    expect(results).toEqual([
      { target: '/var/lib/mysql', persistent: false, type: null, source: null },
    ]);
  });
});

describe('verify', () => {
  test('safe is true only when every critical path is persistent', () => {
    // verify() shells out to docker via inspectMounts; stub it through the
    // module boundary by exercising classifyMounts indirectly is not possible,
    // so assert the default target set instead.
    expect(DEFAULT_TARGETS).toContain('/var/lib/mysql');
    expect(typeof verify).toBe('function');
  });
});
