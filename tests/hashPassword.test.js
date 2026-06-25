// =============================================================================
// FireISP 5.0 — hashPasswordField middleware tests
// =============================================================================
// Regression guard: POST /api/v1/users 500'd on every create because the generic
// crudController never converted the schema's plaintext `password` into the
// `password_hash` column (NOT NULL). This middleware closes that gap.
// =============================================================================

const bcrypt = require('bcryptjs');
const { hashPasswordField } = require('../src/middleware/hashPassword');

describe('hashPasswordField middleware', () => {
  test('hashes a plaintext password into password_hash and strips the plaintext', async () => {
    const req = { body: { first_name: 'A', email: 'a@b.com', password: 'Passw0rd!23', role: 'technician' } };
    const next = jest.fn();

    await hashPasswordField(req, {}, next);

    expect(next).toHaveBeenCalledWith();          // next() with no error
    expect(req.body.password).toBeUndefined();    // plaintext removed
    expect(typeof req.body.password_hash).toBe('string');
    // It is a genuine bcrypt hash of the password — the value that was missing → 500.
    expect(await bcrypt.compare('Passw0rd!23', req.body.password_hash)).toBe(true);
  });

  test('is a no-op when no password is supplied (e.g. PATCH without a password)', async () => {
    const req = { body: { first_name: 'A', role: 'support' } };
    const next = jest.fn();

    await hashPasswordField(req, {}, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.body.password_hash).toBeUndefined();
    expect('password' in req.body).toBe(false);
  });

  test('tolerates a missing/empty body without throwing', async () => {
    const next = jest.fn();
    await hashPasswordField({}, {}, next);
    expect(next).toHaveBeenCalledWith();
  });
});
