// =============================================================================
// FireISP 5.0 — Autopay enrollment tests
// =============================================================================

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/services/paymentGatewayService', () => ({
  createStripeCustomer: jest.fn(),
  createStripeSetupSession: jest.fn(),
  retrieveStripeCheckoutSession: jest.fn(),
}));
jest.mock('../src/utils/logger', () => {
  const m = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn(() => m) };
  return m;
});

const db = require('../src/config/database');
const pg = require('../src/services/paymentGatewayService');
const autopay = require('../src/services/autopayService');

beforeEach(() => jest.clearAllMocks());

describe('startEnrollment', () => {
  it('creates a Stripe customer + setup session and returns the setup url', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 5, provider: 'stripe', secret_key_encrypted: 'e' }]]) // gateway
      .mockResolvedValueOnce([[{ email: 'a@x.com' }]]);                                    // client
    pg.createStripeCustomer.mockResolvedValue('cus_1');
    pg.createStripeSetupSession.mockResolvedValue({ id: 'cs_setup', url: 'https://checkout.stripe.com/setup' });

    const r = await autopay.startEnrollment({ organizationId: 1, clientId: 7, returnUrl: null });

    expect(pg.createStripeCustomer).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }), expect.objectContaining({ email: 'a@x.com' }));
    expect(pg.createStripeSetupSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 5 }),
      expect.objectContaining({ customerId: 'cus_1', metadata: expect.objectContaining({ client_id: 7, purpose: 'autopay' }) }),
    );
    expect(r.setup_url).toBe('https://checkout.stripe.com/setup');
  });

  it('throws when there is no active Stripe gateway', async () => {
    db.query.mockResolvedValueOnce([[]]);
    await expect(autopay.startEnrollment({ organizationId: 1, clientId: 7 })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(pg.createStripeCustomer).not.toHaveBeenCalled();
  });
});

describe('completeEnrollment', () => {
  it('resolves the gateway from the session metadata and stores the card as the default profile', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 5, provider: 'stripe', organization_id: 1, secret_key_encrypted: 'e' }]]) // loadStripeGatewayById
      .mockResolvedValueOnce([[{ id: 7 }]])           // client belongs to gateway org
      .mockResolvedValueOnce([{ affectedRows: 1 }])   // clear other defaults
      .mockResolvedValueOnce([{ insertId: 30 }]);     // INSERT profile
    pg.retrieveStripeCheckoutSession.mockResolvedValue({
      mode: 'setup', customer: 'cus_1', paymentMethod: 'pm_1',
      card: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 },
      metadata: { client_id: 7 },
    });

    await autopay.completeEnrollment({ sessionId: 'cs_setup', organizationId: 1, metadata: { gateway_id: '5', organization_id: '1', client_id: '7' } });

    // gateway resolved by id (metadata), not org-resolve
    expect(db.query.mock.calls[0][0]).toMatch(/WHERE id = \? AND provider = 'stripe'/);
    expect(db.query.mock.calls[0][1]).toEqual([5]);
    const ins = db.query.mock.calls.find((c) => /INSERT INTO recurring_payment_profiles/.test(c[0]));
    expect(ins).toBeTruthy();
    // client, gateway, pm (token_reference), customer, brand, last4, exp month/year
    expect(ins[1]).toEqual([7, 5, 'pm_1', 'cus_1', 'visa', '4242', 12, 2030]);
  });

  it('enrolls on the global env-var webhook route (no organizationId) via the session metadata gateway', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 5, provider: 'stripe', organization_id: 1, secret_key_encrypted: 'e' }]]) // loadStripeGatewayById
      .mockResolvedValueOnce([[{ id: 7 }]])           // ownership
      .mockResolvedValueOnce([{ affectedRows: 1 }])   // clear
      .mockResolvedValueOnce([{ insertId: 31 }]);     // INSERT
    pg.retrieveStripeCheckoutSession.mockResolvedValue({ mode: 'setup', customer: 'cus_1', paymentMethod: 'pm_1', card: null, metadata: { client_id: 7 } });

    await autopay.completeEnrollment({ sessionId: 'cs_setup', organizationId: undefined, metadata: { gateway_id: '5', organization_id: '1', client_id: '7' } });

    expect(db.query.mock.calls.find((c) => /INSERT INTO recurring_payment_profiles/.test(c[0]))).toBeTruthy();
  });

  it('drops the enrollment when the client does not belong to the gateway org', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 5, provider: 'stripe', organization_id: 1, secret_key_encrypted: 'e' }]]) // gateway
      .mockResolvedValueOnce([[]]);                   // ownership → no matching client
    pg.retrieveStripeCheckoutSession.mockResolvedValue({ mode: 'setup', customer: 'cus_1', paymentMethod: 'pm_1', card: null, metadata: { client_id: 999 } });
    await autopay.completeEnrollment({ sessionId: 'x', organizationId: 1, metadata: { gateway_id: '5' } });
    expect(db.query.mock.calls.find((c) => /INSERT INTO recurring_payment_profiles/.test(c[0]))).toBeFalsy();
  });

  it('swallows a duplicate-key race from a concurrent completion', async () => {
    const dup = Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
    db.query
      .mockResolvedValueOnce([[{ id: 5, provider: 'stripe', organization_id: 1, secret_key_encrypted: 'e' }]]) // gateway
      .mockResolvedValueOnce([[{ id: 7 }]])           // ownership
      .mockResolvedValueOnce([{ affectedRows: 1 }])   // clear
      .mockRejectedValueOnce(dup);                    // INSERT trips the unique guard
    pg.retrieveStripeCheckoutSession.mockResolvedValue({ mode: 'setup', customer: 'cus_1', paymentMethod: 'pm_1', card: null, metadata: { client_id: 7 } });
    await expect(autopay.completeEnrollment({ sessionId: 'x', organizationId: 1, metadata: { gateway_id: '5' } })).resolves.toBeUndefined();
  });

  it('does nothing when the setup session yielded no payment method', async () => {
    db.query.mockResolvedValueOnce([[{ id: 5, provider: 'stripe', organization_id: 1, secret_key_encrypted: 'e' }]]); // gateway (org-resolve fallback)
    pg.retrieveStripeCheckoutSession.mockResolvedValue({ mode: 'setup', customer: 'cus_1', paymentMethod: null, metadata: { client_id: 7 } });
    await autopay.completeEnrollment({ sessionId: 'x', organizationId: 1 });
    expect(db.query.mock.calls.find((c) => /INSERT INTO recurring_payment_profiles/.test(c[0]))).toBeFalsy();
  });
});
