// =============================================================================
// FireISP 5.0 — Express Application
// =============================================================================

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config');
const { AppError } = require('./utils/errors');
const { apiLimiter, authLimiter, exportLimiter, sseLimiter, webhookLimiter } = require('./middleware/rateLimit');
const { requestLogger } = require('./middleware/requestLogger');
const { sanitize } = require('./middleware/sanitize');
const { requestId } = require('./middleware/requestId');
const { firerelay } = require('./middleware/firerelay');
const logger = require('./utils/logger');

// Route imports
const authRoutes = require('./routes/auth');
const organizationRoutes = require('./routes/organizations');
const userRoutes = require('./routes/users');
const siteRoutes = require('./routes/sites');
const clientRoutes = require('./routes/clients');
const planRoutes = require('./routes/plans');
const contractRoutes = require('./routes/contracts');
const deviceRoutes = require('./routes/devices');
const nasRoutes = require('./routes/nas');
const radiusRoutes = require('./routes/radius');
const invoiceRoutes = require('./routes/invoices');
const paymentRoutes = require('./routes/payments');
const creditNoteRoutes = require('./routes/creditNotes');
const ticketRoutes = require('./routes/tickets');
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
const connectionLogRoutes = require('./routes/connectionLogs');
const networkHealthRoutes = require('./routes/networkHealth');
const settingsRoutes = require('./routes/settings');
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

const app = express();

// ---------------------------------------------------------------------------
// Global middleware
// ---------------------------------------------------------------------------
app.use(helmet());
app.use(requestId);

// CORS — restrict origins in production to the configured APP_URL;
// in development allow common localhost origins only.
const corsOrigin = config.env === 'production'
  ? config.appUrl
  : [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
  ];
app.use(cors({ origin: corsOrigin, credentials: true }));

app.use(express.json({
  limit: '10mb',
  // Preserve raw body for payment webhook signature verification
  verify: (req, _res, buf) => {
    if (req.originalUrl && req.originalUrl.startsWith('/api/payment-webhooks')) {
      req.rawBody = buf.toString('utf8');
    }
  },
}));
app.use(express.urlencoded({ extended: true }));
app.use(sanitize);
app.use(firerelay);
app.use(requestLogger);
app.use(metricsMiddleware);
app.use('/api/', apiLimiter);
app.use('/api/auth', authLimiter);
app.use('/api/export', exportLimiter);
app.use('/api/pdf', exportLimiter);
app.use('/api/events', sseLimiter);
app.use('/api/payment-webhooks', webhookLimiter);

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

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------
app.use('/api/auth', authRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/users', userRoutes);
app.use('/api/sites', siteRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/contracts', contractRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/nas', nasRoutes);
app.use('/api/radius', radiusRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/credit-notes', creditNoteRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/warehouses', warehouseRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/quotes', quoteRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/outages', outageRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/api-tokens', apiTokenRoutes);
app.use('/api/sla-definitions', slaDefinitionRoutes);
app.use('/api/ip-pools', ipPoolRoutes);
app.use('/api/ip-assignments', ipAssignmentRoutes);
app.use('/api/network-links', networkLinkRoutes);
app.use('/api/vlans', vlanRoutes);
app.use('/api/speed-tests', speedTestRoutes);
app.use('/api/snmp-profiles', snmpProfileRoutes);
app.use('/api/connection-logs', connectionLogRoutes);
app.use('/api/network-health', networkHealthRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/audit-logs', auditLogRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/service-areas', serviceAreaRoutes);
app.use('/api/coverage-zones', coverageZoneRoutes);
app.use('/api/revenue-summary', revenueSummaryRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/device-config-backups', deviceConfigBackupRoutes);
app.use('/api/payment-gateways', paymentGatewayRoutes);
app.use('/api/payment-transactions', paymentTransactionRoutes);
app.use('/api/payment-webhooks', paymentWebhookRoutes);
app.use('/api/recurring-payment-profiles', recurringPaymentProfileRoutes);
app.use('/api/suspension-rules', suspensionRuleRoutes);
app.use('/api/csd-certificates', csdCertificateRoutes);
app.use('/api/pac-providers', pacProviderRoutes);
app.use('/api/cfdi-documents', cfdiDocumentRoutes);
app.use('/api/scheduled-tasks', scheduledTaskRoutes);
app.use('/api/concession-titles', concessionTitleRoutes);
app.use('/api/regulatory-filings', regulatoryFilingRoutes);
app.use('/api/ift-statistical-reports', iftStatisticalReportRoutes);
app.use('/api/sat-catalogs', satCatalogRoutes);
app.use('/api/facturas-publicas', facturaPublicaRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/cfdi', cfdiRoutes);
app.use('/api/suspension', suspensionRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/import', importRoutes);
app.use('/api/firerelay', firerelayRoutes);
app.use('/api/pdf', pdfRoutes);
app.use('/api/events', eventsRoutes);
app.use('/metrics', metricsRoutes);

// ---------------------------------------------------------------------------
// API documentation (Swagger UI)
// ---------------------------------------------------------------------------
const { mountApiDocs } = require('./utils/openapi');
mountApiDocs(app);

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

  if (err instanceof AppError) {
    return res.status(err.statusCode).json(
      errorBody(err.code, err.message, err.details ? { details: err.details } : undefined),
    );
  }

  // Unexpected errors
  logger.error({ err, requestId: req.id }, 'Unhandled error');
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json(
    errorBody(
      'INTERNAL_ERROR',
      config.env === 'production' ? 'Internal server error' : err.message,
    ),
  );
});

module.exports = app;
