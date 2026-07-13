// =============================================================================
// FireISP 5.0 — Bulk Import Controller
// =============================================================================
// CSV bulk import for clients, devices, contracts, invoices, and payments.
// Supports two modes:
//   • JSON body:  POST with { csv: "..." }
//   • File upload: POST multipart/form-data with field "file" (.csv)
// =============================================================================

const db = require('../config/database');
const provisioningService = require('../services/subscriberProvisioningService');
const Client = require('../models/Client');
const { assertPlanSelectable } = require('../services/planAvailability');

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
 * Expected columns: name, email, phone, city, state, country
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
        if (!row.name) {
          errors.push({ row: i + 2, error: 'name is required' });
          continue;
        }
        await db.query(
          `INSERT INTO clients (organization_id, name, email, phone, city, state, country, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
          [req.orgId, row.name, row.email || null,
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
          // devices.status is ENUM('online','offline','maintenance') — an imported
          // device has not been polled yet, so it starts 'offline' (database/schema.sql).
          `INSERT INTO devices (organization_id, name, ip_address, type, site_id, mac_address, snmp_community, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'offline')`,
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

// ---------------------------------------------------------------------------
// Contract import helpers
// ---------------------------------------------------------------------------

const CONNECTION_TYPES = new Set(['pppoe', 'pppoe_dual', 'static', 'dual']);

// radius.password is VARCHAR(255) (database/migrations/008_create_radius_table.sql,
// renamed password_hash -> password in migration 189).
const MAX_PPPOE_PASSWORD_LEN = 255;
// Defense-in-depth safe-charset restriction on a caller-supplied PPPoE
// username: usernames eventually get pushed into RouterOS/NAS command
// construction elsewhere in the codebase. Stricter than POST /radius
// (createRadius schema has no charset restriction beyond length) deliberately
// — CSV import is the more exposed, bulk-untrusted-input surface.
const PPPOE_USERNAME_RE = /^[A-Za-z0-9._@-]{1,64}$/;

/**
 * Insert one contract row from a parsed row object.
 *
 * Mirrors lifecycleService.startOrder's new-contract path: the contract is
 * created `pending`, network resources are provisioned on the SAME
 * transaction (which creates a RADIUS account for pppoe/pppoe_dual rows so
 * the subscriber can actually authenticate), and only then is the contract
 * flipped to `active`. This keeps every imported row consistent with the
 * trg_contracts_radius_consistency_bu trigger (migration 128), which only
 * fires on UPDATE — a single-statement INSERT with status='active' bypasses
 * it entirely and can leave a PPPoE contract that can never authenticate.
 * static/dual rows have no RADIUS account (provisionNewContract only tracks
 * their `ip_address` for duplicates, and this CSV import has no ip_address
 * column yet), so they go through the same pending → active flow as a no-op
 * provisioning step.
 *
 * Optional columns `pppoe_username` / `pppoe_password` let an operator carry
 * over pre-existing PPPoE credentials instead of always auto-generating a
 * new pair — both columns must be present together (on a pppoe/pppoe_dual
 * row only) or the row errors; a duplicate supplied username errors the row
 * via the same uniqueness rule as auto-generated usernames
 * (assertUsernameAvailable). The caller-supplied password is never echoed
 * back in the response — only the username is (see the `credentials` array
 * below), matching migration 383's radius.credentials.view gating for
 * cleartext password exposure.
 *
 * Returns `{ error }` on failure (validation or DB, already rolled back), or
 * `{ contractId, pppoeUsername }` on success — `pppoeUsername` is only set
 * for pppoe/pppoe_dual rows so the operator can export the (generated or
 * caller-supplied) username.
 */
async function insertContractRow(row, orgId) {
  if (!row.client_id || !row.plan_id) return { error: 'client_id and plan_id are required' };

  const connectionType = row.connection_type || 'pppoe';
  if (!CONNECTION_TYPES.has(connectionType)) {
    return { error: `connection_type must be one of: ${[...CONNECTION_TYPES].join(', ')}` };
  }

  // Optional caller-supplied PPPoE credentials (CSV columns pppoe_username /
  // pppoe_password). Validated up front, before the org-verify DB round trips
  // below, so an obviously-malformed pair fails fast without wasted queries.
  const rawUsername = row.pppoe_username || '';
  const rawPassword = row.pppoe_password || '';
  const hasUsername = rawUsername !== '';
  const hasPassword = rawPassword !== '';
  let pppoeCreds;
  if (hasUsername || hasPassword) {
    if (hasUsername !== hasPassword) {
      return { error: 'pppoe_username and pppoe_password must both be provided together' };
    }
    if (!provisioningService.isPppoe(connectionType)) {
      return { error: 'pppoe_username/pppoe_password only apply to connection_type pppoe or pppoe_dual' };
    }
    if (!PPPOE_USERNAME_RE.test(rawUsername)) {
      return { error: 'pppoe_username must be 1-64 characters: letters, digits, ".", "_", "@", or "-"' };
    }
    if (rawPassword.length > MAX_PPPOE_PASSWORD_LEN) {
      return { error: `pppoe_password must be at most ${MAX_PPPOE_PASSWORD_LEN} characters` };
    }
    pppoeCreds = { username: rawUsername, password: rawPassword };
  }

  // Org-verify BOTH FKs before opening a transaction — read-only lookups, no
  // need to hold them inside the transactional connection. Mirrors
  // routes/contracts.js's client_id/plan_id guards (security hardening) so a
  // CSV row can never attach a contract to another organization's client, or
  // provision it against another organization's plan — the JSON POST route
  // already org-verifies plan_id via assertPlanSelectable, but this importer
  // previously skipped that check entirely. Caught here (rather than left to
  // throw) so a single bad row reports a per-row `{ error }` and the loop in
  // importContracts/importContractsFile continues to the next row instead of
  // an unexpected exception changing shape mid-loop.
  try {
    const client = await Client.findById(row.client_id, orgId);
    if (!client) return { error: 'client_id does not belong to this organization' };
    await assertPlanSelectable(db, row.plan_id, orgId);
  } catch (err) {
    return { error: err.message };
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const contractData = {
      organization_id: orgId,
      client_id: row.client_id,
      plan_id: row.plan_id,
      start_date: row.start_date || new Date().toISOString().slice(0, 10),
      connection_type: connectionType,
      status: 'pending',
    };
    const cols = Object.keys(contractData);
    const [ins] = await conn.query(
      `INSERT INTO contracts (${cols.map(c => `\`${c}\``).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      Object.values(contractData),
    );
    const contractId = ins.insertId;

    const [clientRows] = await conn.query('SELECT name FROM clients WHERE id = ? LIMIT 1', [row.client_id]);
    const seed = clientRows[0] && clientRows[0].name;

    const provisioning = await provisioningService.provisionNewContract(
      conn,
      { id: contractId, ...contractData },
      { seed, pppoeUsername: pppoeCreds?.username, pppoePassword: pppoeCreds?.password },
    );

    await conn.query("UPDATE contracts SET status = 'active' WHERE id = ?", [contractId]);

    await conn.commit();
    return { contractId, pppoeUsername: provisioning.pppoe ? provisioning.pppoe.username : undefined };
  } catch (err) {
    await conn.rollback();
    return { error: err.message };
  } finally {
    conn.release();
  }
}

/**
 * POST /api/import/contracts
 * Import contracts from CSV.
 * Expected columns: client_id, plan_id, start_date, connection_type
 * connection_type must be one of pppoe, pppoe_dual, static, dual (defaults
 * to pppoe when omitted); pppoe/pppoe_dual rows get a RADIUS account
 * provisioned automatically — see the `credentials` array in the response.
 * Optional columns pppoe_username / pppoe_password carry over pre-existing
 * PPPoE credentials instead of auto-generating a pair; both columns must be
 * present together on a pppoe/pppoe_dual row. A duplicate supplied username,
 * an unpaired column, or credentials on a static/dual row error only that
 * row (via the existing per-row `{ error }` contract) without aborting the
 * rest of the import — see insertContractRow.
 */
async function importContracts(req, res, next) {
  try {
    if (!req.body.csv) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'csv field is required' } });
    }

    const rows = parseCsv(req.body.csv);
    let imported = 0;
    const errors = [];
    const credentials = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const result = await insertContractRow(row, req.orgId);
        if (result.error) {
          errors.push({ row: i + 2, error: result.error });
        } else {
          imported++;
          if (result.pppoeUsername) {
            credentials.push({ row: i + 2, contract_id: result.contractId, username: result.pppoeUsername });
          }
        }
      } catch (err) {
        errors.push({ row: i + 2, error: err.message });
      }
    }

    res.json({ data: { imported, total: rows.length, errors, credentials } });
  } catch (err) {
    next(err);
  }
}

/**
 * Parse the uploaded CSV file buffer and return rows as objects.
 * @param {Buffer} buffer Raw file buffer (UTF-8 CSV)
 */
function parseUploadedFile(buffer) {
  return parseCsv(buffer.toString('utf8'));
}

// ---------------------------------------------------------------------------
// File-upload import handlers (multipart/form-data, field: "file")
// ---------------------------------------------------------------------------

/**
 * POST /api/import/clients/upload
 * Import clients from an uploaded CSV file.
 */
async function importClientsFile(req, res, next) {
  try {
    if (!req.file) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'file is required' } });
    }

    const rows = parseUploadedFile(req.file.buffer);
    let imported = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        if (!row.name) {
          errors.push({ row: i + 2, error: 'name is required' });
          continue;
        }
        await db.query(
          `INSERT INTO clients (organization_id, name, email, phone, city, state, country, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
          [req.orgId, row.name, row.email || null,
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
 * POST /api/import/devices/upload
 * Import devices from an uploaded CSV file.
 */
async function importDevicesFile(req, res, next) {
  try {
    if (!req.file) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'file is required' } });
    }

    const rows = parseUploadedFile(req.file.buffer);
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
          // devices.status is ENUM('online','offline','maintenance') — an imported
          // device has not been polled yet, so it starts 'offline' (database/schema.sql).
          `INSERT INTO devices (organization_id, name, ip_address, type, site_id, mac_address, snmp_community, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'offline')`,
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
 * POST /api/import/contracts/upload
 * Import contracts from an uploaded CSV file.
 * Same column contract (including the optional pppoe_username /
 * pppoe_password pair) and RADIUS-provisioning behavior as importContracts
 * — see insertContractRow.
 */
async function importContractsFile(req, res, next) {
  try {
    if (!req.file) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'file is required' } });
    }

    const rows = parseUploadedFile(req.file.buffer);
    let imported = 0;
    const errors = [];
    const credentials = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const result = await insertContractRow(row, req.orgId);
        if (result.error) {
          errors.push({ row: i + 2, error: result.error });
        } else {
          imported++;
          if (result.pppoeUsername) {
            credentials.push({ row: i + 2, contract_id: result.contractId, username: result.pppoeUsername });
          }
        }
      } catch (err) {
        errors.push({ row: i + 2, error: err.message });
      }
    }

    res.json({ data: { imported, total: rows.length, errors, credentials } });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Invoice import helpers
// ---------------------------------------------------------------------------

const VALID_INVOICE_STATUSES = new Set(['draft', 'sent', 'paid', 'overdue', 'cancelled']);

/**
 * Insert one invoice row from a parsed row object.
 * Returns null on success, or an error message string.
 */
async function insertInvoiceRow(row) {
  if (!row.client_id) return 'client_id is required';
  if (!row.invoice_number) return 'invoice_number is required';
  if (!row.issue_date) return 'issue_date is required';
  if (!row.due_date) return 'due_date is required';

  const status = row.status || 'draft';
  if (!VALID_INVOICE_STATUSES.has(status)) {
    return `status must be one of: ${[...VALID_INVOICE_STATUSES].join(', ')}`;
  }

  const subtotal = parseFloat(row.subtotal) || 0;
  const taxRate = parseFloat(row.tax_rate) || 0;
  const taxAmount = parseFloat(row.tax_amount) || parseFloat((subtotal * taxRate).toFixed(2));
  const total = parseFloat(row.total) || parseFloat((subtotal + taxAmount).toFixed(2));

  await db.query(
    `INSERT INTO invoices
       (client_id, contract_id, invoice_number,
        issue_date, due_date, subtotal, tax_rate, tax_amount, total, notes, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.client_id,
      row.contract_id || null,
      row.invoice_number,
      row.issue_date,
      row.due_date,
      subtotal,
      taxRate,
      taxAmount,
      total,
      row.notes || null,
      status,
    ],
  );
  return null;
}

/**
 * POST /api/import/invoices
 * Import invoices from CSV.
 * Required columns: client_id, invoice_number, issue_date, due_date
 * Optional columns: contract_id, subtotal, tax_rate, tax_amount, total, notes, status
 */
async function importInvoices(req, res, next) {
  try {
    if (!req.body.csv) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'csv field is required' } });
    }

    const rows = parseCsv(req.body.csv);
    let imported = 0;
    const errors = [];
    const rowCount = rows.length;

    for (let i = 0; i < rowCount; i++) {
      const row = rows[i];
      try {
        const err = await insertInvoiceRow(row);
        if (err) {
          errors.push({ row: i + 2, error: err });
        } else {
          imported++;
        }
      } catch (dbErr) {
        errors.push({ row: i + 2, error: dbErr.message });
      }
    }

    res.json({ data: { imported, total: rowCount, errors } });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/import/invoices/upload
 * Import invoices from an uploaded CSV file.
 */
async function importInvoicesFile(req, res, next) {
  try {
    if (!req.file) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'file is required' } });
    }

    const rows = parseUploadedFile(req.file.buffer);
    let imported = 0;
    const errors = [];
    const rowCount = rows.length;

    for (let i = 0; i < rowCount; i++) {
      const row = rows[i];
      try {
        const err = await insertInvoiceRow(row);
        if (err) {
          errors.push({ row: i + 2, error: err });
        } else {
          imported++;
        }
      } catch (dbErr) {
        errors.push({ row: i + 2, error: dbErr.message });
      }
    }

    res.json({ data: { imported, total: rowCount, errors } });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Payment import helpers
// ---------------------------------------------------------------------------

const VALID_PAYMENT_METHODS = new Set([
  'cash', 'check', 'credit_card', 'debit_card', 'bank_transfer',
  'oxxo_pay', 'spei', 'codi', 'convenience_store', 'digital_wallet', 'other',
]);

/**
 * Insert one payment row from a parsed row object.
 * Returns null on success, or an error message string.
 */
async function insertPaymentRow(row) {
  if (!row.client_id) return 'client_id is required';
  if (!row.amount) return 'amount is required';
  if (!row.payment_date) return 'payment_date is required';

  const method = row.payment_method || 'cash';
  if (!VALID_PAYMENT_METHODS.has(method)) {
    return `payment_method must be one of: ${[...VALID_PAYMENT_METHODS].join(', ')}`;
  }

  const amount = parseFloat(row.amount);
  if (isNaN(amount) || amount <= 0) return 'amount must be a positive number';

  await db.query(
    `INSERT INTO payments
       (client_id, invoice_id, amount, payment_date,
        payment_method, sat_forma_pago, reference_number, clabe, bank_name, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.client_id,
      row.invoice_id || null,
      amount,
      row.payment_date,
      method,
      row.sat_forma_pago || null,
      row.reference_number || null,
      row.clabe || null,
      row.bank_name || null,
      row.notes || null,
    ],
  );
  return null;
}

/**
 * POST /api/import/payments
 * Import payments from CSV.
 * Required columns: client_id, amount, payment_date
 * Optional columns: invoice_id, payment_method, sat_forma_pago, reference_number, clabe, bank_name, notes
 */
async function importPayments(req, res, next) {
  try {
    if (!req.body.csv) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'csv field is required' } });
    }

    const rows = parseCsv(req.body.csv);
    let imported = 0;
    const errors = [];
    const rowCount = rows.length;

    for (let i = 0; i < rowCount; i++) {
      const row = rows[i];
      try {
        const err = await insertPaymentRow(row);
        if (err) {
          errors.push({ row: i + 2, error: err });
        } else {
          imported++;
        }
      } catch (dbErr) {
        errors.push({ row: i + 2, error: dbErr.message });
      }
    }

    res.json({ data: { imported, total: rowCount, errors } });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/import/payments/upload
 * Import payments from an uploaded CSV file.
 */
async function importPaymentsFile(req, res, next) {
  try {
    if (!req.file) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'file is required' } });
    }

    const rows = parseUploadedFile(req.file.buffer);
    let imported = 0;
    const errors = [];
    const rowCount = rows.length;

    for (let i = 0; i < rowCount; i++) {
      const row = rows[i];
      try {
        const err = await insertPaymentRow(row);
        if (err) {
          errors.push({ row: i + 2, error: err });
        } else {
          imported++;
        }
      } catch (dbErr) {
        errors.push({ row: i + 2, error: dbErr.message });
      }
    }

    res.json({ data: { imported, total: rowCount, errors } });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  importClients,
  importDevices,
  importContracts,
  importClientsFile,
  importDevicesFile,
  importContractsFile,
  importInvoices,
  importInvoicesFile,
  importPayments,
  importPaymentsFile,
  parseCsv,
  parseCsvLine,
  parseUploadedFile,
};
