// =============================================================================
// FireISP 5.0 — radiusLoginTimeService Tests (§3.2 item 12)
// =============================================================================
// Tests the Login-Time serializer that converts plan_access_windows rows into
// FreeRADIUS Login-Time attribute strings.
// =============================================================================

const {
  serializeLoginTime,
  dayMaskToDaySpec,
  formatTime,
} = require('../src/services/radiusLoginTimeService');

// ---------------------------------------------------------------------------
// formatTime
// ---------------------------------------------------------------------------
describe('formatTime()', () => {
  test('formats HH:MM:SS to HHMM', () => {
    expect(formatTime('08:00:00')).toBe('0800');
    expect(formatTime('18:30:00')).toBe('1830');
    expect(formatTime('00:00:00')).toBe('0000');
    expect(formatTime('23:59:00')).toBe('2359');
  });

  test('formats HH:MM (no seconds) to HHMM', () => {
    expect(formatTime('08:00')).toBe('0800');
    expect(formatTime('09:30')).toBe('0930');
  });
});

// ---------------------------------------------------------------------------
// dayMaskToDaySpec
// ---------------------------------------------------------------------------
describe('dayMaskToDaySpec()', () => {
  test('returns Al for all-days mask (127)', () => {
    expect(dayMaskToDaySpec(127)).toBe('Al');
  });

  test('returns Wk for Mon-Fri mask (62 = bits 1-5)', () => {
    // bit1=Mo, bit2=Tu, bit3=We, bit4=Th, bit5=Fr → 2+4+8+16+32 = 62
    expect(dayMaskToDaySpec(62)).toBe('Wk');
  });

  test('returns Su for Sunday-only (bit 0 = 1)', () => {
    expect(dayMaskToDaySpec(1)).toBe('Su');
  });

  test('returns Sa for Saturday-only (bit 6 = 64)', () => {
    expect(dayMaskToDaySpec(64)).toBe('Sa');
  });

  test('returns MoWeFr for alternating weekdays (bits 1,3,5 = 42)', () => {
    // bit1=Mo(2), bit3=We(8), bit5=Fr(32) → 42
    expect(dayMaskToDaySpec(42)).toBe('MoWeFr');
  });

  test('returns SaSu for weekend (bits 0,6 = 65)', () => {
    expect(dayMaskToDaySpec(65)).toBe('SuSa');
  });

  test('returns Tu for Tuesday-only (bit 2 = 4)', () => {
    expect(dayMaskToDaySpec(4)).toBe('Tu');
  });

  test('returns MoTuWeThFr same as Wk check (62)', () => {
    // Verify Wk shorthand is preferred
    expect(dayMaskToDaySpec(62)).toBe('Wk');
  });
});

// ---------------------------------------------------------------------------
// serializeLoginTime
// ---------------------------------------------------------------------------
describe('serializeLoginTime()', () => {
  test('returns null for empty array', () => {
    expect(serializeLoginTime([])).toBeNull();
  });

  test('returns null for null input', () => {
    expect(serializeLoginTime(null)).toBeNull();
  });

  test('returns null when all windows are inactive', () => {
    const windows = [
      { day_mask: 127, start_time: '08:00:00', end_time: '18:00:00', status: 'inactive', deleted_at: null },
    ];
    expect(serializeLoginTime(windows)).toBeNull();
  });

  test('returns null when all windows have deleted_at set', () => {
    const windows = [
      { day_mask: 127, start_time: '08:00:00', end_time: '18:00:00', status: 'active', deleted_at: '2026-01-01' },
    ];
    expect(serializeLoginTime(windows)).toBeNull();
  });

  test('serializes single all-day window', () => {
    const windows = [
      { day_mask: 127, start_time: '08:00:00', end_time: '18:00:00', status: 'active', deleted_at: null },
    ];
    expect(serializeLoginTime(windows)).toBe('Al0800-1800');
  });

  test('serializes weekday business hours', () => {
    const windows = [
      { day_mask: 62, start_time: '08:00:00', end_time: '18:00:00', status: 'active', deleted_at: null },
    ];
    expect(serializeLoginTime(windows)).toBe('Wk0800-1800');
  });

  test('serializes Saturday morning', () => {
    const windows = [
      { day_mask: 64, start_time: '09:00:00', end_time: '13:00:00', status: 'active', deleted_at: null },
    ];
    expect(serializeLoginTime(windows)).toBe('Sa0900-1300');
  });

  test('serializes multiple windows as comma-joined string', () => {
    const windows = [
      { day_mask: 62, start_time: '08:00:00', end_time: '18:00:00', status: 'active', deleted_at: null },
      { day_mask: 64, start_time: '09:00:00', end_time: '13:00:00', status: 'active', deleted_at: null },
    ];
    expect(serializeLoginTime(windows)).toBe('Wk0800-1800,Sa0900-1300');
  });

  test('skips inactive windows in mixed array', () => {
    const windows = [
      { day_mask: 62, start_time: '08:00:00', end_time: '18:00:00', status: 'active', deleted_at: null },
      { day_mask: 64, start_time: '09:00:00', end_time: '13:00:00', status: 'inactive', deleted_at: null },
    ];
    expect(serializeLoginTime(windows)).toBe('Wk0800-1800');
  });

  test('handles windows without status field (treats as active)', () => {
    const windows = [
      { day_mask: 127, start_time: '00:00:00', end_time: '23:59:00', deleted_at: null },
    ];
    expect(serializeLoginTime(windows)).toBe('Al0000-2359');
  });

  test('handles Sunday+Monday window (SuMo)', () => {
    const windows = [
      // bit0=Su(1) + bit1=Mo(2) = 3
      { day_mask: 3, start_time: '10:00:00', end_time: '22:00:00', status: 'active', deleted_at: null },
    ];
    expect(serializeLoginTime(windows)).toBe('SuMo1000-2200');
  });
});
