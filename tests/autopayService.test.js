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
  it('stores the saved card as the default recurring profile', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 5, provider: 'stripe', secret_key_encrypted: 'e' }]]) // gateway
      .mockResolvedValueOnce([{ affectedRows: 1 }])   // clear other defaults
      .mockResolvedValueOnce([{ insertId: 30 }]);     // INSERT profile
    pg.retrieveStripeCheckoutSession.mockResolvedValue({ mode: 'setup', customer: 'cus_1', paymentMethod: 'pm_1', metadata: { client_id: 7 } });

    await autopay.completeEnrollment({ sessionId: 'cs_setup', organizationId: 1 });

    const ins = db.query.mock.calls.find((c) => /INSERT INTO recurring_payment_profiles/.test(c[0]));
    expect(ins).toBeTruthy();
    expect(ins[1]).toEqual([7, 5, 'pm_1', 'cus_1']); // client, gateway, pm (token_reference), customer
  });

  it('does nothing when the setup session yielded no payment method', async () => {
    db.query.mockResolvedValueOnce([[{ id: 5, provider: 'stripe', secret_key_encrypted: 'e' }]]);
    pg.retrieveStripeCheckoutSession.mockResolvedValue({ mode: 'setup', customer: 'cus_1', paymentMethod: null, metadata: { client_id: 7 } });
    await autopay.completeEnrollment({ sessionId: 'x', organizationId: 1 });
    expect(db.query.mock.calls.find((c) => /INSERT INTO recurring_payment_profiles/.test(c[0]))).toBeFalsy();
  });
});
