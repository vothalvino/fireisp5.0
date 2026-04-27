// =============================================================================
// FireISP 5.0 — Tenant Database Isolation Service
// =============================================================================

const OrganizationDatabaseConfig = require('../models/OrganizationDatabaseConfig');
const db = require('../config/database');
const { ValidationError } = require('../utils/errors');

function validateIsolationPayload(payload, existing = null) {
  const body = payload || {};
  const mode = body.isolation_mode || existing?.isolation_mode || 'shared';
  if (!['shared', 'isolated'].includes(mode)) {
    throw new ValidationError('isolation_mode must be shared or isolated');
  }

  const allowed = new Set([
    'isolation_mode', 'db_host', 'db_port', 'db_name', 'db_user',
    'db_password', 'ssl_enabled',
  ]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) throw new ValidationError(`Unknown database isolation field: ${key}`);
  }

  if (body.db_port !== undefined && body.db_port !== null && body.db_port !== '') {
    const port = Number(body.db_port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ValidationError('db_port must be an integer between 1 and 65535');
    }
  }

  if (mode === 'isolated') {
    const merged = {
      db_host: body.db_host ?? existing?.db_host,
      db_name: body.db_name ?? existing?.db_name,
      db_user: body.db_user ?? existing?.db_user,
      has_password: body.db_password !== undefined || existing?.has_password,
    };
    for (const key of ['db_host', 'db_name', 'db_user']) {
      if (!merged[key]) throw new ValidationError(`${key} is required when isolation_mode is isolated`);
    }
    if (!merged.has_password) {
      throw new ValidationError('db_password is required when isolation_mode is isolated');
    }
  }

  return { ...body, isolation_mode: mode };
}

async function getDatabaseIsolation(orgId) {
  return OrganizationDatabaseConfig.findByOrgId(orgId);
}

async function saveDatabaseIsolation(orgId, payload) {
  const existing = await OrganizationDatabaseConfig.findByOrgId(orgId);
  const fields = validateIsolationPayload(payload, existing);
  return OrganizationDatabaseConfig.upsert(orgId, fields);
}

async function testDatabaseIsolation(orgId, payload = null) {
  const raw = await OrganizationDatabaseConfig.findRawByOrgId(orgId);
  const publicExisting = OrganizationDatabaseConfig.toPublic(raw) || OrganizationDatabaseConfig.defaultForOrg(orgId);
  const fields = payload ? validateIsolationPayload(payload, publicExisting) : publicExisting;
  const candidate = payload
    ? {
      ...raw,
      organization_id: Number(orgId),
      isolation_mode: fields.isolation_mode,
      db_host: fields.db_host ?? raw?.db_host,
      db_port: fields.db_port ?? raw?.db_port ?? 3306,
      db_name: fields.db_name ?? raw?.db_name,
      db_user: fields.db_user ?? raw?.db_user,
      db_password_encrypted: fields.db_password !== undefined
        ? require('../utils/encryption').encrypt(fields.db_password)
        : raw?.db_password_encrypted,
      ssl_enabled: fields.ssl_enabled ?? raw?.ssl_enabled ?? false,
    }
    : raw;

  const config = OrganizationDatabaseConfig.toConnectionConfig(candidate);
  if (!config) throw new ValidationError('No isolated database configuration is enabled for this organization');

  await db.testTenantConnection(config);
  await OrganizationDatabaseConfig.markVerified(orgId);
  return { ok: true };
}

async function listIsolatedMigrationTargets() {
  const rows = await OrganizationDatabaseConfig.listIsolatedRaw();
  return rows.map(row => ({
    organizationId: row.organization_id,
    database: row.db_name,
    connectionConfig: OrganizationDatabaseConfig.toConnectionConfig(row),
  }));
}

module.exports = {
  validateIsolationPayload,
  getDatabaseIsolation,
  saveDatabaseIsolation,
  testDatabaseIsolation,
  listIsolatedMigrationTargets,
};
