jest.mock('../src/utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), fatal: jest.fn() }),
}));

jest.mock('../src/config/database', () => ({ query: jest.fn() }));

jest.mock('../src/services/firerelayTunnel', () => ({
  tunnelServer: { sendCommand: jest.fn(), isConnected: jest.fn() },
}));

const db = require('../src/config/database');
const { tunnelServer } = require('../src/services/firerelayTunnel');
const {
  computeDiff,
  runComplianceAudit,
  pullBackupWithDiff,
  deployConfigTemplate,
  sha256,
} = require('../src/services/configBackupService');

describe('computeDiff', () => {
  test('returns empty string for identical content', () => {
    expect(computeDiff('line1\nline2', 'line1\nline2')).toBe('');
  });

  test('returns diff lines with +/- for changed content', () => {
    const diff = computeDiff('line1\nline2', 'line1\nline3');
    expect(diff).toContain('-line2');
    expect(diff).toContain('+line3');
  });

  test('returns only additions for new content', () => {
    const diff = computeDiff('', 'newline');
    expect(diff).toContain('+newline');
  });
});

describe('runComplianceAudit', () => {
  afterEach(() => jest.clearAllMocks());

  const backupRow = { id: 1, device_id: 10, content: 'ip route add\nno telnet' };
  const deviceRow = { id: 10, device_type: 'router' };

  function setupMocks(rules) {
    db.query
      .mockResolvedValueOnce([[backupRow]])   // load backup
      .mockResolvedValueOnce([[deviceRow]])   // load device
      .mockResolvedValueOnce([rules]);        // load rules
    // For each rule insert
    rules.forEach(() => db.query.mockResolvedValueOnce([{ insertId: 99 }]));
  }

  test('must_contain: passes when pattern present', async () => {
    const rules = [{ id: 1, rule_type: 'must_contain', pattern: 'ip route', applies_to_device_type: null }];
    setupMocks(rules);
    const result = await runComplianceAudit(1, 5);
    expect(result.passed).toBe(1);
    expect(result.failed).toBe(0);
  });

  test('must_not_contain: fails when pattern present', async () => {
    const rules = [{ id: 1, rule_type: 'must_not_contain', pattern: 'no telnet', applies_to_device_type: null }];
    setupMocks(rules);
    const result = await runComplianceAudit(1, 5);
    expect(result.passed).toBe(0);
    expect(result.failed).toBe(1);
  });

  test('regex_match: passes when regex matches', async () => {
    const rules = [{ id: 1, rule_type: 'regex_match', pattern: 'ip\\s+route', applies_to_device_type: null }];
    setupMocks(rules);
    const result = await runComplianceAudit(1, 5);
    expect(result.passed).toBe(1);
  });

  test('inserts result rows into db', async () => {
    const rules = [{ id: 1, rule_type: 'must_contain', pattern: 'ip route', applies_to_device_type: null }];
    setupMocks(rules);
    await runComplianceAudit(1, 5);
    // 4 queries: backup, device, rules, INSERT
    expect(db.query).toHaveBeenCalledTimes(4);
    const insertCall = db.query.mock.calls[3];
    expect(insertCall[0]).toContain('INSERT INTO config_compliance_results');
  });

  test('throws when backup not found', async () => {
    db.query.mockResolvedValueOnce([[]]); // empty backup
    await expect(runComplianceAudit(999, 5)).rejects.toThrow('not found');
  });
});

describe('pullBackupWithDiff', () => {
  afterEach(() => jest.clearAllMocks());

  test('returns skipped result unchanged', async () => {
    const content = 'same config';
    const checksum = sha256(content);
    // pullBackupForDevice will be called internally — mock db
    tunnelServer.sendCommand.mockResolvedValueOnce({ content, configType: 'mikrotik_export' });
    db.query
      .mockResolvedValueOnce([[{ content: 'old' }]])      // prevContent lookup
      .mockResolvedValueOnce([[{ checksum }]])             // getLatestChecksum — same → skip
    ;
    const result = await pullBackupWithDiff({
      deviceId: 1, nodeId: 'n1', host: '1.2.3.4', user: 'admin', password: 'x',
    });
    expect(result.skipped).toBe(true);
  });

  test('updates backup with diff when new backup is stored', async () => {
    const prevContent = 'line1\nline2';
    const newContent = 'line1\nline3';
    const oldChecksum = sha256(prevContent);
    const newChecksum = sha256(newContent);

    tunnelServer.sendCommand.mockResolvedValueOnce({ content: newContent, configType: 'mikrotik_export' });
    db.query
      .mockResolvedValueOnce([[{ content: prevContent }]])  // prevContent
      .mockResolvedValueOnce([[{ checksum: oldChecksum }]]) // getLatestChecksum (different → new backup)
      .mockResolvedValueOnce([[{ version: 1 }]])            // getLatestVersion
      .mockResolvedValueOnce([{ insertId: 5 }])             // INSERT
      .mockResolvedValueOnce([[{ content: newContent }]])   // new content for diff
      .mockResolvedValueOnce([{ affectedRows: 1 }])         // UPDATE diff
    ;
    const result = await pullBackupWithDiff({
      deviceId: 1, nodeId: 'n1', host: '1.2.3.4', user: 'admin', password: 'x',
    });
    expect(result.skipped).toBe(false);
    expect(result.backupId).toBe(5);
    expect(result.checksum).toBe(newChecksum);
    // Verify UPDATE was called
    const updateCall = db.query.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('UPDATE device_config_backups SET diff_from_previous'));
    expect(updateCall).toBeDefined();
  });
});

describe('deployConfigTemplate', () => {
  afterEach(() => jest.clearAllMocks());

  test('renders template with variables and creates deployment record', async () => {
    tunnelServer.isConnected.mockReturnValue(false);
    db.query
      .mockResolvedValueOnce([[{ id: 1, organization_id: 5, template_content: 'hostname {{hostname}}', status: 'active' }]])
      .mockResolvedValueOnce([[{ id: 10, firerelay_node_id: null }]])
      .mockResolvedValueOnce([{ insertId: 20 }]);
    const record = await deployConfigTemplate(1, 10, { hostname: 'Router1' }, 99);
    expect(record.id).toBe(20);
    expect(record.status).toBe('success');
    expect(db.query.mock.calls[2][0]).toContain('INSERT INTO config_deployment_records');
  });

  test('throws when template not found', async () => {
    db.query.mockResolvedValueOnce([[]]);
    await expect(deployConfigTemplate(999, 1, {}, 1)).rejects.toThrow('not found');
  });

  test('throws when device not found', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 1, organization_id: 5, template_content: 'x', status: 'active' }]])
      .mockResolvedValueOnce([[]]); // device not found
    await expect(deployConfigTemplate(1, 999, {}, 1)).rejects.toThrow('not found');
  });
});
