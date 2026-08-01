// =============================================================================
// FireISP 5.0 — org-scoping helpers for tables backfilled from a parent
// =============================================================================
// Several tables gained organization_id late, backfilled from a parent row
// (an outage from its site/device, a speed test from its client/contract).
// Every one of them lands in the same three-part shape, and this is the third
// copy — so it lives here rather than being hand-written a fourth time.
//
// THE PROBLEM THIS SOLVES
//
// BaseModel.hasOrgScope is a boolean: either it emits `organization_id = ?` or
// it emits NOTHING. Neither is correct for a backfilled table.
//
//   * false — the predicate is omitted SILENTLY, so list/get/update/delete run
//     unscoped and every tenant reads and writes every other tenant's rows.
//
//   * true, alone — a bare `organization_id = ?` HIDES every row the backfill
//     could not attribute. The parent columns are themselves nullable
//     ("NULL = single-tenant deployment"), so a single-tenant install
//     legitimately backfills to NULL and would see an empty page. That is the
//     anti-fix rejected in #582: worse than the leak, because it is silent.
//
// So reads admit `mine OR unattributed`, which BaseModel cannot express, and
// writes stay strict (`= ?`) with an adoption step in front.
//
// WHY ADOPTION
//
// A strict write predicate makes unattributed rows permanently un-editable —
// a legacy 'ongoing' outage would sit on every tenant's dashboard with no way
// to resolve it. Letting the first tenant that writes to one claim it fixes
// that, and the set only ever shrinks: once the owning migration has run,
// every new row is stamped at creation, so nothing new becomes unattributed.
// =============================================================================

const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'orgAdoption' });

/**
 * The read predicate: rows this tenant owns, plus unattributed legacy rows.
 *
 * Binds exactly one parameter (the org id). Pair it with
 * `(<alias>.organization_id IS NULL) AS is_unattributed` in the SELECT list so
 * the UI can explain why a visible row has no owner — the same idea as
 * is_shared (#566) and is_global (#582).
 *
 * @param {string} alias table alias used in the query
 */
function visibleToOrg(alias) {
  return `(${alias}.organization_id = ? OR ${alias}.organization_id IS NULL)`;
}

/**
 * Refuse any attempt to move a row between tenants.
 *
 * organization_id has to stay fillable (create injects it, adoption sets it)
 * and the update schemas do not declare it — and validate() IGNORES undeclared
 * fields rather than stripping them. Without this guard a PUT could hand the
 * row to another org, or NULL it and make it unattributed again.
 *
 * @param {string} label human name of the record, for the error message
 */
function rejectOrgReassignment(label) {
  return function rejectOrgReassignmentMiddleware(req, res, next) {
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'organization_id')) {
      return res.status(422).json({
        error: {
          code: 'ORG_IMMUTABLE',
          message: `A ${label} cannot be moved to another organization.`,
        },
      });
    }
    next();
  };
}

/**
 * Let the first tenant that writes to an unattributed row ADOPT it.
 *
 * MUST BE MOUNTED AFTER validate(), NOT BEFORE IT.
 *
 * Adoption is a committed write with no transaction around it. Mounted ahead of
 * validation, a request that then 422s STILL transfers the row: `PUT
 * /outages/<legacy id> {"severity":"catastrophic"}` fails on the enum, nothing
 * is updated — and the row now belongs to the caller. It vanishes from every
 * other tenant's list (the `org = ? OR org IS NULL` predicate stops matching),
 * their PUT/DELETE 404, and there is no route that can hand it back. A failed
 * request must not have permanent side effects, least of all ownership ones.
 *
 * Still runs BEFORE the write itself, so the model's `organization_id = ?`
 * matches once the request is known to be well-formed.
 * The UPDATE is itself guarded by `IS NULL` so that two tenants adopting
 * concurrently cannot have the second overwrite the first — the loser's
 * UPDATE matches zero rows and its subsequent write 404s, which is the
 * correct outcome.
 *
 * @param {string} table physical table name (trusted, never user input)
 * @param {string} label human name of the record, for the log line
 */
function adoptUnattributed(table, label) {
  return async function adoptUnattributedMiddleware(req, res, next) {
    try {
      const [rows] = await db.query(
        `SELECT organization_id FROM ${table} WHERE id = ? LIMIT 1`, [req.params.id],
      );
      if (rows[0] && rows[0].organization_id === null && req.orgId) {
        await db.query(
          `UPDATE ${table} SET organization_id = ? WHERE id = ? AND organization_id IS NULL`,
          [req.orgId, req.params.id],
        );
        logger.info({ table, recordId: req.params.id, organizationId: req.orgId },
          `Adopted an unattributed ${label} into the acting organization`);
      }
      next();
    } catch (err) { next(err); }
  };
}

module.exports = { visibleToOrg, rejectOrgReassignment, adoptUnattributed };
