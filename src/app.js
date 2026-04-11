// =============================================================================
// FireISP 5.0 — Express Application
// =============================================================================

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config');
const { AppError } = require('./utils/errors');
const { apiLimiter, authLimiter } = require('./middleware/rateLimit');

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

const app = express();

// ---------------------------------------------------------------------------
// Global middleware
// ---------------------------------------------------------------------------
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/api/', apiLimiter);
app.use('/api/auth', authLimiter);

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '5.0.0' });
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

// ---------------------------------------------------------------------------
// 404 handler
// ---------------------------------------------------------------------------
app.use((_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------
app.use((err, _req, res, _next) => {
  // Handle MySQL trigger errors (SQLSTATE 45000)
  if (err.code === 'ER_SIGNAL_EXCEPTION' || err.errno === 1644) {
    return res.status(422).json({
      error: {
        code: 'DB_RULE_VIOLATION',
        message: err.sqlMessage || err.message,
      },
    });
  }

  // Handle MySQL duplicate key errors
  if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
    return res.status(409).json({
      error: {
        code: 'CONFLICT',
        message: 'A record with that value already exists',
      },
    });
  }

  // Handle MySQL FK constraint errors
  if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.errno === 1452) {
    return res.status(422).json({
      error: {
        code: 'FK_VIOLATION',
        message: 'Referenced record does not exist',
      },
    });
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details && { details: err.details }),
      },
    });
  }

  // Unexpected errors
  console.error('Unhandled error:', err);
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: config.env === 'production' ? 'Internal server error' : err.message,
    },
  });
});

module.exports = app;
