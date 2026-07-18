// =============================================================================
// FireISP 5.0 — Client Group Routes (family/account grouping) — §1.1
// =============================================================================

const { Router } = require('express');
const ClientGroup = require('../models/ClientGroup');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createClientGroup, updateClientGroup, payClientGroup } = require('../middleware/schemas/clientGroups');
const groupBillingService = require('../services/groupBillingService');
const auditLog = require('../services/auditLog');
const logger = require('../utils/logger').child({ service: 'routes/clientGroups' });

const router = Router();

// A group's designated primary IS its billing owner, so it must be a member.
// After create/update, ensure the chosen primary is in the group (org-scoped —
// a cross-org / nonexistent id simply isn't added, and payGroup then refuses
// to bill until a real member is primary). This closes the "primary set to a
// non-member" gap without blocking the natural create-with-primary flow.
async function ensurePrimaryIsMember(record, req) {
  if (record && record.primary_client_id) {
    await ClientGroup.addMembers(record.id, [record.primary_client_id], req.orgId);
  }
}

const ctrl = crudController(ClientGroup, {
  cacheResource: 'client-groups',
  afterCreate: ensurePrimaryIsMember,
  afterUpdate: ensurePrimaryIsMember,
});

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('clients.view'), ctrl.list);
router.get('/:id', requirePermission('clients.view'), ctrl.get);
router.post('/', requirePermission('clients.create'), validate(createClientGroup), ctrl.create);
router.put('/:id', requirePermission('clients.update'), validate(updateClientGroup), ctrl.update);
router.patch('/:id', requirePermission('clients.update'), validate(updateClientGroup), ctrl.partialUpdate);
router.delete('/:id', requirePermission('clients.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('clients.update'), ctrl.restore);

// Members of a group
router.get('/:id/members', requirePermission('clients.view'), async (req, res, next) => {
  try {
    await ClientGroup.findByIdOrFail(req.params.id, req.orgId);
    const members = await ClientGroup.getMembers(req.params.id, req.orgId);
    res.json({ data: members });
  } catch (err) { next(err); }
});

// Add existing clients to this group in one call (clients.update). The
// group-centric way to build a group, instead of editing each client's
// profile one at a time.
router.post('/:id/members', requirePermission('clients.update'), async (req, res, next) => {
  try {
    await ClientGroup.findByIdOrFail(req.params.id, req.orgId);
    const clientIds = req.body?.client_ids;
    if (!Array.isArray(clientIds) || clientIds.length === 0) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'client_ids must be a non-empty array.' } });
    }
    const added = await ClientGroup.addMembers(req.params.id, clientIds, req.orgId);
    await auditLog.log({
      userId: req.user?.id, organizationId: req.orgId, action: 'update',
      tableName: 'client_groups', recordId: Number(req.params.id),
      summary: `Added ${added} member(s) to client group #${req.params.id}`,
      newValues: { client_ids: clientIds },
    });
    const members = await ClientGroup.getMembers(req.params.id, req.orgId);
    res.json({ data: { added, members } });
  } catch (err) { next(err); }
});

// Remove one client from this group (clears primary if it was the primary).
router.delete('/:id/members/:clientId', requirePermission('clients.update'), async (req, res, next) => {
  try {
    await ClientGroup.findByIdOrFail(req.params.id, req.orgId);
    const removed = await ClientGroup.removeMember(req.params.id, req.params.clientId, req.orgId);
    if (!removed) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'That client is not a member of this group.' } });
    }
    await auditLog.log({
      userId: req.user?.id, organizationId: req.orgId, action: 'update',
      tableName: 'client_groups', recordId: Number(req.params.id),
      summary: `Removed client #${req.params.clientId} from client group #${req.params.id}`,
    });
    const members = await ClientGroup.getMembers(req.params.id, req.orgId);
    res.json({ data: { members } });
  } catch (err) { next(err); }
});

// Shared-billing: the group's combined balance + open invoices (payments.view).
router.get('/:id/billing', requirePermission('payments.view'), async (req, res, next) => {
  try {
    const data = await groupBillingService.getGroupBilling(req.orgId, req.params.id);
    res.json({ data });
  } catch (err) { next(err); }
});

// Shared-billing: the primary pays the group's balance (payments.create).
router.post('/:id/pay', requirePermission('payments.create'), validate(payClientGroup), async (req, res, next) => {
  try {
    const result = await groupBillingService.payGroup(req.orgId, req.params.id, {
      amount: req.body.amount,
      payment_method: req.body.payment_method,
      reference_number: req.body.reference_number,
      invoice_ids: req.body.invoice_ids,
      actorUserId: req.user?.id,
    });
    logger.info({ groupId: req.params.id, paymentId: result.payment.id, actorUserId: req.user?.id }, 'Group balance paid');
    await auditLog.log({
      userId: req.user?.id, organizationId: req.orgId, action: 'create',
      tableName: 'payments', recordId: result.payment.id,
      summary: `Group payment ${result.payment.amount} for client group #${req.params.id} — settled ${result.settled_invoices.length} invoice(s)`,
    });
    res.status(201).json({ data: result });
  } catch (err) { next(err); }
});

module.exports = router;
