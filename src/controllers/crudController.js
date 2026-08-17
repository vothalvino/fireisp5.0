// =============================================================================
// FireISP 5.0 — CRUD Controller Factory
// =============================================================================
// Generates standard list/get/create/update/delete handlers for any model.
// Controllers can override or extend these defaults.
// =============================================================================

const db = require('../config/database');
const auditLog = require('../services/auditLog');
const { bustCache } = require('../middleware/httpCache');
const { AppError } = require('../utils/errors');
const logger = require('../utils/logger').child({ service: 'crudController' });

/**
 * Create standard CRUD handlers for a model.
 * @param {typeof import('../models/BaseModel')} Model
 * @param {object} [options]
 * @param {string} [options.resourceName] - Name for error messages
 * @param {string} [options.cacheResource] - Cache resource name to bust on mutations
 */
function crudController(Model, _options = {}) {
  const { cacheResource } = _options;
  // Optional response serializer — lets a resource strip sensitive columns
  // (e.g. User.sanitize) from every record before it is returned.  Defaults to
  // identity so existing resources are unaffected.
  const serialize = typeof _options.serialize === 'function' ? _options.serialize : (x) => x;
  // Optional audit-value sanitizer for resources whose writable records carry
  // secrets. It changes only the JSON snapshot sent to auditLog; persistence,
  // hooks, and API serialization continue to receive the original values.
  const sanitizeAuditValues = typeof _options.sanitizeAuditValues === 'function'
    ? _options.sanitizeAuditValues
    : (values) => values;
  // Optional create override — lets a resource customise the insert (e.g. Nas
  // restore-on-create by IP) while keeping org-injection, audit-log, cache-bust
  // and serialize behaviour identical. Defaults to a plain Model.create.
  const createFn = typeof _options.createImpl === 'function'
    ? _options.createImpl
    : (data) => Model.create(data);
  // Optional post-create hook — called after the create succeeds. NEVER allowed
  // to fail the create response; errors are caught and logged. Receives
  // (record, req). Useful for side-effects like WireGuard provisioning.
  const afterCreateHook = typeof _options.afterCreate === 'function' ? _options.afterCreate : null;
  // Optional post-delete hook — called after the delete succeeds with the record
  // as it was BEFORE deletion (and req). NEVER allowed to fail the delete
  // response; errors are caught and logged. Useful for teardown side-effects
  // (e.g. revoking a deleted user's WireGuard peers).
  const afterDeleteHook = typeof _options.afterDelete === 'function' ? _options.afterDelete : null;
  // Optional post-restore hook — called after a soft-deleted record is restored,
  // with the restored record (and req). NEVER allowed to fail the restore
  // response; errors are caught and logged. The inverse of afterDelete (e.g.
  // reviving a NAS's WireGuard tunnel that teardown soft-deleted).
  const afterRestoreHook = typeof _options.afterRestore === 'function' ? _options.afterRestore : null;
  // Optional pre-update guard — called with the EXISTING record (and req) right
  // after it is fetched and BEFORE the update is applied (PUT and PATCH). Unlike
  // the after* hooks this one MAY throw (e.g. an AppError) to reject the update;
  // the error propagates to the error handler. Reuses the existing fetch, so it
  // adds no extra query. Useful for terminal-state guards (e.g. voided invoices).
  const beforeUpdateHook = typeof _options.beforeUpdate === 'function' ? _options.beforeUpdate : null;
  // Opt-in: run fetch → beforeUpdate → update inside ONE transaction with the
  // row locked by SELECT ... FOR UPDATE.
  //
  // Without it, beforeUpdate is a guard but not a guarantee: it reads on one
  // pooled connection and the UPDATE lands on another, so a concurrent writer
  // can slip between them and invalidate whatever the guard just checked. For
  // invoices that means an invoice can be stamped microseconds after the
  // no-live-CFDI guard cleared it, and the edit then applies to a stamped,
  // fiscally-registered document.
  //
  // It makes THIS side of such a race atomic. It cannot fix a counterpart that
  // reads its own snapshot before taking a lock — that has to be fixed there.
  //
  // Every statement a hook runs must go through the executor it is handed. One
  // left on db.query acquires a second pooled connection while this one is
  // still checked out, and enough concurrent requests doing that exhaust the
  // pool and hang, since acquisition waits without a timeout.
  //
  // Left opt-in rather than made the default: it takes a pooled connection for
  // the duration of the update, and most resources have no cross-row invariant
  // worth that cost. Turn it on where a beforeUpdate hook is enforcing
  // something that a concurrent write could falsify.
  // Covers UPDATE, DELETE and RESTORE. It was `transactionalWrites` when only
  // the update path had it; delete and restore have exactly the same problem —
  // their beforeDelete/beforeRestore guards read on one pooled connection while
  // the write lands on another. For credit notes that meant a note could be
  // soft-deleted moments after its egreso was filed at SAT, leaving a filed
  // document pointing at a deleted row.
  const transactionalWrites = _options.transactionalWrites === true;
  // Some security-bearing resources need the dependent after-update/restore
  // write to be part of the SAME locked transaction as the primary change.
  // A post-commit CAS is too late: another writer can alter the row between
  // commit and the hook, then accidentally receive the dependent marker.
  // This option is intentionally narrow (update/restore only); create can put
  // an invariant marker in its single INSERT.
  const transactionalAfterHooks = _options.transactionalAfterHooks === true;

  // A model that OVERRIDES update/findById drops `opts` unless it deliberately
  // forwards it, and the failure is severe and invisible:
  //   * overridden update  → the lock is taken on connection A while the UPDATE
  //     runs on connection B, which then blocks on A's own lock. Guaranteed
  //     self-deadlock until innodb_lock_wait_timeout, or forever if the pool is
  //     saturated.
  //   * overridden findById → the post-write read-back runs on another
  //     connection, cannot see the uncommitted row, and the API returns
  //     PRE-UPDATE values on a successful update.
  //
  // Detected by identity, NOT by arity: Function.length stops counting at the
  // first defaulted parameter, so BaseModel.update(id, data, orgId = null,
  // opts = {}) reports 2 and an arity check rejects the very implementation it
  // is meant to accept. Inheriting BaseModel's method is the safe case; any
  // override is unverifiable from here and must opt in explicitly by setting
  // `forwardsExecutor = true` on the model.
  if (transactionalWrites) {
    const BaseModel = require('../models/BaseModel');
    // A jest-mocked model replaces these by definition, and the check has
    // nothing to say about a stand-in that never touches a real connection.
    const mocked = Boolean(Model.update?._isMockFunction || Model.findById?._isMockFunction);
    const overrides = [];
    if (Model.update !== BaseModel.update) overrides.push('update');
    if (Model.findById !== BaseModel.findById) overrides.push('findById');
    if (!mocked && overrides.length && Model.forwardsExecutor !== true) {
      throw new Error(
        `${Model.name} overrides ${overrides.join(' and ')} and is used with transactionalWrites. `
        + 'An override that ignores the trailing opts argument runs outside the transaction — a self-deadlock '
        + 'for update, stale reads for findById. Accept opts, pass it through, then set '
        + '`static get forwardsExecutor() { return true; }` on the model.',
      );
    }
  }
  // Optional pre-create hook — called with (req) after organization_id has been
  // injected and BEFORE the row is inserted. Like beforeUpdate it MAY throw to
  // reject the create, and it may mutate req.body. Needed for invariants that
  // must be reconciled ACROSS rows rather than validated within one — e.g.
  // demoting the previous default before a new default is inserted, where an
  // after* hook is useless because the insert has already tripped the unique
  // index by then.
  const beforeCreateHook = typeof _options.beforeCreate === 'function' ? _options.beforeCreate : null;
  // Optional pre-delete guard — called with the EXISTING record (and req) right
  // after it is fetched and BEFORE the delete is applied. Like beforeUpdate it
  // MAY throw to reject. Reuses the existing fetch, so it costs no extra query.
  // afterDelete cannot serve this purpose: it runs once the row is already gone
  // AND its errors are deliberately swallowed as advisory.
  const beforeDeleteHook = typeof _options.beforeDelete === 'function' ? _options.beforeDelete : null;
  // Same, for the restore path — un-deleting a row can be just as consequential
  // as deleting it (it resurrects an invoice whose CFDI is cancelled at SAT).
  // Called with (req) rather than a record: restore does not pre-fetch, and
  // adding a read just to feed the hook would cost a query on every restore.
  const beforeRestoreHook = typeof _options.beforeRestore === 'function' ? _options.beforeRestore : null;
  // Optional post-update hook — called after the update succeeds (PUT and
  // PATCH) with the updated record (and req). Same non-fatal contract as
  // afterCreate by default: errors are caught and logged, never failing the
  // response. Useful for dependent-row sync (e.g. a user's organization
  // memberships).
  const afterUpdateHook = typeof _options.afterUpdate === 'function' ? _options.afterUpdate : null;
  // When true, afterCreate/afterUpdate errors PROPAGATE to the error handler
  // instead of being swallowed. Use for hooks that maintain authorization-
  // bearing state (e.g. organization access sync): a silent 200 with stale
  // privileged state is worse than surfacing the failure to the caller.
  // Note the primary row change has already been applied and audit-logged at
  // hook time — the error tells the caller to retry the dependent sync.
  const fatalAfterHooks = _options.fatalAfterHooks === true;
  if (transactionalAfterHooks && (!transactionalWrites || !fatalAfterHooks)) {
    throw new Error('transactionalAfterHooks requires transactionalWrites and fatalAfterHooks');
  }

  /**
   * Shared by PUT and PATCH: fetch the row, run the guard, apply the update.
   *
   * With transactionalWrites the three steps share one connection and the row
   * is locked for the whole sequence, so nothing can change it between the
   * guard passing and the write landing. Without it, this is the original
   * behaviour, unchanged.
   *
   * beforeUpdate receives the executor as a third argument so a hook can run
   * ITS OWN reads on the same transaction. A hook that ignores it (all the
   * existing ones do) behaves exactly as before — but a hook that queries
   * related rows to make its decision, like the invoice no-live-CFDI guard,
   * MUST use it or it is still reading outside the lock and the transaction
   * buys nothing.
   */
  /**
   * Run `fn` with a locked row inside one transaction, or plainly when the
   * resource has not opted in. Shared by update, delete and restore so the
   * three cannot drift — the guard-then-write race is identical in all of them.
   *
   * `fn(exec, old)` receives the executor and the locked record.
   */
  async function inLockedTransaction(req, { needsRow = true }, fn) {
    if (!transactionalWrites) {
      const old = needsRow ? await Model.findByIdOrFail(req.params.id, req.orgId) : null;
      return fn(db.query, old);
    }

    const conn = await db.getConnection();
    let disposed = false;
    try {
      await conn.beginTransaction();
      const exec = conn.execute.bind(conn);
      const old = needsRow
        ? await Model.findByIdOrFail(req.params.id, req.orgId, { exec, forUpdate: true })
        : null;
      const out = await fn(exec, old);
      await conn.commit();
      return out;
    } catch (err) {
      try {
        await conn.rollback();
      } catch {
        if (typeof conn.destroy === 'function') { disposed = true; try { conn.destroy(); } catch { /* gone */ } }
      }
      throw err;
    } finally {
      if (!disposed) { try { conn.release(); } catch { /* pool dropped it */ } }
    }
  }

  async function applyUpdate(req) {
    // A record can never be moved between tenants through generic CRUD.
    //
    // This is not defence in depth — it closed a live cross-tenant WRITE.
    // organization_id is in `fillable` on 134 models (it has to be: create
    // injects it), the update validation schemas do not declare it, and
    // validate() IGNORES undeclared fields rather than stripping them. So
    // `PUT /clients/:id {"organization_id": 2}` reached Model.update and was
    // written: the record left the caller's tenant and appeared in the target
    // org, carrying attacker-controlled fields. It even returned 500 rather
    // than 200 — the post-update re-fetch is scoped to the OLD org, finds
    // nothing and throws — so it looked like it had failed while having
    // succeeded.
    //
    // 66 routes mount ctrl.update; before this, 4 guarded it individually.
    // The check belongs here, once, where every one of them passes through.
    //
    // Only `update` is guarded, never `create` — create legitimately injects
    // organization_id a few lines below, and adoption of an unattributed row
    // is a direct db.query that does not come through here.
    if (
      Model.hasOrgScope
      && req.body
      && Object.prototype.hasOwnProperty.call(req.body, 'organization_id')
    ) {
      throw new AppError(
        'A record cannot be moved to another organization.',
        422,
        'ORG_IMMUTABLE',
      );
    }

    if (!transactionalWrites) {
      const old = await Model.findByIdOrFail(req.params.id, req.orgId);
      if (beforeUpdateHook) await beforeUpdateHook(old, req, db.query);
      const record = await Model.update(req.params.id, req.body, req.orgId);
      return { old, record };
    }

    const conn = await db.getConnection();
    // Tracked so the connection is handed back exactly once on every path — a
    // double release corrupts the pool as surely as a leak does.
    let disposed = false;
    try {
      await conn.beginTransaction();
      const exec = conn.execute.bind(conn);
      const old = await Model.findByIdOrFail(req.params.id, req.orgId, { exec, forUpdate: true });
      if (beforeUpdateHook) await beforeUpdateHook(old, req, exec);
      const record = await Model.update(req.params.id, req.body, req.orgId, { exec });
      if (transactionalAfterHooks && afterUpdateHook) {
        await afterUpdateHook(record, req, exec);
      }
      await conn.commit();
      return { old, record };
    } catch (err) {
      // A guard that threw must leave the row untouched.
      try {
        await conn.rollback();
      } catch {
        // Releasing a connection whose ROLLBACK failed hands the next borrower
        // one with an open transaction and its locks still held. Destroy it
        // instead and let the pool open a clean one.
        //
        // disposed is set BEFORE the call, and the call cannot throw out of
        // here: otherwise a destroy() that throws would skip the flag, fall
        // into finally, and release the wedged connection anyway — the exact
        // outcome this branch exists to prevent — while replacing the real
        // error with its own.
        if (typeof conn.destroy === 'function') {
          disposed = true;
          try { conn.destroy(); } catch { /* already gone; the pool drops it */ }
        }
      }
      throw err;
    } finally {
      // A release() that throws here would REPLACE the error being propagated,
      // turning a 422 guard rejection into an opaque 500.
      if (!disposed) {
        try { conn.release(); } catch { /* pool already dropped it */ }
      }
    }
  }

  return {
    /**
     * GET / — List with pagination
     */
    async list(req, res, next) {
      try {
        const { page = 1, limit = 50, order_by, order, include_deleted, only_deleted, ...filters } = req.query;
        const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
        const withDeleted = include_deleted === 'true';
        // Archived-records view (e.g. the Users page's Archived tab): list
        // ONLY soft-deleted rows. Wins over include_deleted.
        const onlyDeleted = only_deleted === 'true';

        const [rows, total] = await Promise.all([
          Model.findAll({
            where: filters,
            orderBy: order_by || 'id',
            order: order || 'ASC',
            limit: Math.min(parseInt(limit), 100),
            offset,
            orgId: req.orgId,
            withDeleted,
            onlyDeleted,
          }),
          Model.count({ where: filters, orgId: req.orgId, withDeleted, onlyDeleted }),
        ]);

        res.json({
          data: Array.isArray(rows) ? rows.map(serialize) : rows,
          meta: {
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(total / parseInt(limit)),
          },
        });
      } catch (err) {
        next(err);
      }
    },

    /**
     * GET /:id — Get by ID
     */
    async get(req, res, next) {
      try {
        const record = await Model.findByIdOrFail(req.params.id, req.orgId);
        res.json({ data: serialize(record) });
      } catch (err) {
        next(err);
      }
    },

    /**
     * POST / — Create
     */
    async create(req, res, next) {
      try {
        // Auto-inject organization_id if the model supports it
        if (Model.hasOrgScope && req.orgId) {
          req.body.organization_id = req.orgId;
        }

        // After the org injection, so a hook reconciling per-org state sees the
        // org it will actually be written with.
        if (beforeCreateHook) await beforeCreateHook(req);

        const record = await createFn(req.body);

        await auditLog.log({
          userId: req.user?.id,
          organizationId: req.orgId,
          action: 'create',
          tableName: Model.tableName,
          recordId: record.id,
          newValues: sanitizeAuditValues(req.body, req, 'create'),
        });

        if (cacheResource) await bustCache(req.orgId, cacheResource);

        // Run the optional post-create hook. Wrapped in try/catch so it can
        // NEVER fail the create response — side-effect errors are advisory.
        if (afterCreateHook) {
          if (fatalAfterHooks) {
            await afterCreateHook(record, req);
          } else {
            try {
              await afterCreateHook(record, req);
            } catch (hookErr) {
              logger.warn(
                { err: hookErr.message, recordId: record.id, table: Model.tableName },
                'crudController afterCreate hook failed (non-fatal)',
              );
            }
          }
        }

        res.status(201).json({ data: serialize(record) });
      } catch (err) {
        next(err);
      }
    },

    /**
     * PUT /:id — Update
     */
    async update(req, res, next) {
      try {
        const { old, record } = await applyUpdate(req);

        await auditLog.log({
          userId: req.user?.id,
          organizationId: req.orgId,
          action: 'update',
          tableName: Model.tableName,
          recordId: record.id,
          oldValues: sanitizeAuditValues(old, req, 'update_old'),
          newValues: sanitizeAuditValues(req.body, req, 'update_new'),
        });

        if (cacheResource) await bustCache(req.orgId, cacheResource);

        if (afterUpdateHook && !transactionalAfterHooks) {
          if (fatalAfterHooks) {
            await afterUpdateHook(record, req);
          } else {
            try {
              await afterUpdateHook(record, req);
            } catch (hookErr) {
              logger.warn(
                { err: hookErr.message, recordId: record.id, table: Model.tableName },
                'crudController afterUpdate hook failed (non-fatal)',
              );
            }
          }
        }

        res.json({ data: serialize(record) });
      } catch (err) {
        next(err);
      }
    },

    /**
     * PATCH /:id — Partial update
     */
    async partialUpdate(req, res, next) {
      try {
        const { old, record } = await applyUpdate(req);

        await auditLog.log({
          userId: req.user?.id,
          organizationId: req.orgId,
          action: 'partial_update',
          tableName: Model.tableName,
          recordId: record.id,
          oldValues: sanitizeAuditValues(old, req, 'partial_update_old'),
          newValues: sanitizeAuditValues(req.body, req, 'partial_update_new'),
        });

        if (cacheResource) await bustCache(req.orgId, cacheResource);

        if (afterUpdateHook && !transactionalAfterHooks) {
          if (fatalAfterHooks) {
            await afterUpdateHook(record, req);
          } else {
            try {
              await afterUpdateHook(record, req);
            } catch (hookErr) {
              logger.warn(
                { err: hookErr.message, recordId: record.id, table: Model.tableName },
                'crudController afterUpdate hook failed (non-fatal)',
              );
            }
          }
        }

        res.json({ data: serialize(record) });
      } catch (err) {
        next(err);
      }
    },

    /**
     * DELETE /:id — Soft-delete (archive) or hard-delete depending on model
     */
    async destroy(req, res, next) {
      try {
        // Same race as update: beforeDelete decides from rows a concurrent
        // request can change. For credit notes that guard is "does a live CFDI
        // exist" — and a stamp landing between the check and the write leaves a
        // soft-deleted row whose egreso is filed at SAT.
        const { old } = await inLockedTransaction(req, {}, async (exec, locked) => {
          if (beforeDeleteHook) await beforeDeleteHook(locked, req, exec);
          await Model.delete(req.params.id, req.orgId, { exec });
          return { old: locked };
        });

        await auditLog.log({
          userId: req.user?.id,
          organizationId: req.orgId,
          action: Model.softDelete ? 'soft_delete' : 'delete',
          tableName: Model.tableName,
          recordId: parseInt(req.params.id),
          oldValues: sanitizeAuditValues(old, req, 'delete'),
        });

        if (cacheResource) await bustCache(req.orgId, cacheResource);

        // Run the optional post-delete hook with the pre-delete record. Wrapped
        // in try/catch so it can NEVER fail the delete response — teardown
        // side-effect errors are advisory.
        if (afterDeleteHook) {
          try {
            await afterDeleteHook(old, req);
          } catch (hookErr) {
            logger.warn(
              { err: hookErr.message, recordId: old.id, table: Model.tableName },
              'crudController afterDelete hook failed (non-fatal)',
            );
          }
        }

        res.status(204).send();
      } catch (err) {
        next(err);
      }
    },

    /**
     * POST /:id/restore — Restore a soft-deleted record
     */
    async restore(req, res, next) {
      try {
        // needsRow:false — the row is soft-deleted, so findByIdOrFail (which
        // filters deleted_at IS NULL) cannot fetch it. The lock therefore comes
        // from Model.restore's own UPDATE; the guard still runs on the same
        // connection, inside the same transaction, so a CFDI stamped in the
        // window is visible to it.
        const record = await inLockedTransaction(req, { needsRow: false }, async (exec) => {
          if (beforeRestoreHook) await beforeRestoreHook(req, exec);
          const restored = await Model.restore(req.params.id, req.orgId, { exec });
          if (transactionalAfterHooks && afterRestoreHook) {
            await afterRestoreHook(restored, req, exec);
          }
          return restored;
        });

        await auditLog.log({
          userId: req.user?.id,
          organizationId: req.orgId,
          action: 'restore',
          tableName: Model.tableName,
          recordId: record.id,
        });

        if (cacheResource) await bustCache(req.orgId, cacheResource);

        // Run the optional post-restore hook with the restored record. Wrapped
        // in try/catch by default so advisory side effects do not fail restore.
        // Security-bearing resources may opt into fatalAfterHooks, matching
        // create/update, so a failed dependent-state CAS is never reported 200.
        if (afterRestoreHook && !transactionalAfterHooks) {
          if (fatalAfterHooks) {
            await afterRestoreHook(record, req);
          } else {
            try {
              await afterRestoreHook(record, req);
            } catch (hookErr) {
              logger.warn(
                { err: hookErr.message, recordId: record.id, table: Model.tableName },
                'crudController afterRestore hook failed (non-fatal)',
              );
            }
          }
        }

        res.json({ data: serialize(record) });
      } catch (err) {
        next(err);
      }
    },
  };
}

module.exports = { crudController };
