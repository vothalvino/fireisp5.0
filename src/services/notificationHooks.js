// =============================================================================
// FireISP 5.0 — Notification Hooks
// =============================================================================
// Registers event bus listeners that send emails, SMS, SSE broadcasts, and
// webhook dispatches when business events occur.
// =============================================================================

const eventBus = require('./eventBus');
const emailTransport = require('./emailTransport');
const smsTransport = require('./smsTransport');
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
  // --- Service Order Activated (welcome email/SMS) — §1.2 ---
  eventBus.on('service_order.activated', async ({ organizationId, order, client }) => {
    try {
      const clientName = client
        ? (`${client.first_name || ''} ${client.last_name || ''}`.trim() || client.name || '')
        : '';

      if (client?.email) {
        const subject = '¡Bienvenido! Tu servicio está activo';
        const html = `<p>Hola ${clientName || ''},</p>`
          + `<p>Tu servicio (orden ${order.order_number}) ha sido activado. `
          + 'Gracias por elegirnos.</p>'
          + '<p>Si tienes alguna duda, responde a este correo o abre un ticket de soporte.</p>';
        await emailTransport.sendEmail({
          organizationId,
          to: client.email,
          subject,
          html,
        });
      }

      if (client?.phone) {
        const smsBody = `Hola ${clientName || ''}, tu servicio (orden ${order.order_number}) ya está activo. ¡Bienvenido!`;
        await smsTransport.queueSms({
          organizationId,
          clientId: order.client_id,
          to:       client.phone,
          body:     smsBody,
        }).catch(err => logger.warn({ err, event: 'service_order.activated' }, 'SMS queue error'));
      }

      getBroadcast()(`org:${organizationId}:notifications`, 'service_order.activated', {
        order_id: order.id,
        order_number: order.order_number,
        client_id: order.client_id,
      });

      await webhookService.dispatch(organizationId, 'service_order.activated', {
        id: order.id,
        order_number: order.order_number,
        client_id: order.client_id,
        contract_id: order.contract_id,
      });
    } catch (err) {
      logger.error({ err, event: 'service_order.activated' }, 'Notification hook error');
    }
  });

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

      // SMS: notify client phone if available
      if (client?.phone) {
        const clientName = `${client.first_name || ''} ${client.last_name || ''}`.trim() || client.name || '';
        const smsBody = `Hola ${clientName}, se generó tu factura ${invoice.invoice_number} por ${invoice.currency} ${invoice.total}. Vence: ${invoice.due_date ? new Date(invoice.due_date).toISOString().slice(0, 10) : 'N/A'}.`;
        await smsTransport.queueSms({
          organizationId,
          clientId: invoice.client_id,
          to:       client.phone,
          body:     smsBody,
        }).catch(err => logger.warn({ err, event: 'invoice.created' }, 'SMS queue error'));
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

      // SMS: payment confirmation to client phone
      if (client?.phone) {
        const clientName = `${client.first_name || ''} ${client.last_name || ''}`.trim() || client.name || '';
        const smsBody = `Hola ${clientName}, recibimos tu pago de ${payment.currency} ${payment.amount}. Gracias!`;
        await smsTransport.queueSms({
          organizationId,
          clientId: payment.client_id,
          to:       client.phone,
          body:     smsBody,
        }).catch(err => logger.warn({ err, event: 'payment.received' }, 'SMS queue error'));
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

      // SMS: service suspension notice to client phone
      if (client?.phone) {
        const clientName = `${client.first_name || ''} ${client.last_name || ''}`.trim() || client.name || '';
        const smsBody = `Hola ${clientName}, tu servicio ha sido suspendido por falta de pago. Contáctanos para reactivarlo.`;
        await smsTransport.queueSms({
          organizationId,
          clientId: contract.client_id,
          to:       client.phone,
          body:     smsBody,
        }).catch(err => logger.warn({ err, event: 'contract.suspended' }, 'SMS queue error'));
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

      // SMS: suspension warning to client phone
      if (client?.phone) {
        const clientName = `${client.first_name || ''} ${client.last_name || ''}`.trim() || client.name || '';
        const invoiceRef = invoice?.invoice_number ? ` (factura ${invoice.invoice_number})` : '';
        const smsBody = `Hola ${clientName}, tienes ${daysOverdue} día(s) de atraso${invoiceRef}. Realiza tu pago para evitar la suspensión.`;
        await smsTransport.queueSms({
          organizationId,
          clientId: invoice?.client_id || null,
          to:       client.phone,
          body:     smsBody,
        }).catch(err => logger.warn({ err, event: 'suspension.warning' }, 'SMS queue error'));
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

  // --- Device Trap (unsolicited SNMP trap) ---
  eventBus.on('device.trap', async ({ organizationId, device, trapId, trapType, trapOid }) => {
    try {
      getBroadcast()(`org:${organizationId}:notifications`, 'device.trap', {
        trap_id:    trapId,
        device_id:  device.id,
        device_name: device.name,
        trap_type:  trapType,
        trap_oid:   trapOid,
      });

      await webhookService.dispatch(organizationId, 'device.trap', {
        trap_id:   trapId,
        device_id: device.id,
        name:      device.name,
        trap_type: trapType,
        trap_oid:  trapOid,
      });
    } catch (err) {
      logger.error({ err, event: 'device.trap' }, 'Notification hook error');
    }
  });

  // --- Follow-up Reminder Due — §1.3 ---
  eventBus.on('followup.due', async ({ organizationId, reminder }) => {
    try {
      if (reminder.assignee_email) {
        const html = `<p>Hola ${reminder.assignee_first_name || ''},</p>`
          + `<p>Tienes un seguimiento pendiente con el cliente <strong>${reminder.client_name || reminder.client_id}</strong>:</p>`
          + `<p><strong>${reminder.title}</strong></p>`
          + (reminder.notes ? `<p>${reminder.notes}</p>` : '')
          + `<p>Vencimiento: ${reminder.due_at ? new Date(reminder.due_at).toISOString().slice(0, 16).replace('T', ' ') : 'N/A'}</p>`;
        await emailTransport.sendEmail({
          organizationId,
          to: reminder.assignee_email,
          subject: `Seguimiento pendiente: ${reminder.title}`,
          html,
        });
      }

      getBroadcast()(`org:${organizationId}:notifications`, 'followup.due', {
        reminder_id: reminder.id,
        client_id: reminder.client_id,
        title: reminder.title,
        due_at: reminder.due_at,
        assigned_to: reminder.assigned_to,
      });

      await webhookService.dispatch(organizationId, 'followup.due', {
        id: reminder.id,
        client_id: reminder.client_id,
        title: reminder.title,
        due_at: reminder.due_at,
      });
    } catch (err) {
      logger.error({ err, event: 'followup.due' }, 'Notification hook error');
    }
  });

  // --- Satisfaction Survey Requested — §1.3 ---
  eventBus.on('survey.requested', async ({ organizationId, survey, client, ticket }) => {
    try {
      if (client?.email && survey.channel === 'email') {
        const isNps = survey.survey_type === 'nps';
        const scale = isNps ? '0 a 10' : '1 a 5';
        const question = isNps
          ? '¿Qué tan probable es que nos recomiendes a un amigo o colega?'
          : '¿Qué tan satisfecho quedaste con la atención recibida?';
        const context = ticket ? `<p>Referencia: ticket "${ticket.subject}".</p>` : '';
        const html = `<p>Hola ${client.name || ''},</p>`
          + `<p>${question}</p>${context}`
          + `<p>Responde a este correo con una calificación de <strong>${scale}</strong> y, si lo deseas, un comentario.</p>`
          + '<p>¡Gracias por ayudarnos a mejorar!</p>';
        await emailTransport.sendEmail({
          organizationId,
          to: client.email,
          subject: isNps ? 'Tu opinión nos importa — encuesta rápida' : '¿Cómo fue tu experiencia de soporte?',
          html,
        });
      }

      getBroadcast()(`org:${organizationId}:notifications`, 'survey.requested', {
        survey_id: survey.id,
        client_id: survey.client_id,
        survey_type: survey.survey_type,
        ticket_id: survey.ticket_id,
      });

      await webhookService.dispatch(organizationId, 'survey.requested', {
        id: survey.id,
        client_id: survey.client_id,
        survey_type: survey.survey_type,
        ticket_id: survey.ticket_id,
      });
    } catch (err) {
      logger.error({ err, event: 'survey.requested' }, 'Notification hook error');
    }
  });

  // --- Ticket Escalated — §1.3 ---
  eventBus.on('ticket.escalated', async ({ organizationId, escalation, ticket }) => {
    try {
      getBroadcast()(`org:${organizationId}:notifications`, 'ticket.escalated', {
        escalation_id: escalation.id,
        ticket_id: ticket.id,
        subject: ticket.subject,
        level: escalation.level,
        reason: escalation.reason,
      });

      await webhookService.dispatch(organizationId, 'ticket.escalated', {
        id: escalation.id,
        ticket_id: ticket.id,
        level: escalation.level,
        reason: escalation.reason,
        escalated_to: escalation.escalated_to,
      });
    } catch (err) {
      logger.error({ err, event: 'ticket.escalated' }, 'Notification hook error');
    }
  });

  logger.info('Notification hooks registered');
}

module.exports = { registerHooks };
