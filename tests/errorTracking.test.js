// =============================================================================
// FireISP 5.0 — Error Tracking (Sentry) Tests
// =============================================================================

describe('errorTracking', () => {
  const MOCK_DSN = 'https://testkey@o123.ingest.sentry.io/456';

  // Restore original SENTRY_DSN and reset module registry between tests
  const originalDsn = process.env.SENTRY_DSN;
  const originalEnv = process.env.NODE_ENV;

  afterAll(() => {
    if (originalDsn === undefined) {
      delete process.env.SENTRY_DSN;
    } else {
      process.env.SENTRY_DSN = originalDsn;
    }
    process.env.NODE_ENV = originalEnv;
  });

  // -------------------------------------------------------------------------
  // Disabled path — no SENTRY_DSN set
  // -------------------------------------------------------------------------
  describe('when SENTRY_DSN is not set', () => {
    let errorTracking;

    beforeEach(() => {
      delete process.env.SENTRY_DSN;
      jest.resetModules();
      errorTracking = require('../src/utils/errorTracking');
    });

    it('isEnabled() returns false', () => {
      expect(errorTracking.isEnabled()).toBe(false);
    });

    it('captureException() does not throw', () => {
      expect(() => errorTracking.captureException(new Error('boom'))).not.toThrow();
    });

    it('captureException() with extras does not throw', () => {
      expect(() =>
        errorTracking.captureException(new Error('boom'), { requestId: 'abc' }),
      ).not.toThrow();
    });

    it('setupExpressErrorHandler() does not throw when called with an express-like app', () => {
      const mockApp = { use: jest.fn() };
      expect(() => errorTracking.setupExpressErrorHandler(mockApp)).not.toThrow();
      // No middleware should be attached
      expect(mockApp.use).not.toHaveBeenCalled();
    });

    it('init() called multiple times is safe', () => {
      expect(() => {
        errorTracking.init();
        errorTracking.init();
      }).not.toThrow();
      expect(errorTracking.isEnabled()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Enabled path — SENTRY_DSN set, @sentry/node mocked
  // -------------------------------------------------------------------------
  describe('when SENTRY_DSN is set', () => {
    let errorTracking;
    let mockSentry;

    beforeEach(() => {
      process.env.SENTRY_DSN = MOCK_DSN;
      process.env.NODE_ENV = 'development';

      mockSentry = {
        init: jest.fn(),
        captureException: jest.fn(),
        setupExpressErrorHandler: jest.fn(),
        withScope: jest.fn((callback) => {
          callback({ setExtras: jest.fn() });
        }),
      };

      jest.resetModules();
      jest.mock('@sentry/node', () => mockSentry);
      errorTracking = require('../src/utils/errorTracking');
    });

    afterEach(() => {
      delete process.env.SENTRY_DSN;
      jest.unmock('@sentry/node');
    });

    it('isEnabled() returns true', () => {
      expect(errorTracking.isEnabled()).toBe(true);
    });

    it('Sentry.init() is called with DSN', () => {
      expect(mockSentry.init).toHaveBeenCalledWith(
        expect.objectContaining({ dsn: MOCK_DSN }),
      );
    });

    it('Sentry.init() receives environment from SENTRY_ENVIRONMENT when set', () => {
      delete process.env.SENTRY_DSN;
      jest.resetModules();
      jest.mock('@sentry/node', () => mockSentry);
      process.env.SENTRY_DSN = MOCK_DSN;
      process.env.SENTRY_ENVIRONMENT = 'staging';
      const et = require('../src/utils/errorTracking');
      expect(et.isEnabled()).toBe(true);
      expect(mockSentry.init).toHaveBeenCalledWith(
        expect.objectContaining({ environment: 'staging' }),
      );
      delete process.env.SENTRY_ENVIRONMENT;
    });

    it('captureException() calls Sentry.captureException without extras', () => {
      const err = new Error('oops');
      errorTracking.captureException(err);
      expect(mockSentry.captureException).toHaveBeenCalledWith(err);
      expect(mockSentry.withScope).not.toHaveBeenCalled();
    });

    it('captureException() uses withScope when extras are provided', () => {
      const err = new Error('oops');
      errorTracking.captureException(err, { requestId: 'req-1' });
      expect(mockSentry.withScope).toHaveBeenCalled();
    });

    it('captureException() with empty extras object does not use withScope', () => {
      const err = new Error('oops');
      errorTracking.captureException(err, {});
      expect(mockSentry.withScope).not.toHaveBeenCalled();
      expect(mockSentry.captureException).toHaveBeenCalledWith(err);
    });

    it('setupExpressErrorHandler() calls Sentry.setupExpressErrorHandler', () => {
      const mockApp = { use: jest.fn() };
      errorTracking.setupExpressErrorHandler(mockApp);
      expect(mockSentry.setupExpressErrorHandler).toHaveBeenCalledWith(mockApp);
    });

    it('calling init() again after enabled is a no-op', () => {
      mockSentry.init.mockClear();
      errorTracking.init();
      expect(mockSentry.init).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Graceful degradation — @sentry/node throws during init
  // -------------------------------------------------------------------------
  describe('when @sentry/node init throws', () => {
    let errorTracking;

    beforeEach(() => {
      process.env.SENTRY_DSN = MOCK_DSN;

      jest.resetModules();
      jest.mock('@sentry/node', () => ({
        init: jest.fn(() => { throw new Error('Sentry init failed'); }),
        captureException: jest.fn(),
        setupExpressErrorHandler: jest.fn(),
        withScope: jest.fn(),
      }));
      errorTracking = require('../src/utils/errorTracking');
    });

    afterEach(() => {
      delete process.env.SENTRY_DSN;
      jest.unmock('@sentry/node');
    });

    it('isEnabled() returns false', () => {
      expect(errorTracking.isEnabled()).toBe(false);
    });

    it('captureException() does not throw', () => {
      expect(() => errorTracking.captureException(new Error('x'))).not.toThrow();
    });

    it('setupExpressErrorHandler() does not throw', () => {
      expect(() => errorTracking.setupExpressErrorHandler({})).not.toThrow();
    });
  });
});
