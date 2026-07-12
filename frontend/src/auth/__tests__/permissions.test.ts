// =============================================================================
// FireISP 5.0 — permissions helper tests
// =============================================================================
import { describe, it, expect } from 'vitest';
import { can } from '../permissions';

describe('can()', () => {
  describe('admin bypass', () => {
    it('grants every permission to role=admin regardless of permissions[]', () => {
      expect(can({ role: 'admin' }, 'clients.create')).toBe(true);
      expect(can({ role: 'admin' }, 'devices.delete')).toBe(true);
      // Even an empty resolved permission set doesn't override the admin bypass —
      // mirrors the backend, where legacy users.role='admin' short-circuits RBAC.
      expect(can({ role: 'admin', permissions: [] }, 'clients.delete')).toBe(true);
    });
  });

  describe('permissions[] — authoritative', () => {
    it('allows only what is present in the resolved permission list', () => {
      const user = { role: 'support', permissions: ['clients.create', 'tickets.view'] };
      expect(can(user, 'clients.create')).toBe(true);
      expect(can(user, 'tickets.view')).toBe(true);
      expect(can(user, 'clients.delete')).toBe(false);
    });

    it('treats an empty permissions[] as deny-all, not a fallthrough', () => {
      const user = { role: 'support', permissions: [] };
      expect(can(user, 'clients.create')).toBe(false);
      expect(can(user, 'tickets.view')).toBe(false);
    });

    it('ignores the legacy ROLE_PERMISSIONS map once permissions[] is present', () => {
      // role=technician would normally grant devices.create via the fallback map,
      // but a real (possibly custom-group-scoped) permissions[] wins.
      const user = { role: 'technician', permissions: ['tickets.view'] };
      expect(can(user, 'devices.create')).toBe(false);
      expect(can(user, 'tickets.view')).toBe(true);
    });
  });

  describe('legacy role-map fallback (permissions undefined)', () => {
    it('lets support create/update clients but not delete', () => {
      expect(can({ role: 'support' }, 'clients.create')).toBe(true);
      expect(can({ role: 'support' }, 'clients.update')).toBe(true);
      expect(can({ role: 'support' }, 'clients.delete')).toBe(false);
    });

    it('lets technician manage devices but not clients', () => {
      expect(can({ role: 'technician' }, 'devices.create')).toBe(true);
      expect(can({ role: 'technician' }, 'devices.update')).toBe(true);
      expect(can({ role: 'technician' }, 'devices.delete')).toBe(true);
      expect(can({ role: 'technician' }, 'clients.create')).toBe(false);
    });

    it('denies billing and read-only roles for actions outside their map', () => {
      expect(can({ role: 'billing' }, 'clients.create')).toBe(false);
      expect(can({ role: 'read-only' }, 'devices.create')).toBe(false);
      expect(can({ role: 'readonly' }, 'devices.create')).toBe(false);
    });

    it('denies when role is undefined or unknown', () => {
      expect(can({}, 'clients.create')).toBe(false);
      expect(can({ role: 'mystery' }, 'clients.create')).toBe(false);
    });
  });

  describe('no user', () => {
    it('denies for null or undefined user', () => {
      expect(can(null, 'clients.create')).toBe(false);
      expect(can(undefined, 'clients.create')).toBe(false);
    });
  });
});
