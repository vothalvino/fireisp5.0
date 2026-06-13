// =============================================================================
// FireISP 5.0 — Data Residency Routes (§16.8)
// Covers: data_residency_config
// =============================================================================

const { Router } = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');

const router = Router();

router.use(authenticate);
router.use(orgScope);

// GET / — get config for org
router.get('/', requirePermission('data_residency.view'), async (req, res, next) => {
  try {
    const [[row]] = await db.query(
      'SELECT * FROM data_residency_config WHERE organization_id = ? LIMIT 1',
      [req.orgId],
    );

    if (!row) return res.status(404).json({ error: 'No data residency config found' });
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

// POST / — create/upsert config
router.post('/', requirePermission('data_residency.manage'), async (req, res, next) => {
  try {
    const {
      primary_storage_country,
      primary_storage_region,
      backup_storage_country,
      backup_storage_region,
      cross_border_transfers_allowed,
      cross_border_destinations,
      dr_site_country,
      dr_site_region,
      notes,
    } = req.body;

    const [result] = await db.query(
      `INSERT INTO data_residency_config (organization_id, primary_storage_country, primary_storage_region, backup_storage_country, backup_storage_region, cross_border_transfers_allowed, cross_border_destinations, dr_site_country, dr_site_region, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         primary_storage_country = VALUES(primary_storage_country),
         primary_storage_region = VALUES(primary_storage_region),
         backup_storage_country = VALUES(backup_storage_country),
         backup_storage_region = VALUES(backup_storage_region),
         cross_border_transfers_allowed = VALUES(cross_border_transfers_allowed),
         cross_border_destinations = VALUES(cross_border_destinations),
         dr_site_country = VALUES(dr_site_country),
         dr_site_region = VALUES(dr_site_region),
         notes = VALUES(notes),
         updated_at = NOW()`,
      [req.orgId, primary_storage_country, primary_storage_region || null, backup_storage_country || null, backup_storage_region || null, cross_border_transfers_allowed ? 1 : 0, cross_border_destinations || null, dr_site_country || null, dr_site_region || null, notes || null],
    );

    res.status(201).json({ id: result.insertId || null });
  } catch (err) {
    next(err);
  }
});

// PUT / — update config
router.put('/', requirePermission('data_residency.manage'), async (req, res, next) => {
  try {
    const {
      primary_storage_country,
      primary_storage_region,
      backup_storage_country,
      backup_storage_region,
      cross_border_transfers_allowed,
      cross_border_destinations,
      dr_site_country,
      dr_site_region,
      notes,
    } = req.body;

    await db.query(
      `UPDATE data_residency_config SET primary_storage_country = ?, primary_storage_region = ?, backup_storage_country = ?, backup_storage_region = ?, cross_border_transfers_allowed = ?, cross_border_destinations = ?, dr_site_country = ?, dr_site_region = ?, notes = ?, updated_at = NOW()
       WHERE organization_id = ?`,
      [primary_storage_country, primary_storage_region || null, backup_storage_country || null, backup_storage_region || null, cross_border_transfers_allowed ? 1 : 0, cross_border_destinations || null, dr_site_country || null, dr_site_region || null, notes || null, req.orgId],
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /check — run compliance check
router.post('/check', requirePermission('data_residency.manage'), async (req, res, next) => {
  try {
    const [[config]] = await db.query(
      'SELECT primary_storage_country FROM data_residency_config WHERE organization_id = ? LIMIT 1',
      [req.orgId],
    );

    const compliance_status = config && config.primary_storage_country === 'MX' ? 'compliant' : 'non_compliant';

    await db.query(
      'UPDATE data_residency_config SET last_compliance_check = NOW(), compliance_status = ?, updated_at = NOW() WHERE organization_id = ?',
      [compliance_status, req.orgId],
    );

    res.json({ compliance_status, checked_at: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
