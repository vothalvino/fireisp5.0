// =============================================================================
// FireISP 5.0 — RADIUS Login-Time Serializer
// =============================================================================
// Converts plan_access_windows rows into the FreeRADIUS Login-Time attribute
// string format (RFC 2865 extension, FreeRADIUS-specific dialect).
//
// Day-mask bit layout (mirrors plan_speed_windows):
//   bit 0 = Sunday    (Su)
//   bit 1 = Monday    (Mo)
//   bit 2 = Tuesday   (Tu)
//   bit 3 = Wednesday (We)
//   bit 4 = Thursday  (Th)
//   bit 5 = Friday    (Fr)
//   bit 6 = Saturday  (Sa)
//
// FreeRADIUS Login-Time format:
//   <day-spec>HHMM-HHMM[,<day-spec>HHMM-HHMM,...]
//
//   Day specs (FreeRADIUS):
//     Al  = all days (0b1111111 = 127)
//     Wk  = Monday–Friday (0b0111110 = 62)
//     Su Mo Tu We Th Fr Sa = individual days
//
//   Multiple windows are comma-joined in a single Login-Time value.
//
// Example:
//   windows = [
//     { day_mask: 62, start_time: '08:00:00', end_time: '18:00:00', label: 'Weekdays' },
//     { day_mask: 64, start_time: '09:00:00', end_time: '13:00:00', label: 'Saturday' },
//   ]
//   → "Wk0800-1800,Sa0900-1300"
// =============================================================================

const DAY_CODES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

// Bit positions for Wk (Mon-Fri): bits 1-5 = 0b0111110 = 62
const WK_MASK = 0b0111110; // Monday=1, Tuesday=2, Wednesday=3, Thursday=4, Friday=5
// Bit position for Al (all days): bits 0-6 = 0b1111111 = 127
const AL_MASK = 0b1111111;

/**
 * Format a TIME string (HH:MM:SS or HH:MM) to HHMM (no colon, no seconds).
 * @param {string} timeStr
 * @returns {string} e.g. '08:00:00' → '0800'
 */
function formatTime(timeStr) {
  const parts = timeStr.split(':');
  const hh = parts[0].padStart(2, '0');
  const mm = (parts[1] || '00').padStart(2, '0');
  return `${hh}${mm}`;
}

/**
 * Convert a day_mask integer to a FreeRADIUS day specification string.
 * Uses shorthand codes where possible:
 *   127 (all days) → 'Al'
 *    62 (Mon-Fri)  → 'Wk'
 * Individual set bits → concatenated day codes e.g. 'MoTuWe'
 *
 * @param {number} dayMask - 7-bit integer (0-127)
 * @returns {string} FreeRADIUS day spec
 */
function dayMaskToDaySpec(dayMask) {
  const mask = dayMask & AL_MASK;

  if (mask === AL_MASK) return 'Al';
  if (mask === WK_MASK) return 'Wk';

  let spec = '';
  for (let bit = 0; bit < 7; bit++) {
    if (mask & (1 << bit)) {
      spec += DAY_CODES[bit];
    }
  }
  return spec;
}

/**
 * Serialize an array of plan_access_windows rows into a single FreeRADIUS
 * Login-Time attribute value string.
 *
 * Only windows with status = 'active' and deleted_at IS NULL are included.
 * An empty array (or no active windows) returns null — the caller should
 * omit the Login-Time attribute when null.
 *
 * @param {Array<{day_mask: number, start_time: string, end_time: string, status?: string, deleted_at?: any}>} windows
 * @returns {string|null} Login-Time value or null if no active windows
 */
function serializeLoginTime(windows) {
  const active = (windows || []).filter(
    w => (!w.status || w.status === 'active') && !w.deleted_at,
  );

  if (active.length === 0) return null;

  const segments = active.map(w => {
    const daySpec = dayMaskToDaySpec(w.day_mask ?? 127);
    const start = formatTime(w.start_time);
    const end = formatTime(w.end_time);
    return `${daySpec}${start}-${end}`;
  });

  return segments.join(',');
}

module.exports = {
  serializeLoginTime,
  dayMaskToDaySpec,
  formatTime,
};
