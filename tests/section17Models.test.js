// =============================================================================
// FireISP 5.0 — Section 17 Model Unit Tests
// Tests that the §17 model classes load correctly and have the right properties
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));

const db = require('../src/config/database');
const WebAuthnCredential = require('../src/models/WebAuthnCredential');
const AdminIpAllowlist = require('../src/models/AdminIpAllowlist');
const PasswordPolicy = require('../src/models/PasswordPolicy');
const ApiKeyRateLimit = require('../src/models/ApiKeyRateLimit');
const FirewallRule = require('../src/models/FirewallRule');
const DdosProtectionRule = require('../src/models/DdosProtectionRule');
const BlackholeRoute = require('../src/models/BlackholeRoute');
const DnsBlocklist = require('../src/models/DnsBlocklist');
const CpeSecurityScan = require('../src/models/CpeSecurityScan');
const EncryptionKeyMetadata = require('../src/models/EncryptionKeyMetadata');
const DataMaskingRule = require('../src/models/DataMaskingRule');
const SecureDeletionLog = require('../src/models/SecureDeletionLog');

describe('§17 Models — schema properties', () => {
  it('WebAuthnCredential has correct tableName and orgScope', () => {
    expect(WebAuthnCredential.tableName).toBe('webauthn_credentials');
    expect(WebAuthnCredential.hasOrgScope).toBe(true);
    expect(WebAuthnCredential.softDelete).toBe(true);
    expect(Array.isArray(WebAuthnCredential.fillable)).toBe(true);
    expect(WebAuthnCredential.fillable).toContain('user_id');
    expect(WebAuthnCredential.fillable).toContain('credential_id');
    expect(WebAuthnCredential.fillable).toContain('public_key');
  });

  it('AdminIpAllowlist has correct tableName and orgScope', () => {
    expect(AdminIpAllowlist.tableName).toBe('admin_ip_allowlist');
    expect(AdminIpAllowlist.hasOrgScope).toBe(true);
    expect(Array.isArray(AdminIpAllowlist.fillable)).toBe(true);
    expect(AdminIpAllowlist.fillable).toContain('ip_address');
    expect(AdminIpAllowlist.fillable).toContain('organization_id');
  });

  it('PasswordPolicy has correct tableName and orgScope', () => {
    expect(PasswordPolicy.tableName).toBe('password_policies');
    expect(PasswordPolicy.hasOrgScope).toBe(true);
    expect(Array.isArray(PasswordPolicy.fillable)).toBe(true);
    expect(PasswordPolicy.fillable).toContain('min_length');
    expect(PasswordPolicy.fillable).toContain('organization_id');
  });

  it('ApiKeyRateLimit has correct tableName and orgScope', () => {
    expect(ApiKeyRateLimit.tableName).toBe('api_key_rate_limits');
    expect(ApiKeyRateLimit.hasOrgScope).toBe(true);
    expect(Array.isArray(ApiKeyRateLimit.fillable)).toBe(true);
    expect(ApiKeyRateLimit.fillable).toContain('token_id');
    expect(ApiKeyRateLimit.fillable).toContain('requests_per_minute');
  });

  it('FirewallRule has correct tableName, orgScope, and softDelete', () => {
    expect(FirewallRule.tableName).toBe('firewall_rules');
    expect(FirewallRule.hasOrgScope).toBe(true);
    expect(FirewallRule.softDelete).toBe(true);
    expect(Array.isArray(FirewallRule.fillable)).toBe(true);
    expect(FirewallRule.fillable).toContain('action');
    expect(FirewallRule.fillable).toContain('protocol');
  });

  it('DdosProtectionRule has correct tableName and orgScope', () => {
    expect(DdosProtectionRule.tableName).toBe('ddos_protection_rules');
    expect(DdosProtectionRule.hasOrgScope).toBe(true);
    expect(Array.isArray(DdosProtectionRule.fillable)).toBe(true);
    expect(DdosProtectionRule.fillable).toContain('rule_type');
    expect(DdosProtectionRule.fillable).toContain('target_prefix');
  });

  it('BlackholeRoute has correct tableName and orgScope', () => {
    expect(BlackholeRoute.tableName).toBe('blackhole_routes');
    expect(BlackholeRoute.hasOrgScope).toBe(true);
    expect(Array.isArray(BlackholeRoute.fillable)).toBe(true);
    expect(BlackholeRoute.fillable).toContain('target_prefix');
    expect(BlackholeRoute.fillable).toContain('reason');
  });

  it('DnsBlocklist has correct tableName and orgScope', () => {
    expect(DnsBlocklist.tableName).toBe('dns_blocklists');
    expect(DnsBlocklist.hasOrgScope).toBe(true);
    expect(Array.isArray(DnsBlocklist.fillable)).toBe(true);
    expect(DnsBlocklist.fillable).toContain('domain');
    expect(DnsBlocklist.fillable).toContain('category');
  });

  it('CpeSecurityScan has correct tableName and orgScope', () => {
    expect(CpeSecurityScan.tableName).toBe('cpe_security_scans');
    expect(CpeSecurityScan.hasOrgScope).toBe(true);
    expect(Array.isArray(CpeSecurityScan.fillable)).toBe(true);
    expect(CpeSecurityScan.fillable).toContain('scan_type');
    expect(CpeSecurityScan.fillable).toContain('status');
  });

  it('EncryptionKeyMetadata has correct tableName and orgScope', () => {
    expect(EncryptionKeyMetadata.tableName).toBe('encryption_key_metadata');
    expect(EncryptionKeyMetadata.hasOrgScope).toBe(true);
    expect(Array.isArray(EncryptionKeyMetadata.fillable)).toBe(true);
    expect(EncryptionKeyMetadata.fillable).toContain('key_alias');
    expect(EncryptionKeyMetadata.fillable).toContain('algorithm');
  });

  it('DataMaskingRule has correct tableName and orgScope', () => {
    expect(DataMaskingRule.tableName).toBe('data_masking_rules');
    expect(DataMaskingRule.hasOrgScope).toBe(true);
    expect(Array.isArray(DataMaskingRule.fillable)).toBe(true);
    expect(DataMaskingRule.fillable).toContain('table_name');
    expect(DataMaskingRule.fillable).toContain('column_name');
  });

  it('SecureDeletionLog has correct tableName and orgScope', () => {
    expect(SecureDeletionLog.tableName).toBe('secure_deletion_log');
    expect(SecureDeletionLog.hasOrgScope).toBe(true);
    expect(Array.isArray(SecureDeletionLog.fillable)).toBe(true);
    expect(SecureDeletionLog.fillable).toContain('table_name');
    expect(SecureDeletionLog.fillable).toContain('records_deleted');
  });
});

describe('§17 Models — BaseModel inheritance', () => {
  const BaseModel = require('../src/models/BaseModel');

  it('WebAuthnCredential extends BaseModel', () => {
    expect(Object.getPrototypeOf(WebAuthnCredential)).toBe(BaseModel);
  });

  it('FirewallRule extends BaseModel', () => {
    expect(Object.getPrototypeOf(FirewallRule)).toBe(BaseModel);
  });

  it('DdosProtectionRule extends BaseModel', () => {
    expect(Object.getPrototypeOf(DdosProtectionRule)).toBe(BaseModel);
  });

  it('BlackholeRoute extends BaseModel', () => {
    expect(Object.getPrototypeOf(BlackholeRoute)).toBe(BaseModel);
  });

  it('DnsBlocklist extends BaseModel', () => {
    expect(Object.getPrototypeOf(DnsBlocklist)).toBe(BaseModel);
  });

  it('EncryptionKeyMetadata extends BaseModel', () => {
    expect(Object.getPrototypeOf(EncryptionKeyMetadata)).toBe(BaseModel);
  });

  it('BaseModel.fillable returns empty array by default', () => {
    expect(BaseModel.fillable).toEqual([]);
  });

  it('BaseModel.hasOrgScope returns false by default', () => {
    expect(BaseModel.hasOrgScope).toBe(false);
  });
});

describe('Lead — model properties', () => {
  const Lead = require('../src/models/Lead');

  it('Lead.softDelete is true', () => {
    expect(Lead.softDelete).toBe(true);
  });
});

describe('DeviceGroup — static methods', () => {
  const DeviceGroup = require('../src/models/DeviceGroup');

  afterEach(() => { jest.clearAllMocks(); });

  it('removeMember deletes the device_group_member row and returns affectedRows', async () => {
    db.query.mockResolvedValue([{ affectedRows: 1 }]);
    const affected = await DeviceGroup.removeMember(10, 5);
    expect(affected).toBe(1);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM device_group_members'),
      [10, 5],
    );
  });
});
