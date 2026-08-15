'use strict';

const { buildUnverifiableSessionOverlap } = require('../src/utils/accountingUsageCompleteness');

describe('accounting usage completeness overlap predicate', () => {
  const originalLiveness = process.env.RADIUS_SESSION_LIVENESS_MINUTES;

  afterEach(() => {
    if (originalLiveness === undefined) delete process.env.RADIUS_SESSION_LIVENESS_MINUTES;
    else process.env.RADIUS_SESSION_LIVENESS_MINUTES = originalLiveness;
  });

  test('covers a pre-period open Start/legacy observation while its receipt liveness overlaps', () => {
    process.env.RADIUS_SESSION_LIVENESS_MINUTES = '75';
    const sql = buildUnverifiableSessionOverlap('unverifiable');

    expect(sql).toContain("unverifiable.session_instance_id IS NULL OR unverifiable.event_type = 'start'");
    expect(sql).toContain('unverifiable.last_accounting_received_at');
    expect(sql).toContain('INTERVAL 75 MINUTE');
    expect(sql).toContain('END >= DATE(?)');
    expect(sql).toContain('unverifiable.event_at < DATE_ADD(DATE(?), INTERVAL 1 DAY)');
  });

  test('uses a legacy Stop timestamp as its end rather than extending liveness', () => {
    const sql = buildUnverifiableSessionOverlap('legacy_row', '?', 'UTC_TIMESTAMP(3)');

    expect(sql).toContain("WHEN legacy_row.session_instance_id IS NULL AND legacy_row.event_type = 'stop'");
    expect(sql).toContain('THEN legacy_row.event_at');
    expect(sql).toContain('legacy_row.event_at < UTC_TIMESTAMP(3)');
  });

  test('rejects dynamic aliases', () => {
    expect(() => buildUnverifiableSessionOverlap('row; DROP TABLE x')).toThrow(TypeError);
  });
});
