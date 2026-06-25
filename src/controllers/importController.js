// =============================================================================
// FireISP 5.0 — Bulk Import Controller
// =============================================================================
// CSV bulk import for clients, devices, contracts, invoices, and payments.
// Supports two modes:
//   • JSON body:  POST with { csv: "..." }
//   • File upload: POST multipart/form-data with field "file" (.csv)
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
 * POST /api/import/contracts/upload
 * Import contracts from an uploaded CSV file.
 */
async function importContractsFile(req, res, next) {
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
