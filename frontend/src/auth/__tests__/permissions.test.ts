// =============================================================================
// FireISP 5.0 — permissions helper tests
// =============================================================================
import { describe, it, expect } from 'vitest';
import { can } from '../permissions';

describe('can()', () => {
  it('grants every permission to admin', () => {
    expect(can('admin', 'clients.create')).toBe(true);
    expect(can('admin', 'clients.delete')).toBe(true);
    expect(can('admin', 'devices.delete')).toBe(true);
  });

  it('lets support create/update clients but not delete', () => {
    expect(can('support', 'clients.create')).toBe(true);
    expect(can('support', 'clients.update')).toBe(true);
    expect(can('support', 'clients.delete')).toBe(false);
  });

  it('lets technician manage devices but not clients', () => {
    expect(can('technician', 'devices.create')).toBe(true);
    expect(can('technician', 'devices.update')).toBe(true);
    expect(can('technician', 'devices.delete')).toBe(true);
    expect(can('technician', 'clients.create')).toBe(false);
  });

  it('denies billing and read-only roles', () => {
    expect(can('billing', 'clients.create')).toBe(false);
    expect(can('read-only', 'devices.create')).toBe(false);
  });

  it('denies when role is undefined or unknown', () => {
    expect(can(undefined, 'clients.create')).toBe(false);
    expect(can('mystery', 'clients.create')).toBe(false);
  });
});
