// =============================================================================
// FireISP 5.0 — Notification Hooks
// =============================================================================
// Registers event bus listeners that send emails, SMS, SSE broadcasts, and
// webhook dispatches when business events occur.
// =============================================================================

const eventBus = require('./eventBus');
const emailTransport = require('./emailTransport');
const templates = require('../views/emailTemplates');
const webhookService = require('./webhookService');
const logger = require('../utils/logger');

// Lazy-load broadcast to avoid circular dependency
let broadcast;
function getBroadcast() {
  if (!broadcast) {
    broadcast = require('../routes/events').broadcast;
  }
  return broadcast;
}

/**
 * Register all notification hooks on the event bus.
 * Call once at application startup.
 */
function registerHooks() {
  // --- Invoice Created ---
  eventBus.on('invoice.created', async ({ organizationId, invoice, client, items }) => {
    try {
      if (client?.email) {
        const template = templates.invoiceEmail({
          clientName: `${client.first_name || ''} ${client.last_name || ''}`.trim(),
          invoiceNumber: invoice.invoice_number,
          total: invoice.total,
          currency: invoice.currency,
          dueDate: invoice.due_date ? new Date(invoice.due_date).toISOString().slice(0, 10) : 'N/A',
          items: items || [],
        });

        await emailTransport.sendEmail({
          organizationId,
          to: client.email,
          subject: template.subject,
          html: template.html,
        });
      }

      // SSE broadcast
      getBroadcast()(`org:${organizationId}:notifications`, 'invoice.created', {
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        client_id: invoice.client_id,
        total: invoice.total,
        currency: invoice.currency,
      });

      // Webhook dispatch
      await webhookService.dispatch(organizationId, 'invoice.created', {
        id: invoice.id,
        invoice_number: invoice.invoice_number,
        client_id: invoice.client_id,
        total: invoice.total,
        currency: invoice.currency,
      });
    } catch (err) {
      logger.error({ err, event: 'invoice.created' }, 'Notification hook error');
    }
  });

  // --- Payment Received ---
  eventBus.on('payment.received', async ({ organizationId, payment, client }) => {
    try {
      if (client?.email) {
        const template = templates.paymentReceiptEmail({
          clientName: `${client.first_name || ''} ${client.last_name || ''}`.trim(),
          amount: payment.amount,
          currency: payment.currency,
          paymentMethod: payment.payment_method,
          reference: payment.reference,
          paymentDate: payment.created_at ? new Date(payment.created_at).toISOString().slice(0, 10) : undefined,
        });

        await emailTransport.sendEmail({
          organizationId,
          to: client.email,
          subject: template.subject,
          html: template.html,
        });
      }

      getBroadcast()(`org:${organizationId}:notifications`, 'payment.received', {
        payment_id: payment.id,
        client_id: payment.client_id,
        amount: payment.amount,
        currency: payment.currency,
      });

      await webhookService.dispatch(organizationId, 'payment.received', {
        id: payment.id,
        client_id: payment.client_id,
        amount: payment.amount,
        currency: payment.currency,
      });
    } catch (err) {
      logger.error({ err, event: 'payment.received' }, 'Notification hook error');
    }
  });

  // --- Contract Suspended ---
  eventBus.on('contract.suspended', async ({ organizationId, contract, client, invoice }) => {
    try {
      if (client?.email) {
        const template = templates.serviceSuspendedEmail({
          clientName: `${client.first_name || ''} ${client.last_name || ''}`.trim(),
          contractId: contract.id,
          total: invoice?.total,
          currency: invoice?.currency,
        });

        await emailTransport.sendEmail({
          organizationId,
          to: client.email,
          subject: template.subject,
          html: template.html,
        });
      }

      getBroadcast()(`org:${organizationId}:notifications`, 'contract.suspended', {
        contract_id: contract.id,
        client_id: contract.client_id,
      });

      await webhookService.dispatch(organizationId, 'contract.suspended', {
        id: contract.id,
        client_id: contract.client_id,
      });
    } catch (err) {
      logger.error({ err, event: 'contract.suspended' }, 'Notification hook error');
    }
  });

  // --- Contract Restored ---
  eventBus.on('contract.restored', async ({ organizationId, contract, _client }) => {
    try {
      getBroadcast()(`org:${organizationId}:notifications`, 'contract.restored', {
        contract_id: contract.id,
        client_id: contract.client_id,
      });

      await webhookService.dispatch(organizationId, 'contract.restored', {
        id: contract.id,
        client_id: contract.client_id,
      });
    } catch (err) {
      logger.error({ err, event: 'contract.restored' }, 'Notification hook error');
    }
  });

  // --- Suspension Warning ---
  eventBus.on('suspension.warning', async ({ organizationId, _contract, client, invoice, daysOverdue }) => {
    try {
      if (client?.email) {
        const template = templates.suspensionWarningEmail({
          clientName: `${client.first_name || ''} ${client.last_name || ''}`.trim(),
          daysOverdue,
          invoiceNumber: invoice?.invoice_number,
          total: invoice?.total,
          currency: invoice?.currency,
          dueDate: invoice?.due_date ? new Date(invoice.due_date).toISOString().slice(0, 10) : 'N/A',
        });

        await emailTransport.sendEmail({
          organizationId,
          to: client.email,
          subject: template.subject,
          html: template.html,
        });
      }
    } catch (err) {
      logger.error({ err, event: 'suspension.warning' }, 'Notification hook error');
    }
  });

  // --- Outage Reported ---
  eventBus.on('outage.reported', async ({ organizationId, outage }) => {
    try {
      getBroadcast()(`org:${organizationId}:outages`, 'outage.reported', {
        id: outage.id,
        title: outage.title,
        severity: outage.severity,
        started_at: outage.started_at,
      });

      await webhookService.dispatch(organizationId, 'outage.reported', {
        id: outage.id,
        title: outage.title,
        severity: outage.severity,
      });
    } catch (err) {
      logger.error({ err, event: 'outage.reported' }, 'Notification hook error');
    }
  });

  // --- Outage Resolved ---
  eventBus.on('outage.resolved', async ({ organizationId, outage }) => {
    try {
      getBroadcast()(`org:${organizationId}:outages`, 'outage.resolved', {
        id: outage.id,
        title: outage.title,
        resolved_at: outage.resolved_at,
      });

      await webhookService.dispatch(organizationId, 'outage.resolved', {
        id: outage.id,
        title: outage.title,
      });
    } catch (err) {
      logger.error({ err, event: 'outage.resolved' }, 'Notification hook error');
    }
  });

  // --- Ticket Created ---
  eventBus.on('ticket.created', async ({ organizationId, ticket }) => {
    try {
      getBroadcast()(`org:${organizationId}:notifications`, 'ticket.created', {
        id: ticket.id,
        subject: ticket.subject,
        client_id: ticket.client_id,
        priority: ticket.priority,
      });

      await webhookService.dispatch(organizationId, 'ticket.created', {
        id: ticket.id,
        subject: ticket.subject,
        client_id: ticket.client_id,
      });
    } catch (err) {
      logger.error({ err, event: 'ticket.created' }, 'Notification hook error');
    }
  });

  // --- Device Offline ---
  eventBus.on('device.offline', async ({ organizationId, device }) => {
    try {
      getBroadcast()(`org:${organizationId}:notifications`, 'device.offline', {
        id: device.id,
        name: device.name,
        ip_address: device.ip_address,
        type: device.type,
      });

      await webhookService.dispatch(organizationId, 'device.offline', {
        id: device.id,
        name: device.name,
        ip_address: device.ip_address,
      });
    } catch (err) {
      logger.error({ err, event: 'device.offline' }, 'Notification hook error');
    }
  });

  // --- Device Online ---
  eventBus.on('device.online', async ({ organizationId, device }) => {
    try {
      getBroadcast()(`org:${organizationId}:notifications`, 'device.online', {
        id: device.id,
        name: device.name,
        ip_address: device.ip_address,
      });

      await webhookService.dispatch(organizationId, 'device.online', {
        id: device.id,
        name: device.name,
        ip_address: device.ip_address,
      });
    } catch (err) {
      logger.error({ err, event: 'device.online' }, 'Notification hook error');
    }
  });

  logger.info('Notification hooks registered');
}

module.exports = { registerHooks };
