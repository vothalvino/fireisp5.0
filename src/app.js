// =============================================================================
// FireISP 5.0 — Express Application
// =============================================================================

const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { AppError } = require('./utils/errors');
const errorTracking = require('./utils/errorTracking');
const { apiLimiter, authLimiter, exportLimiter, sseLimiter, webhookLimiter } = require('./middleware/rateLimit');
const { requestLogger } = require('./middleware/requestLogger');
const { sanitize } = require('./middleware/sanitize');
const { requestId } = require('./middleware/requestId');
const { firerelay } = require('./middleware/firerelay');
const { requireFeature } = require('./middleware/featureFlag');
const { createIpAllowlist, parseAllowlist } = require('./middleware/ipAllowlist');
const { csrfOriginCheck } = require('./middleware/csrf');
const { authenticate } = require('./middleware/auth');
const { orgScope } = require('./middleware/orgScope');
const logger = require('./utils/logger');

// Route imports
const authRoutes = require('./routes/auth');
const organizationRoutes = require('./routes/organizations');
const userRoutes = require('./routes/users');
const siteRoutes = require('./routes/sites');
const clientRoutes = require('./routes/clients');
const clientGroupRoutes = require('./routes/clientGroups');
const leadRoutes = require('./routes/leads');
const serviceOrderRoutes = require('./routes/serviceOrders');
const winbackCampaignRoutes = require('./routes/winbackCampaigns');
const lifecycleRoutes = require('./routes/lifecycle');
const planRoutes = require('./routes/plans');
const contractRoutes = require('./routes/contracts');
const deviceRoutes = require('./routes/devices');
const nasRoutes = require('./routes/nas');
const radiusRoutes = require('./routes/radius');
const invoiceRoutes = require('./routes/invoices');
const paymentRoutes = require('./routes/payments');
const creditNoteRoutes = require('./routes/creditNotes');
const ticketRoutes = require('./routes/tickets');
const interactionRoutes = require('./routes/interactions');
const followUpReminderRoutes = require('./routes/followUpReminders');
const satisfactionSurveyRoutes = require('./routes/satisfactionSurveys');
const escalationRoutes = require('./routes/escalations');
const jobRoutes = require('./routes/jobs');
const warehouseRoutes = require('./routes/warehouses');
const inventoryRoutes = require('./routes/inventory');
const quoteRoutes = require('./routes/quotes');
const expenseRoutes = require('./routes/expenses');
const outageRoutes = require('./routes/outages');
const roleRoutes = require('./routes/roles');
const apiTokenRoutes = require('./routes/apiTokens');
const slaDefinitionRoutes = require('./routes/slaDefinitions');
const ipPoolRoutes = require('./routes/ipPools');
const ipAssignmentRoutes = require('./routes/ipAssignments');
const networkLinkRoutes = require('./routes/networkLinks');
const vlanRoutes = require('./routes/vlans');
const speedTestRoutes = require('./routes/speedTests');
const snmpProfileRoutes = require('./routes/snmpProfiles');
const snmpMetricsRoutes = require('./routes/snmpMetrics');
const snmpTrapRoutes = require('./routes/snmpTraps');
const connectionLogRoutes = require('./routes/connectionLogs');
const networkHealthRoutes = require('./routes/networkHealth');
const settingsRoutes = require('./routes/settings');
const messageTemplateRoutes = require('./routes/messageTemplates');
const auditLogRoutes = require('./routes/auditLogs');
const fileRoutes = require('./routes/files');
const serviceAreaRoutes = require('./routes/serviceAreas');
const coverageZoneRoutes = require('./routes/coverageZones');
const revenueSummaryRoutes = require('./routes/revenueSummary');
const webhookRoutes = require('./routes/webhooks');
const deviceConfigBackupRoutes = require('./routes/deviceConfigBackups');
const paymentGatewayRoutes = require('./routes/paymentGateways');
const paymentTransactionRoutes = require('./routes/paymentTransactions');
const recurringPaymentProfileRoutes = require('./routes/recurringPaymentProfiles');
const promotionRoutes = require('./routes/promotions');
const taxRuleRoutes = require('./routes/taxRules');
const taxRateRoutes = require('./routes/taxRates');
const suspensionRuleRoutes = require('./routes/suspensionRules');
const csdCertificateRoutes = require('./routes/csdCertificates');
const pacProviderRoutes = require('./routes/pacProviders');
const cfdiDocumentRoutes = require('./routes/cfdiDocuments');
const scheduledTaskRoutes = require('./routes/scheduledTasks');
const concessionTitleRoutes = require('./routes/concessionTitles');
const regulatoryFilingRoutes = require('./routes/regulatoryFilings');
const iftStatisticalReportRoutes = require('./routes/iftStatisticalReports');
const satCatalogRoutes = require('./routes/satCatalogs');
const facturaPublicaRoutes = require('./routes/facturasPublicas');
const billingRoutes = require('./routes/billing');
const cfdiRoutes = require('./routes/cfdi');
const suspensionRoutes = require('./routes/suspension');
const dashboardRoutes = require('./routes/dashboard');
const exportRoutes = require('./routes/export');
const importRoutes = require('./routes/import');
const firerelayRoutes = require('./routes/firerelay');
const pdfRoutes = require('./routes/pdf');
const { router: eventsRoutes } = require('./routes/events');
const { router: metricsRoutes, metricsMiddleware } = require('./routes/metrics');
const paymentWebhookRoutes = require('./routes/paymentWebhooks');
const usageRoutes = require('./routes/usage');
const reportRoutes = require('./routes/reports');
const checkoutRoutes = require('./routes/checkout');
const alertRoutes = require('./routes/alerts');
const twoFactorRoutes = require('./routes/twoFactor');
const bulkRoutes = require('./routes/bulk');
const portalRoutes = require('./routes/portal');
const smsRoutes = require('./routes/sms');
const communicationCampaignRoutes = require('./routes/communicationCampaigns');
const clientDndRoutes = require('./routes/clientDnd');
const invoiceSettingsRoutes = require('./routes/invoiceSettings');
const lateFeeRulesRoutes = require('./routes/lateFeeRules');
const paymentRemindersRoutes = require('./routes/paymentReminders');
const communicationDeliveryRoutes = require('./routes/communicationDelivery');
const paymentPlansRoutes = require('./routes/paymentPlans');
const cashReconciliationRoutes = require('./routes/cashReconciliation');
const refundRequestRoutes = require('./routes/refundRequests');
const billingDisputeRoutes = require('./routes/billingDisputes');
const chargebackRoutes = require('./routes/chargebacks');
const billingAdjustmentRoutes = require('./routes/billingAdjustments');
const subscriberCertificateRoutes = require('./routes/subscriberCertificates');
const radiusAccountingRoutes = require('./routes/radiusAccounting');
const drDrillRoutes = require('./routes/drDrill');
const dsarRoutes = require('./routes/dsar');
const profecoRoutes = require('./routes/profeco');
const ssoRoutes = require('./routes/sso');
const aiRoutes = require('./routes/ai');
const queueStatsRoutes = require('./routes/queueStats');
const changelogRoutes = require('./routes/changelog');
const pppoeServiceProfileRoutes = require('./routes/pppoeServiceProfiles');
const pppoeRoutes = require('./routes/pppoe');
const graphqlMiddleware = require('./graphql');

const crypto = require('crypto');

const app = express();

// ---------------------------------------------------------------------------
// Global middleware
// ---------------------------------------------------------------------------

// CSP nonce — generate a unique nonce per request for inline styles
app.use((_req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

app.use((req, res, next) => {
  const nonce = res.locals.cspNonce;
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", `'nonce-${nonce}'`],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  })(req, res, next);
});

// Apply all other Helmet protections once (not per-request)
app.use(helmet({
  contentSecurityPolicy: false, // handled above with per-request nonce
}));
app.use(requestId);

// Request timeout — prevent long-running requests from hanging the server
if (config.requestTimeoutMs > 0) {
  app.use((req, res, next) => {
    req.setTimeout(config.requestTimeoutMs);
    res.setTimeout(config.requestTimeoutMs, () => {
      if (!res.headersSent) {
        res.status(504).json({
          error: {
            code: 'GATEWAY_TIMEOUT',
            message: 'Request timed out',
            ...(req.id && { requestId: req.id }),
          },
        });
      }
    });
    next();
  });
}

// CORS — in production use CORS_ORIGINS env var (comma-separated allowlist)
// or fall back to the single APP_URL. In development allow common localhost origins.
const corsOrigin = (() => {
  if (config.corsOrigins) {
    return config.corsOrigins.split(',').map(o => o.trim()).filter(Boolean);
  }
  if (config.env === 'production') {
    return config.appUrl;
  }
  return [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
  ];
})();
app.use(cors({ origin: corsOrigin, credentials: true }));

app.use(express.json({
  limit: '10mb',
  // Preserve raw body for payment webhook signature verification
  verify: (req, _res, buf) => {
    if (req.originalUrl && (req.originalUrl.startsWith('/api/payment-webhooks') || req.originalUrl.startsWith('/api/v1/payment-webhooks'))) {
      req.rawBody = buf.toString('utf8');
    }
  },
}));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(sanitize);
app.use(firerelay);
app.use(requestLogger);
app.use(metricsMiddleware);
app.use('/api/', apiLimiter);
// CSRF origin check — validates Origin/Referer header on state-changing requests
// that carry a FireISP auth cookie (browser SPA).  SameSite=Strict on the cookies
// already prevents CSRF; this is defense-in-depth.
app.use('/api/', csrfOriginCheck);
app.use('/api/auth', authLimiter);
app.use('/api/v1/auth', authLimiter);
app.use('/api/export', exportLimiter);
app.use('/api/v1/export', exportLimiter);
app.use('/api/pdf', exportLimiter);
app.use('/api/v1/pdf', exportLimiter);
app.use('/api/events', sseLimiter);
app.use('/api/v1/events', sseLimiter);
app.use('/api/payment-webhooks', webhookLimiter);
app.use('/api/v1/payment-webhooks', webhookLimiter);

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
const relayConfig = require('./config/firerelay');
const startedAt = new Date();

app.get('/health', async (req, res) => {
  const health = {
    status: 'ok',
    version: '5.0.0',
    uptime: Math.floor((Date.now() - startedAt.getTime()) / 1000),
    relay: relayConfig.mode,
    timestamp: new Date().toISOString(),
  };

  // Detailed mode: ?detail=true adds memory + DB latency
  if (req.query.detail === 'true') {
    const mem = process.memoryUsage();
    health.memory = {
      rss: Math.round(mem.rss / 1048576),
      heapUsed: Math.round(mem.heapUsed / 1048576),
      heapTotal: Math.round(mem.heapTotal / 1048576),
    };

    try {
      const db = require('./config/database');
      const t0 = Date.now();
      await db.query('SELECT 1');
      health.db = { connected: true, latencyMs: Date.now() - t0 };
    } catch (_err) {
      health.status = 'degraded';
      health.db = { connected: false };
    }
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

// /healthz — standard readiness alias used by load balancers and frontend dev proxies
// Returns 200 with DB + optional Redis status; 503 when not ready.
app.get('/healthz', async (_req, res) => {
  const checks = { db: false };
  let ready = true;

  try {
    const db = require('./config/database');
    const t0 = Date.now();
    await db.query('SELECT 1');
    checks.db = { connected: true, latencyMs: Date.now() - t0 };
  } catch (_err) {
    checks.db = { connected: false };
    ready = false;
  }

  if (process.env.REDIS_URL) {
    try {
      const cacheService = require('./services/cacheService');
      if (cacheService.isReady && cacheService.isReady()) {
        checks.redis = { connected: true };
      } else {
        checks.redis = { connected: false };
        ready = false;
      }
    } catch (_err) {
      checks.redis = { connected: false };
      ready = false;
    }
  }

  res.status(ready ? 200 : 503).json({
    status: ready ? 'ok' : 'degraded',
    checks,
    timestamp: new Date().toISOString(),
  });
});

// Liveness probe — lightweight check that the process is running
app.get('/health/live', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// Readiness probe — checks that the app can serve traffic (DB + optional Redis)
app.get('/health/ready', async (_req, res) => {
  const checks = { db: false };
  let ready = true;

  // Database check
  try {
    const db = require('./config/database');
    const t0 = Date.now();
    await db.query('SELECT 1');
    checks.db = { connected: true, latencyMs: Date.now() - t0 };
  } catch (_err) {
    checks.db = { connected: false };
    ready = false;
  }

  // Redis check (optional — only when REDIS_URL is configured)
  if (process.env.REDIS_URL) {
    try {
      const cacheService = require('./services/cacheService');
      if (cacheService.isReady && cacheService.isReady()) {
        checks.redis = { connected: true };
      } else {
        checks.redis = { connected: false };
        ready = false;
      }
    } catch (_err) {
      checks.redis = { connected: false };
      ready = false;
    }
  }

  const statusCode = ready ? 200 : 503;
  res.status(statusCode).json({
    status: ready ? 'ready' : 'not_ready',
    checks,
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// API routes — build a single v1 router, mount at /api and /api/v1
// ---------------------------------------------------------------------------
const v1 = express.Router();

// IP allowlist for admin-tier endpoints — enabled via ADMIN_IP_ALLOWLIST env var.
// When the env var is not set the middleware is a no-op (opt-in feature).
const adminIpAllowlist = createIpAllowlist(parseAllowlist(config.adminIpAllowlist));

v1.use('/auth', authRoutes);
v1.use('/organizations', adminIpAllowlist, organizationRoutes);
v1.use('/users', adminIpAllowlist, userRoutes);
v1.use('/sites', siteRoutes);
v1.use('/clients', clientRoutes);
v1.use('/client-groups', clientGroupRoutes);
v1.use('/leads', leadRoutes);
v1.use('/service-orders', serviceOrderRoutes);
v1.use('/winback-campaigns', winbackCampaignRoutes);
v1.use('/lifecycle', lifecycleRoutes);
v1.use('/plans', planRoutes);
v1.use('/contracts', contractRoutes);
v1.use('/devices', deviceRoutes);
v1.use('/nas', nasRoutes);
v1.use('/radius', requireFeature('radius'), radiusRoutes);
v1.use('/invoices', invoiceRoutes);
v1.use('/payments', paymentRoutes);
v1.use('/credit-notes', creditNoteRoutes);
v1.use('/tickets', ticketRoutes);
v1.use('/interactions', interactionRoutes);
v1.use('/follow-up-reminders', followUpReminderRoutes);
v1.use('/satisfaction-surveys', satisfactionSurveyRoutes);
v1.use('/escalations', escalationRoutes);
v1.use('/jobs', jobRoutes);
v1.use('/warehouses', warehouseRoutes);
v1.use('/inventory', inventoryRoutes);
v1.use('/quotes', quoteRoutes);
v1.use('/expenses', expenseRoutes);
v1.use('/outages', outageRoutes);
v1.use('/roles', adminIpAllowlist, roleRoutes);
v1.use('/api-tokens', apiTokenRoutes);
v1.use('/sla-definitions', slaDefinitionRoutes);
v1.use('/ip-pools', ipPoolRoutes);
v1.use('/ip-assignments', ipAssignmentRoutes);
v1.use('/network-links', networkLinkRoutes);
v1.use('/vlans', vlanRoutes);
v1.use('/speed-tests', speedTestRoutes);
v1.use('/snmp-profiles', requireFeature('snmp'), snmpProfileRoutes);
v1.use('/snmp-metrics', requireFeature('snmp'), snmpMetricsRoutes);
v1.use('/snmp-traps', requireFeature('snmp'), snmpTrapRoutes);
v1.use('/connection-logs', connectionLogRoutes);
v1.use('/network-health', networkHealthRoutes);
v1.use('/settings', adminIpAllowlist, settingsRoutes);
v1.use('/message-templates', messageTemplateRoutes);
v1.use('/audit-logs', adminIpAllowlist, auditLogRoutes);
v1.use('/files', fileRoutes);
v1.use('/service-areas', serviceAreaRoutes);
v1.use('/coverage-zones', coverageZoneRoutes);
v1.use('/revenue-summary', revenueSummaryRoutes);
v1.use('/webhooks', requireFeature('webhooks'), webhookRoutes);
v1.use('/device-config-backups', deviceConfigBackupRoutes);
v1.use('/payment-gateways', paymentGatewayRoutes);
v1.use('/payment-transactions', paymentTransactionRoutes);
v1.use('/payment-webhooks', paymentWebhookRoutes);
v1.use('/recurring-payment-profiles', recurringPaymentProfileRoutes);
v1.use('/promotions', promotionRoutes);
v1.use('/tax-rules', taxRuleRoutes);
v1.use('/tax-rates', taxRateRoutes);
v1.use('/suspension-rules', suspensionRuleRoutes);
v1.use('/csd-certificates', requireFeature('cfdi'), csdCertificateRoutes);
v1.use('/pac-providers', requireFeature('cfdi'), pacProviderRoutes);
v1.use('/cfdi-documents', requireFeature('cfdi'), cfdiDocumentRoutes);
v1.use('/scheduled-tasks', adminIpAllowlist, scheduledTaskRoutes);
v1.use('/concession-titles', concessionTitleRoutes);
v1.use('/regulatory-filings', regulatoryFilingRoutes);
v1.use('/ift-statistical-reports', iftStatisticalReportRoutes);
v1.use('/sat-catalogs', requireFeature('cfdi'), satCatalogRoutes);
v1.use('/facturas-publicas', requireFeature('cfdi'), facturaPublicaRoutes);
v1.use('/billing', adminIpAllowlist, billingRoutes);
v1.use('/cfdi', requireFeature('cfdi'), cfdiRoutes);
v1.use('/suspension', suspensionRoutes);
v1.use('/dashboard', dashboardRoutes);
v1.use('/export', exportRoutes);
v1.use('/import', adminIpAllowlist, importRoutes);
v1.use('/firerelay', firerelayRoutes);
v1.use('/pdf', pdfRoutes);
v1.use('/events', eventsRoutes);
v1.use('/usage', apiLimiter, usageRoutes);
v1.use('/reports', apiLimiter, reportRoutes);
v1.use('/checkout', apiLimiter, checkoutRoutes);
v1.use('/alerts', apiLimiter, alertRoutes);
v1.use('/2fa', authLimiter, requireFeature('twoFactor'), twoFactorRoutes);
v1.use('/bulk', apiLimiter, bulkRoutes);
v1.use('/portal', portalRoutes);
v1.use('/sms', smsRoutes);
v1.use('/communication-campaigns', communicationCampaignRoutes);
v1.use('/clients', clientDndRoutes);
v1.use('/invoice-settings', invoiceSettingsRoutes);
v1.use('/late-fee-rules', lateFeeRulesRoutes);
v1.use('/payment-reminder-settings', paymentRemindersRoutes);
v1.use('/communication', communicationDeliveryRoutes);
v1.use('/payment-plans', paymentPlansRoutes);
v1.use('/cash-reconciliation', cashReconciliationRoutes);
v1.use('/refund-requests', refundRequestRoutes);
v1.use('/billing-disputes', billingDisputeRoutes);
v1.use('/chargebacks', chargebackRoutes);
v1.use('/billing-adjustments', billingAdjustmentRoutes);
v1.use('/subscriber-certificates', requireFeature('radius'), subscriberCertificateRoutes);
v1.use('/radius', requireFeature('radius'), radiusAccountingRoutes);
v1.use('/dr-drill', adminIpAllowlist, drDrillRoutes);
v1.use('/dsar', adminIpAllowlist, dsarRoutes);
v1.use('/profeco-complaints', profecoRoutes);
v1.use('/sso', ssoRoutes);
v1.use('/ai', aiRoutes);
v1.use('/queue-stats', adminIpAllowlist, queueStatsRoutes);
v1.use('/changelog', changelogRoutes);
v1.use('/pppoe-service-profiles', pppoeServiceProfileRoutes);
v1.use('/pppoe', pppoeRoutes);
v1.use('/graphql', authenticate, orgScope, graphqlMiddleware);

// Mount v1 at both /api (backward compat) and /api/v1 (versioned)
app.use('/api/v1', v1);

// Backward-compat mount: /api routes emit a Deprecation header to nudge
// clients toward the versioned /api/v1 prefix.
app.use('/api', (req, res, next) => {
  res.set('Deprecation', 'true');
  res.set('Sunset', '2027-06-01');
  res.set('Link', `</api/v1${req.path}>; rel="successor-version"`);
  next();
}, v1);
app.use('/metrics', metricsRoutes);

// ---------------------------------------------------------------------------
// API documentation (Swagger UI)
// ---------------------------------------------------------------------------
const { registerHooks } = require('./services/notificationHooks');
registerHooks();

const { mountApiDocs } = require('./utils/openapi');
mountApiDocs(app);

// ---------------------------------------------------------------------------
// Static admin dashboard — served from frontend/dist/ (React build output)
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, '..', 'frontend', 'dist')));

// SPA fallback: any non-API GET that doesn't match a file → serve index.html
app.get(/^\/(?!api|metrics|health)/, (req, res, next) => {
  const indexPath = path.join(__dirname, '..', 'frontend', 'dist', 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) next(); // fall through to 404
  });
});

// ---------------------------------------------------------------------------
// Error tracking — Sentry error handler (must come after all routes and
// before the application's own error handlers)
// ---------------------------------------------------------------------------
errorTracking.setupExpressErrorHandler(app);

// ---------------------------------------------------------------------------
// 404 handler
// ---------------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Route not found',
      ...(req.id && { requestId: req.id }),
    },
  });
});

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------
app.use((err, req, res, _next) => {
  // Helper — include requestId in every error response for traceability
  const errorBody = (code, message, extras) => ({
    error: {
      code,
      message,
      ...extras,
      ...(req.id && { requestId: req.id }),
    },
  });

  // Handle MySQL trigger errors (SQLSTATE 45000)
  if (err.code === 'ER_SIGNAL_EXCEPTION' || err.errno === 1644) {
    return res.status(422).json(
      errorBody('DB_RULE_VIOLATION', err.sqlMessage || err.message),
    );
  }

  // Handle MySQL duplicate key errors
  if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
    return res.status(409).json(
      errorBody('CONFLICT', 'A record with that value already exists'),
    );
  }

  // Handle MySQL FK constraint errors
  if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.errno === 1452) {
    return res.status(422).json(
      errorBody('FK_VIOLATION', 'Referenced record does not exist'),
    );
  }

  // Handle database connectivity errors — return 503 so clients (and load
  // balancers) can distinguish "server is broken" from "DB is unreachable".
  // ECONNREFUSED / ENOTFOUND / ETIMEDOUT / ECONNRESET cover the case where
  // MySQL/MariaDB is not running or the DB_HOST is wrong.
  // ER_ACCESS_DENIED_ERROR covers bad DB_USER / DB_PASSWORD credentials.
  // ER_NO_SUCH_TABLE covers the case where migrations have not been run yet.
  const DB_CONNECT_CODES = new Set([
    'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET',
  ]);
  if (DB_CONNECT_CODES.has(err.code)) {
    logger.error({ err, requestId: req.id }, 'Database unreachable');
    return res.status(503).json(
      errorBody('DB_UNAVAILABLE', 'Database is unreachable. Check that MySQL/MariaDB is running and that DB_HOST, DB_USER, DB_PASSWORD, and DB_NAME are correctly set in your .env file.'),
    );
  }
  if (err.code === 'ER_ACCESS_DENIED_ERROR' || err.errno === 1045) {
    logger.error({ err, requestId: req.id }, 'Database authentication failed');
    return res.status(503).json(
      errorBody('DB_AUTH_ERROR', 'Database authentication failed. Check DB_USER and DB_PASSWORD in your .env file.'),
    );
  }
  if (err.code === 'ER_NO_SUCH_TABLE' || err.errno === 1146) {
    logger.error({ err, requestId: req.id }, 'Database table missing — migrations may not have been run');
    return res.status(503).json(
      errorBody('DB_MIGRATIONS_REQUIRED', 'A required database table is missing. Run `pnpm run migrate` to apply all migrations, then `pnpm run seed` to seed default data.'),
    );
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json(
      errorBody(err.code, err.message, err.details ? { details: err.details } : undefined),
    );
  }

  // Unexpected errors
  logger.error({ err, requestId: req.id }, 'Unhandled error');
  errorTracking.captureException(err, { requestId: req.id });
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json(
    errorBody(
      'INTERNAL_ERROR',
      config.env === 'production' ? 'Internal server error' : err.message,
    ),
  );
});

module.exports = app;
