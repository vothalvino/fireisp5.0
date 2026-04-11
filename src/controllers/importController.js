// =============================================================================
// FireISP 5.0 — Bulk Import Controller
// =============================================================================
// CSV-based bulk import for clients, devices, and contracts.
// =============================================================================

const db = require('../config/database');

/**
 * Parse CSV string into rows of objects.
 * Handles quoted fields and escaped quotes.
 * Limits to 10,000 rows to prevent memory exhaustion from untrusted input.
 */
function parseCsv(csvString) {
  const MAX_ROWS = 10000;
  const lines = csvString.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const rows = [];
  const limit = Math.min(lines.length, MAX_ROWS + 1);

  for (let i = 1; i < limit; i++) {
    const values = parseCsvLine(lines[i]);
    if (values.length === 0) continue;
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j].trim()] = (values[j] || '').trim();
    }
    rows.push(row);
  }

  return rows;
}

/**
 * Parse a single CSV line respecting quoted fields.
 * Limits to 200 columns to prevent abuse from malformed input.
 */
function parseCsvLine(line) {
  const MAX_COLS = 200;
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
        if (result.length >= MAX_COLS) break;
      } else {
        current += ch;
      }
    }
  }
  if (result.length < MAX_COLS) {
    result.push(current);
  }
  return result;
}

/**
 * POST /api/import/clients
 * Import clients from CSV.
 * Expected columns: first_name, last_name, email, phone, city, state, country
 */
async function importClients(req, res, next) {
  try {
    if (!req.body.csv) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'csv field is required' } });
    }

    const rows = parseCsv(req.body.csv);
    let imported = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        if (!row.first_name || !row.last_name) {
          errors.push({ row: i + 2, error: 'first_name and last_name are required' });
          continue;
        }
        await db.query(
          `INSERT INTO clients (organization_id, first_name, last_name, email, phone, city, state, country, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
          [req.orgId, row.first_name, row.last_name, row.email || null,
            row.phone || null, row.city || null, row.state || null, row.country || null],
        );
        imported++;
      } catch (err) {
        errors.push({ row: i + 2, error: err.message });
      }
    }

    res.json({ data: { imported, total: rows.length, errors } });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/import/devices
 * Import devices from CSV.
 * Expected columns: name, ip_address, type, site_id, mac_address, snmp_community
 */
async function importDevices(req, res, next) {
  try {
    if (!req.body.csv) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'csv field is required' } });
    }

    const rows = parseCsv(req.body.csv);
    let imported = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        if (!row.name || !row.ip_address) {
          errors.push({ row: i + 2, error: 'name and ip_address are required' });
          continue;
        }
        await db.query(
          `INSERT INTO devices (organization_id, name, ip_address, type, site_id, mac_address, snmp_community, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
          [req.orgId, row.name, row.ip_address, row.type || 'router',
            row.site_id || null, row.mac_address || null, row.snmp_community || null],
        );
        imported++;
      } catch (err) {
        errors.push({ row: i + 2, error: err.message });
      }
    }

    res.json({ data: { imported, total: rows.length, errors } });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/import/contracts
 * Import contracts from CSV.
 * Expected columns: client_id, plan_id, start_date, connection_type
 */
async function importContracts(req, res, next) {
  try {
    if (!req.body.csv) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'csv field is required' } });
    }

    const rows = parseCsv(req.body.csv);
    let imported = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        if (!row.client_id || !row.plan_id) {
          errors.push({ row: i + 2, error: 'client_id and plan_id are required' });
          continue;
        }
        await db.query(
          `INSERT INTO contracts (organization_id, client_id, plan_id, start_date, connection_type, status)
           VALUES (?, ?, ?, ?, ?, 'active')`,
          [req.orgId, row.client_id, row.plan_id,
            row.start_date || new Date().toISOString().slice(0, 10),
            row.connection_type || 'fiber'],
        );
        imported++;
      } catch (err) {
        errors.push({ row: i + 2, error: err.message });
      }
    }

    res.json({ data: { imported, total: rows.length, errors } });
  } catch (err) {
    next(err);
  }
}

module.exports = { importClients, importDevices, importContracts, parseCsv, parseCsvLine };
