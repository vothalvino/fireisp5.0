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
        requestDataIntegration: jest.fn(options => ({ name: 'RequestData', options })),
        httpIntegration: jest.fn(options => ({ name: 'Http', options })),
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

    it('disables raw request capture and installs privacy-minimal integrations', () => {
      const options = mockSentry.init.mock.calls[0][0];
      expect(options).toMatchObject({
        sendDefaultPii: false,
        maxIncomingRequestBodySize: 'none',
      });

      const transformed = options.integrations([
        { name: 'RequestData' },
        { name: 'Http' },
        { name: 'Other' },
      ]);
      expect(transformed.map(item => item.name)).toEqual(['Other', 'RequestData', 'Http']);
      expect(mockSentry.requestDataIntegration).toHaveBeenCalledWith({
        include: {
          cookies: false,
          data: false,
          headers: false,
          ip: false,
          query_string: false,
          url: false,
        },
      });
      expect(mockSentry.httpIntegration).toHaveBeenCalledWith({
        maxIncomingRequestBodySize: 'none',
        breadcrumbs: false,
        spans: false,
        tracePropagation: false,
      });
    });

    it('beforeSend removes request secrets, credentials and capability URLs', () => {
      const { beforeSend } = mockSentry.init.mock.calls[0][0];
      const safe = beforeSend({
        request: {
          method: 'POST',
          url: 'https://fireisp.example/api/webhooks?token=query-secret',
          headers: {
            authorization: 'Bearer bearer-secret',
            cookie: 'session=session-secret',
          },
          cookies: { session: 'session-secret' },
          query_string: 'token=query-secret',
          data: {
            secret: 'hmac-secret',
            forward_to_url: 'https://capability.example/hooks/tenant-token',
          },
        },
        extra: {
          requestId: 'request-safe-123',
          secret_encrypted: 'encrypted-secret-envelope',
          accessToken: 'opaque-access-credential',
          nested: {
            target_url: 'https://private-hook.example/bearer-token',
            operator_email: 'operator@example.test',
          },
        },
        breadcrumbs: [{
          category: 'http',
          message: 'POST https://private-hook.example/bearer-token',
          data: { authorization: 'Bearer second-secret' },
        }],
        exception: {
          values: [{ value: 'Failed https://private-hook.example/bearer-token with Bearer third-secret' }],
        },
      });

      expect(safe.request).toEqual({ method: 'POST' });
      expect(safe.extra.requestId).toBe('request-safe-123');
      const encoded = JSON.stringify(safe);
      for (const secret of [
        'query-secret',
        'bearer-secret',
        'session-secret',
        'hmac-secret',
        'tenant-token',
        'encrypted-secret-envelope',
        'opaque-access-credential',
        'operator@example.test',
        'second-secret',
        'third-secret',
      ]) {
        expect(encoded).not.toContain(secret);
      }
      expect(encoded).toContain('[Filtered]');
    });

    it('beforeSendTransaction strips span endpoint capabilities and transaction paths', () => {
      const { beforeSendTransaction } = mockSentry.init.mock.calls[0][0];
      const safe = beforeSendTransaction({
        transaction: 'POST /internal/hooks/capability-token?secret=query-secret',
        request: {
          method: 'POST',
          url: 'https://fireisp.example/api/webhooks?token=query-secret',
        },
        spans: [{
          description: 'POST https://capability.example/hooks/path-token',
          data: {
            'url.full': 'https://capability.example/hooks/path-token',
            'http.url': 'https://capability.example/hooks/path-token',
            'http.target': '/hooks/path-token',
            'server.address': 'tenant-token.capability.example',
          },
        }],
      });

      expect(safe.transaction).toBe('POST [Filtered Transaction]');
      expect(safe.request).toEqual({ method: 'POST' });
      const encoded = JSON.stringify(safe);
      expect(encoded).not.toContain('capability-token');
      expect(encoded).not.toContain('query-secret');
      expect(encoded).not.toContain('path-token');
      expect(encoded).not.toContain('tenant-token');
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
