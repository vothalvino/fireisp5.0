'use strict';

const crypto = require('crypto');
const service = require('../src/services/mxRegisteredContractTemplateService');

const BODY = '# Contrato registrado\nTexto exacto {{client.name}}';
const RECORD = {
  id: 71,
  organization_id: 42,
  template_name: 'Contrato 2026',
  ift_registration_number: 'IFT-2026-001',
  registered_at: '2026-01-15',
  version: '2026.1',
  template_body: BODY,
  status: 'registered',
  deleted_at: null,
};

describe('MX registered contract-template bridge', () => {
  test('accepts only an exact organization-owned registered source and returns immutable evidence', async () => {
    const run = jest.fn().mockResolvedValue([[RECORD]]);

    const snapshot = await service.validateTemplateState(run, {
      orgId: 42,
      templateType: 'activation_contract',
      bodyMd: BODY,
      isActive: true,
      contractTemplateMxId: 71,
      lock: true,
    });

    expect(snapshot).toEqual({
      contractTemplateMxId: 71,
      registrationNumber: 'IFT-2026-001',
      registeredAt: '2026-01-15',
      version: '2026.1',
      sourceSha256: crypto.createHash('sha256').update(BODY).digest('hex'),
    });
    expect(run.mock.calls[0][0]).toMatch(/contract_templates_mx[\s\S]*FOR UPDATE/);
  });

  test.each([
    ['unlinked', null, BODY, null],
    ['different text', 71, `${BODY}\nchanged`, RECORD],
    ['draft registration', 71, BODY, { ...RECORD, status: 'draft' }],
    ['missing registration number', 71, BODY, { ...RECORD, ift_registration_number: null }],
    ['missing registration date', 71, BODY, { ...RECORD, registered_at: null }],
    ['archived registration', 71, BODY, { ...RECORD, deleted_at: '2026-08-11' }],
  ])('rejects an active template with %s', async (_label, id, bodyMd, row) => {
    const run = jest.fn().mockResolvedValue([row ? [row] : []]);
    await expect(service.validateTemplateState(run, {
      orgId: 42,
      templateType: 'activation_contract',
      bodyMd,
      isActive: true,
      contractTemplateMxId: id,
    })).rejects.toMatchObject({ statusCode: 422 });
  });

  test('allows an inactive unlinked draft but never an MX link on a generic document', async () => {
    const run = jest.fn();
    await expect(service.validateTemplateState(run, {
      orgId: 42,
      templateType: 'activation_contract',
      bodyMd: BODY,
      isActive: false,
      contractTemplateMxId: null,
    })).resolves.toBeNull();
    await expect(service.validateTemplateState(run, {
      orgId: 42,
      templateType: 'custom',
      bodyMd: BODY,
      isActive: false,
      contractTemplateMxId: 71,
    })).rejects.toMatchObject({ statusCode: 422 });
  });

  test.each(['expired', 'revoked'])(
    'allows an exact linked %s source only for an explicitly-authorized deactivation',
    async (status) => {
      const terminalRecord = { ...RECORD, status };
      const run = jest.fn().mockResolvedValue([[terminalRecord]]);

      await expect(service.validateTemplateState(run, {
        orgId: 42,
        templateType: 'activation_contract',
        bodyMd: BODY,
        isActive: false,
        contractTemplateMxId: 71,
        allowTerminalSourceForDeactivation: true,
      })).resolves.toMatchObject({ contractTemplateMxId: 71 });

      await expect(service.validateTemplateState(run, {
        orgId: 42,
        templateType: 'activation_contract',
        bodyMd: BODY,
        isActive: false,
        contractTemplateMxId: 71,
      })).rejects.toThrow(/status is registered/i);
      await expect(service.validateTemplateState(run, {
        orgId: 42,
        templateType: 'activation_contract',
        bodyMd: BODY,
        isActive: true,
        contractTemplateMxId: 71,
        allowTerminalSourceForDeactivation: true,
      })).rejects.toThrow(/status is registered/i);
    },
  );

  test('rejects MX registration records on a global contract', async () => {
    const run = jest.fn().mockResolvedValueOnce([[{ locale: 'global' }]]);
    await expect(service.validateContractSelection(run, {
      orgId: 42,
      contractTemplateMxId: 71,
    })).rejects.toThrow(/Global contracts cannot use/i);
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('resolves and locks the one source shared by active MX activation documents', async () => {
    const activeTemplate = {
      id: 8,
      organization_id: 42,
      template_type: 'activation_contract',
      name: 'Operational contract',
      body_md: BODY,
      is_active: 1,
      contract_template_mx_id: 71,
      mx_id: 71,
      mx_organization_id: 42,
      mx_registration_number: RECORD.ift_registration_number,
      mx_registered_at: RECORD.registered_at,
      mx_template_version: RECORD.version,
      mx_template_body: BODY,
      mx_status: 'registered',
      mx_deleted_at: null,
    };
    const run = jest.fn()
      .mockResolvedValueOnce([[{ locale: 'MX' }]])
      .mockResolvedValueOnce([[activeTemplate]]);

    await expect(service.resolveActiveContractSource(run, {
      orgId: 42,
      lock: true,
    })).resolves.toMatchObject({ contractTemplateMxId: 71 });

    expect(run.mock.calls[0][0]).toMatch(/organizations[\s\S]*FOR UPDATE/);
    expect(run.mock.calls[1][0]).toMatch(/document_templates[\s\S]*FOR UPDATE/);
  });

  test('rejects missing, conflicting, or non-MX active contract sources', async () => {
    await expect(service.resolveActiveContractSource(
      jest.fn()
        .mockResolvedValueOnce([[{ locale: 'MX' }]])
        .mockResolvedValueOnce([[]]),
      { orgId: 42 },
    )).rejects.toThrow(/configure and activate/i);

    const activeTemplate = {
      organization_id: 42,
      template_type: 'activation_contract',
      name: 'Operational contract',
      body_md: BODY,
      is_active: 1,
      contract_template_mx_id: 71,
      mx_id: 71,
      mx_organization_id: 42,
      mx_registration_number: RECORD.ift_registration_number,
      mx_registered_at: RECORD.registered_at,
      mx_template_version: RECORD.version,
      mx_template_body: BODY,
      mx_status: 'registered',
      mx_deleted_at: null,
    };
    await expect(service.resolveActiveContractSource(
      jest.fn()
        .mockResolvedValueOnce([[{ locale: 'MX' }]])
        .mockResolvedValueOnce([[activeTemplate]]),
      { orgId: 42, contractTemplateMxId: 72 },
    )).rejects.toThrow(/active activation document/i);

    await expect(service.resolveActiveContractSource(
      jest.fn().mockResolvedValueOnce([[{ locale: 'global' }]]),
      { orgId: 42, contractTemplateMxId: 71 },
    )).rejects.toThrow(/Global contracts cannot use/i);
  });

  test('requires every concurrently-active MX document to use one registered source', () => {
    const base = {
      organization_id: 42,
      template_type: 'activation_contract',
      is_active: 1,
      body_md: BODY,
      mx_organization_id: 42,
      mx_registration_number: 'IFT-2026-001',
      mx_registered_at: '2026-01-15',
      mx_template_version: '1',
      mx_template_body: BODY,
      mx_status: 'registered',
    };
    expect(() => service.assertOneRegisteredSource([
      { ...base, id: 1, name: 'A', contract_template_mx_id: 71, mx_id: 71 },
      { ...base, id: 2, name: 'B', contract_template_mx_id: 72, mx_id: 72 },
    ], 42)).toThrow(/same registered contract template/i);
  });
});
