// =============================================================================
// FireISP 5.0 — Device FK Authorization Guard
// =============================================================================
// Shared "does this FK belong to the caller's organization?" guard for any
// write path that can set devices.client_id or devices.contract_id (cross-
// tenant FKs linking a device to the customer/service it serves). validate()
// only checks type/min — without this an org-A caller could link a device to
// an org-B client or contract id. Mirrors assertPlanSelectable
// (src/services/planAvailability.js) and assertServiceOrderFks
// (src/routes/serviceOrders.js).
//
// Used by routes/devices.js (POST/PUT/PATCH) and routes/discoveryScans.js
// (POST /:id/results/:resultId/onboard, which also builds a Device.create
// payload and accepts caller-supplied overrides).
//
// A null value is always allowed (clears/unassigns the link) since there is
// no org to check.
// =============================================================================

const Client = require('../models/Client');
const Contract = require('../models/Contract');
const { ValidationError } = require('../utils/errors');

/**
 * @param {object} body - Request body (or equivalent create/update payload)
 * @param {number|null} orgId - Caller's organization id
 * @throws {ValidationError} when body.client_id / body.contract_id is set and
 *   does not resolve to a record in this organization
 */
async function assertDeviceClientFk(body, orgId) {
  if (body.client_id !== undefined && body.client_id !== null) {
    const client = await Client.findById(body.client_id, orgId);
    if (!client) throw new ValidationError('client_id does not belong to this organization');
  }
  if (body.contract_id !== undefined && body.contract_id !== null) {
    const contract = await Contract.findById(body.contract_id, orgId);
    if (!contract) throw new ValidationError('contract_id does not belong to this organization');
  }
}

module.exports = { assertDeviceClientFk };
