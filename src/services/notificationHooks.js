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
const portalPushService = require('./portalPushService');
const alertService = require('./alertService');
const logger = require('../utils/logger');
// Every inline `html` string built directly in this file (as opposed to via
// templates.xxxEmail(), which escapes internally) interpolates free-text
// DB fields — client/assignee names, ticket subjects, outage/maintenance
// titles & descriptions, IP pool names — into HTML sent to a real mail
// client. `esc()` HTML-escapes each interpolated value; it is never applied
// to the parallel SMS bodies in this file (those are plain text).
const { escapeHtmlForTemplate: esc } = require('./notificationService');

// Lazy-load broadcast to avoid circular dependency
let broadcast;
function getBroadcast() {
  if (!broadcast) {
    broadcast = require('../routes/events').broadcast;
  }
  return broadcast;
}

// ---------------------------------------------------------------------------
// Shared helper: active staff recipients for in-app + email notifications.
//
// NOTE (flagged, not fixed in this PR): this follows the SAME precedent every
// existing recipient-resolution query in this file already uses — filtering
// on the legacy `users.role` column (outage.reported's admin/support email
// leg, ip_pool.threshold's admin/technician email leg) — rather than the
// authoritative `organization_users` per-org membership role used everywhere
// else in the RBAC system (see User.getPermissions). A user whose real
// access comes only from an organization_users membership, with no legacy
// users.role set, will not receive these notifications. Redesigning
// recipient resolution is out of scope for this PR; this just keeps new
// listeners consistent with the file's existing (inconsistent) convention.
// ---------------------------------------------------------------------------
async function resolveStaffRecipients(organizationId, roles) {
  const db = require('../config/database');
  const placeholders = roles.map(() => '?').join(', ');
  const [rows] = await db.query(
    `SELECT id, email, first_name FROM users
     WHERE organization_id = ?
       AND role IN (${placeholders})
       AND status = 'active'
       AND email IS NOT NULL
       AND deleted_at IS NULL`,
    [organizationId, ...roles],
  );
  return rows;
}

/**
 * Parse alert_rules.notification_channels (a JSON array column, e.g.
 * '["email","webhook"]'). Returns null when the value is missing or fails to
 * parse into an array — treated by callers as "all channels enabled", for
 * backward compatibility with rules created before this column had any
 * effect (previously nothing read it at all).
 */
function parseNotificationChannels(raw) {
  if (raw === null || raw === undefined) return null;
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (_err) {
    return null;
  }
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
        ? (client.name || '')
        : '';

      if (client?.email) {
        const subject = '¡Bienvenido! Tu servicio está activo';
        const html = `<p>Hola ${esc(clientName || '')},</p>`
          + `<p>Tu servicio (orden ${esc(order.order_number)}) ha sido activado. `
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
          clientName: client.name || '',
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
        const clientName = client.name || '';
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

      // Web Push to client's portal subscriptions
      if (invoice.client_id) {
        await portalPushService.dispatch({
          clientId: invoice.client_id,
          eventType: 'billing',
          payload: {
            title: 'Nueva factura disponible',
            body: `Factura ${invoice.invoice_number} por ${invoice.currency} ${invoice.total}`,
            url: '/portal/invoices',
          },
        }).catch(err2 => logger.warn({ err: err2, event: 'invoice.created' }, 'Portal push dispatch error'));
      }
    } catch (err) {
      logger.error({ err, event: 'invoice.created' }, 'Notification hook error');
    }
  });

  // --- Payment Received ---
  eventBus.on('payment.received', async ({ organizationId, payment, client }) => {
    try {
      if (client?.email) {
        const template = templates.paymentReceiptEmail({
          clientName: client.name || '',
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
        const clientName = client.name || '';
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

      // Web Push to client's portal subscriptions
      if (payment.client_id) {
        await portalPushService.dispatch({
          clientId: payment.client_id,
          eventType: 'billing',
          payload: {
            title: 'Pago recibido',
            body: `Recibimos tu pago de ${payment.currency} ${payment.amount}. ¡Gracias!`,
            url: '/portal/payments',
          },
        }).catch(err2 => logger.warn({ err: err2, event: 'payment.received' }, 'Portal push dispatch error'));
      }
    } catch (err) {
      logger.error({ err, event: 'payment.received' }, 'Notification hook error');
    }
  });

  // --- Contract Suspended ---
  eventBus.on('contract.suspended', async ({ organizationId, contract, client, invoice }) => {
    try {
      if (client?.email) {
        const template = templates.serviceSuspendedEmail({
          clientName: client.name || '',
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
        const clientName = client.name || '';
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
          clientName: client.name || '',
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
        const clientName = client.name || '';
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

  // --- Work Order Assigned (technician dispatch) ---
  // Emitted by routes/workOrders.js on create-with-assignee and whenever
  // assigned_to changes to a new user. Notifies the assignee in-app (bell) and
  // by email, and dispatches the org webhook.
  eventBus.on('work_order.assigned', async ({ organizationId, workOrder }) => {
    try {
      const db = require('../config/database');
      const Notification = require('../models/Notification');
      const scheduled = workOrder.scheduled_at
        ? new Date(workOrder.scheduled_at).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
        : null;

      await Notification.create({
        user_id:     workOrder.assigned_to,
        type:        'work_order',
        title:       `Work order assigned: ${workOrder.title}`,
        body:        [
          workOrder.work_type ? `Type: ${workOrder.work_type}` : null,
          workOrder.priority ? `Priority: ${workOrder.priority}` : null,
          scheduled ? `Scheduled: ${scheduled}` : null,
          workOrder.address ? `Address: ${workOrder.address}` : null,
        ].filter(Boolean).join('\n') || null,
        entity_type: 'work_orders',
        entity_id:   workOrder.id,
      }).catch(err2 => logger.warn({ err: err2, workOrderId: workOrder.id }, 'Work order in-app notification error'));

      await webhookService.dispatch(organizationId, 'work_order.assigned', {
        id: workOrder.id,
        title: workOrder.title,
        work_type: workOrder.work_type,
        priority: workOrder.priority,
        assigned_to: workOrder.assigned_to,
        scheduled_at: workOrder.scheduled_at,
      }).catch(err2 => logger.warn({ err: err2, workOrderId: workOrder.id }, 'Work order webhook error'));

      // Email the assignee
      try {
        const [[assignee]] = await db.query(
          `SELECT email, first_name FROM users
           WHERE id = ? AND organization_id = ? AND status = 'active' AND email IS NOT NULL AND deleted_at IS NULL`,
          [workOrder.assigned_to, organizationId],
        );
        if (assignee?.email) {
          const html = `<p>Hola ${esc(assignee.first_name || '')},</p>`
            + '<p>Se te asignó una orden de trabajo:</p>'
            + `<p><strong>#${workOrder.id} — ${esc(workOrder.title)}</strong></p>`
            + (workOrder.work_type ? `<p>Tipo: ${esc(workOrder.work_type)}</p>` : '')
            + (workOrder.priority ? `<p>Prioridad: ${esc(workOrder.priority)}</p>` : '')
            + (scheduled ? `<p>Programada: ${esc(scheduled)}</p>` : '')
            + (workOrder.address ? `<p>Dirección: ${esc(workOrder.address)}</p>` : '')
            + '<p>Consulta los detalles en tu panel de técnico.</p>';
          await emailTransport.sendEmail({
            organizationId,
            to: assignee.email,
            subject: `Orden de trabajo asignada: #${workOrder.id} ${workOrder.title}`,
            html,
          }).catch(err2 => logger.warn({ err: err2, workOrderId: workOrder.id }, 'Work order assignee email error'));
        }
      } catch (mailErr) {
        logger.warn({ err: mailErr, event: 'work_order.assigned' }, 'Work order assignee lookup error');
      }
    } catch (err) {
      logger.error({ err, event: 'work_order.assigned' }, 'Notification hook error');
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

      // Web Push — send to all clients in the org that have outage notifications enabled
      try {
        const db = require('../config/database');
        const [subs] = await db.query(
          `SELECT DISTINCT client_id FROM portal_push_subscriptions
           WHERE organization_id = ? AND notify_outage = 1 AND deleted_at IS NULL`,
          [organizationId],
        );
        for (const sub of subs) {
          await portalPushService.dispatch({
            clientId: sub.client_id,
            eventType: 'outage',
            payload: {
              title: 'Interrupción de servicio',
              body: outage.title || 'Se reportó una interrupción en su área',
              url: '/portal/dashboard',
            },
          }).catch(err2 => logger.warn({ err: err2, clientId: sub.client_id }, 'Portal push outage dispatch error'));
        }
      } catch (pushErr) {
        logger.warn({ err: pushErr, event: 'outage.reported' }, 'Portal push bulk dispatch error');
      }

      // Notify admins/support by email when a new outage is reported — §1.4
      // (also creates the in-app bell row for the same recipient set, off
      // the same SELECT — no second query needed for the bell leg)
      try {
        const db = require('../config/database');
        const Notification = require('../models/Notification');
        const [admins] = await db.query(
          `SELECT u.id, u.email, u.first_name FROM users u
           WHERE u.organization_id = ?
             AND u.role IN ('admin', 'support')
             AND u.status = 'active'
             AND u.email IS NOT NULL`,
          [organizationId],
        );
        const html = '<p>Se reportó una interrupción de servicio:</p>'
          + `<p><strong>${esc(outage.title)}</strong></p>`
          + (outage.severity ? `<p>Severidad: ${esc(outage.severity)}</p>` : '')
          + (outage.started_at ? `<p>Inicio: ${new Date(outage.started_at).toISOString().replace('T', ' ').slice(0, 16)} UTC</p>` : '');
        for (const admin of admins) {
          await Notification.create({
            user_id:     admin.id,
            type:        'outage',
            title:       `Interrupción reportada: ${outage.title}`,
            body:        outage.severity ? `Severidad: ${outage.severity}` : null,
            entity_type: 'outages',
            entity_id:   outage.id,
          }).catch(err2 => logger.warn({ err: err2, event: 'outage.reported', userId: admin.id }, 'Outage in-app notification error'));

          await emailTransport.sendEmail({
            organizationId,
            to: admin.email,
            subject: `Interrupción reportada: ${outage.title}`,
            html,
          }).catch(err2 => logger.warn({ err: err2, event: 'outage.reported' }, 'Admin outage email error'));
        }
      } catch (notifyErr) {
        logger.warn({ err: notifyErr, event: 'outage.reported' }, 'Admin outage notification error');
      }
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

      // Bell rows only — quiet, no new email leg (an email was already sent
      // when the outage was reported; resolution is lower-urgency).
      try {
        const db = require('../config/database');
        const Notification = require('../models/Notification');
        const [admins] = await db.query(
          `SELECT u.id FROM users u
           WHERE u.organization_id = ?
             AND u.role IN ('admin', 'support')
             AND u.status = 'active'
             AND u.deleted_at IS NULL`,
          [organizationId],
        );
        for (const admin of admins) {
          await Notification.create({
            user_id:     admin.id,
            type:        'outage',
            title:       `Interrupción resuelta: ${outage.title}`,
            body:        null,
            entity_type: 'outages',
            entity_id:   outage.id,
          }).catch(err2 => logger.warn({ err: err2, event: 'outage.resolved', userId: admin.id }, 'Outage in-app notification error'));
        }
      } catch (notifyErr) {
        logger.warn({ err: notifyErr, event: 'outage.resolved' }, 'Admin outage resolved notification error');
      }
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
  // Emitted by deviceStatusService.recordPollResult() when a device crosses
  // the consecutive-failed-polls threshold. Bell + email go to admin/
  // technician staff — UNLESS the device is inside an active maintenance
  // window (a device going quiet during planned work is expected, not an
  // incident): broadcast/webhook still fire unconditionally for any external
  // tooling watching, but the noisy staff notification is skipped and logged.
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

      let suppressedByMaintenance = false;
      try {
        suppressedByMaintenance = await alertService.isInMaintenanceWindow(organizationId, device.id);
      } catch (mwErr) {
        logger.warn({ err: mwErr, event: 'device.offline', deviceId: device.id }, 'Maintenance-window check failed; proceeding as not-suppressed');
      }

      if (suppressedByMaintenance) {
        logger.info(
          { event: 'device.offline', deviceId: device.id, organizationId },
          'device.offline bell/email suppressed — device is inside an active maintenance window',
        );
        return;
      }

      const Notification = require('../models/Notification');
      const title = `Dispositivo fuera de línea: ${device.name}`;
      const recipients = await resolveStaffRecipients(organizationId, ['admin', 'technician']);
      for (const recipient of recipients) {
        await Notification.create({
          user_id:     recipient.id,
          type:        'device',
          title,
          body:        device.ip_address ? `IP: ${device.ip_address}` : null,
          entity_type: 'devices',
          entity_id:   device.id,
        }).catch(err2 => logger.warn({ err: err2, event: 'device.offline', userId: recipient.id }, 'Device in-app notification error'));

        if (recipient.email) {
          const html = `<p>El dispositivo <strong>${esc(device.name)}</strong> dejó de responder.</p>`
            + (device.ip_address ? `<p>IP: ${esc(device.ip_address)}</p>` : '');
          await emailTransport.sendEmail({
            organizationId,
            to: recipient.email,
            subject: title,
            html,
          }).catch(err2 => logger.warn({ err: err2, event: 'device.offline', userId: recipient.id }, 'Device offline email error'));
        }
      }
    } catch (err) {
      logger.error({ err, event: 'device.offline' }, 'Notification hook error');
    }
  });

  // --- Device Online ---
  // Emitted by deviceStatusService.recordPollResult() when a previously
  // detector-flipped-offline device recovers. Bell rows only — no email (a
  // "back online" notice is lower urgency than the outage itself).
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

      const Notification = require('../models/Notification');
      const recipients = await resolveStaffRecipients(organizationId, ['admin', 'technician']);
      for (const recipient of recipients) {
        await Notification.create({
          user_id:     recipient.id,
          type:        'device',
          title:       `Dispositivo en línea: ${device.name}`,
          body:        device.ip_address ? `IP: ${device.ip_address}` : null,
          entity_type: 'devices',
          entity_id:   device.id,
        }).catch(err2 => logger.warn({ err: err2, event: 'device.online', userId: recipient.id }, 'Device in-app notification error'));
      }
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

  // --- Alert Triggered (monitoring rule breach) ---
  // Emitted by alertService.evaluateAlerts()/evaluateAlertsV2() on a
  // threshold breach — already deduped upstream to one notification per
  // ~60-minute breach "episode" (see alertService.hasRecentAlertEpisode);
  // this handler fires at most once per episode regardless of how many
  // evaluation cycles the underlying condition stays breached across.
  // Honors alert_rules.notification_channels (JSON, written by
  // src/routes/alerts.js but never read before this PR): a null/unparseable
  // value is treated as "all channels enabled" for backward compatibility
  // with rules created before this column had any effect. 'sms' is not wired
  // — no SMS transport precedent for staff alerting in this file (the
  // existing SMS sends here are all client-facing templates) — an honest
  // stub, not silently dropped nor faked.
  eventBus.on('alert.triggered', async ({ organizationId, rule, breach }) => {
    try {
      const db = require('../config/database');
      const Notification = require('../models/Notification');

      const channels = parseNotificationChannels(rule.notification_channels);
      const emailEnabled = channels === null || channels.includes('email');
      const webhookEnabled = channels === null || channels.includes('webhook');

      let deviceName = null;
      if (breach.device_id) {
        try {
          const [[device]] = await db.query(
            'SELECT name FROM devices WHERE id = ? AND deleted_at IS NULL',
            [breach.device_id],
          );
          deviceName = device?.name || null;
        } catch (_err) {
          // Device name is cosmetic — never block the alert notification on it.
        }
      }

      const title = `Alerta: ${rule.name}`;
      const bodyLines = [
        `Métrica: ${rule.metric} ${breach.operator} ${breach.threshold} (valor actual: ${breach.current_value})`,
        rule.severity ? `Severidad: ${rule.severity}` : null,
        deviceName ? `Dispositivo: ${deviceName}` : null,
      ].filter(Boolean);
      const body = bodyLines.join('\n');

      const recipients = await resolveStaffRecipients(organizationId, ['admin', 'technician']);
      for (const recipient of recipients) {
        // Bell row — always, regardless of notification_channels (non-intrusive).
        await Notification.create({
          user_id:     recipient.id,
          type:        'alert',
          title,
          body,
          entity_type: breach.device_id ? 'devices' : null,
          entity_id:   breach.device_id || null,
        }).catch(err2 => logger.warn({ err: err2, event: 'alert.triggered', userId: recipient.id }, 'Alert in-app notification error'));

        if (emailEnabled && recipient.email) {
          const html = '<p>Se activó una alerta de monitoreo:</p>'
            + `<p><strong>${esc(rule.name)}</strong></p>`
            + `<p>Métrica: ${esc(rule.metric)} ${esc(breach.operator)} ${esc(String(breach.threshold))} `
            + `(valor actual: ${esc(String(breach.current_value))})</p>`
            + (rule.severity ? `<p>Severidad: ${esc(rule.severity)}</p>` : '')
            + (deviceName ? `<p>Dispositivo: ${esc(deviceName)}</p>` : '');
          await emailTransport.sendEmail({
            organizationId,
            to: recipient.email,
            subject: title,
            html,
          }).catch(err2 => logger.warn({ err: err2, event: 'alert.triggered', userId: recipient.id }, 'Alert email error'));
        }
      }

      if (webhookEnabled) {
        await webhookService.dispatch(organizationId, 'alert.triggered', {
          rule_id:       rule.id,
          rule_name:     rule.name,
          metric:        rule.metric,
          operator:      breach.operator,
          threshold:     breach.threshold,
          current_value: breach.current_value,
          device_id:     breach.device_id,
          severity:      rule.severity,
        }).catch(err2 => logger.warn({ err: err2, event: 'alert.triggered' }, 'Alert webhook error'));
      }
    } catch (err) {
      logger.error({ err, event: 'alert.triggered' }, 'Notification hook error');
    }
  });

  // --- Alert Escalated (unacknowledged alert climbs an escalation chain step) ---
  // Emitted by alertService.triggerEscalation(). Unlike alert.triggered, the
  // step row carries an external on-call contact directly
  // (recipient_email/recipient_phone/webhook_url) — there is no user lookup
  // for the escalation leg itself. Staff still get an in-app bell row
  // (admin/technician) so the escalation is visible without waiting on the
  // external channel.
  eventBus.on('alert.escalated', async ({ alertEventId, stepNumber, step }) => {
    try {
      const db = require('../config/database');
      const Notification = require('../models/Notification');

      const [[eventRow]] = await db.query(
        `SELECT ae.organization_id, ae.device_id, ae.current_value,
                ar.name AS rule_name, ar.metric, ar.severity
         FROM alert_events ae
         JOIN alert_rules ar ON ar.id = ae.alert_rule_id
         WHERE ae.id = ?`,
        [alertEventId],
      );
      if (!eventRow) return;
      const organizationId = eventRow.organization_id;

      let deviceName = null;
      if (eventRow.device_id) {
        try {
          const [[device]] = await db.query(
            'SELECT name FROM devices WHERE id = ? AND deleted_at IS NULL',
            [eventRow.device_id],
          );
          deviceName = device?.name || null;
        } catch (_err) {
          // Device name is cosmetic — never block the escalation notification on it.
        }
      }

      const title = `Alerta escalada (nivel ${stepNumber}): ${eventRow.rule_name}`;
      const bodyLines = [
        `Métrica: ${eventRow.metric} (valor actual: ${eventRow.current_value})`,
        eventRow.severity ? `Severidad: ${eventRow.severity}` : null,
        deviceName ? `Dispositivo: ${deviceName}` : null,
      ].filter(Boolean);
      const body = bodyLines.join('\n');

      // In-app bell rows for staff — always, regardless of the step's channel.
      const recipients = await resolveStaffRecipients(organizationId, ['admin', 'technician']);
      for (const recipient of recipients) {
        await Notification.create({
          user_id:     recipient.id,
          type:        'alert',
          title,
          body,
          entity_type: eventRow.device_id ? 'devices' : null,
          entity_id:   eventRow.device_id || null,
        }).catch(err2 => logger.warn({ err: err2, event: 'alert.escalated', userId: recipient.id }, 'Escalation in-app notification error'));
      }

      // External on-call contact — the step's OWN channel, not a user lookup.
      switch (step.notification_channel) {
        case 'email':
          if (step.recipient_email) {
            const html = `<p>Escalación de alerta — nivel ${stepNumber}:</p>`
              + `<p><strong>${esc(eventRow.rule_name)}</strong></p>`
              + `<p>Métrica: ${esc(eventRow.metric)} (valor actual: ${esc(String(eventRow.current_value))})</p>`
              + (eventRow.severity ? `<p>Severidad: ${esc(eventRow.severity)}</p>` : '')
              + (deviceName ? `<p>Dispositivo: ${esc(deviceName)}</p>` : '');
            await emailTransport.sendEmail({
              organizationId,
              to: step.recipient_email,
              subject: title,
              html,
            }).catch(err2 => logger.warn({ err: err2, event: 'alert.escalated' }, 'Escalation email error'));
          }
          break;
        case 'webhook':
          // webhookService.dispatch() only targets an organization's
          // REGISTERED webhooks (matched by subscribed event name) — it has
          // no concept of an arbitrary one-off URL, so step.webhook_url
          // itself is never directly called; a per-step external webhook URL
          // needs a dedicated, signed one-off HTTP sender, which is NOT
          // implemented in this PR (flagged as a gap in the PR body — this
          // 'webhook' branch is dispatched at the org level as the closest
          // available approximation, exactly like the honest stubs below).
          //
          // SECURITY: dispatch() broadcasts to EVERY active webhook
          // subscriber for the org, so the payload below must never carry
          // step.webhook_url (a secret Slack/PagerDuty-style incoming-webhook
          // URL) or any recipient PII (recipient_email/recipient_phone) —
          // only non-sensitive alert identifiers.
          await webhookService.dispatch(organizationId, 'alert.escalated', {
            alert_event_id: alertEventId,
            step_number:    stepNumber,
            rule_name:      eventRow.rule_name,
          }).catch(err2 => logger.warn({ err: err2, event: 'alert.escalated' }, 'Escalation webhook error'));
          break;
        case 'sms':
        case 'whatsapp':
        case 'telegram':
          // Honest stub — no transport precedent in these hooks for an
          // external, non-portal contact on these channels. Logged, not
          // silently dropped nor faked as sent.
          logger.warn(
            { event: 'alert.escalated', channel: step.notification_channel, alertEventId },
            `Escalation channel '${step.notification_channel}' is not implemented yet`,
          );
          break;
        default:
          break;
      }
    } catch (err) {
      logger.error({ err, event: 'alert.escalated' }, 'Notification hook error');
    }
  });

  // --- Follow-up Reminder Due — §1.3 ---
  eventBus.on('followup.due', async ({ organizationId, reminder }) => {
    try {
      if (reminder.assignee_email) {
        const html = `<p>Hola ${esc(reminder.assignee_first_name || '')},</p>`
          + `<p>Tienes un seguimiento pendiente con el cliente <strong>${esc(reminder.client_name || reminder.client_id)}</strong>:</p>`
          + `<p><strong>${esc(reminder.title)}</strong></p>`
          + (reminder.notes ? `<p>${esc(reminder.notes)}</p>` : '')
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
        const context = ticket ? `<p>Referencia: ticket "${esc(ticket.subject)}".</p>` : '';
        const html = `<p>Hola ${esc(client.name || '')},</p>`
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

  // --- Maintenance Scheduled — §1.4 ---
  eventBus.on('maintenance.scheduled', async ({ organizationId, maintenance }) => {
    try {
      getBroadcast()(`org:${organizationId}:notifications`, 'maintenance.scheduled', {
        id: maintenance.id,
        title: maintenance.title,
        scheduled_at: maintenance.scheduled_at,
        estimated_duration_minutes: maintenance.estimated_duration_minutes,
      });

      await webhookService.dispatch(organizationId, 'maintenance.scheduled', {
        id: maintenance.id,
        title: maintenance.title,
        description: maintenance.description,
        scheduled_at: maintenance.scheduled_at,
        estimated_duration_minutes: maintenance.estimated_duration_minutes,
      });

      // Email + SMS notification to relevant clients via admin contact
      try {
        const db = require('../config/database');
        const scheduledAt = maintenance.scheduled_at
          ? new Date(maintenance.scheduled_at).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
          : 'N/A';
        const duration = maintenance.estimated_duration_minutes
          ? `${maintenance.estimated_duration_minutes} minutos`
          : 'duración estimada no disponible';

        const html = '<p>Se ha programado un mantenimiento en su servicio:</p>'
          + `<p><strong>${esc(maintenance.title)}</strong></p>`
          + (maintenance.description ? `<p>${esc(maintenance.description)}</p>` : '')
          + `<p>Fecha y hora: ${scheduledAt}</p>`
          + `<p>Duración estimada: ${duration}</p>`
          + '<p>Disculpe las molestias. Le notificaremos cuando el mantenimiento haya concluido.</p>';

        const smsBody = `Mantenimiento programado: ${maintenance.title}. Fecha: ${scheduledAt}. Duración aprox.: ${duration}.`;

        const [clients] = await db.query(
          `SELECT c.id, c.email, c.phone, c.name
           FROM clients c
           WHERE c.organization_id = ?
             AND c.status = 'active'`,
          [organizationId],
        );

        for (const client of clients) {
          if (client.email) {
            await emailTransport.sendEmail({
              organizationId,
              to: client.email,
              subject: `Aviso de mantenimiento: ${maintenance.title}`,
              html,
            }).catch(err2 => logger.warn({ err: err2 }, 'Maintenance email error'));
          }
          if (client.phone) {
            await smsTransport.queueSms({
              organizationId,
              clientId: client.id,
              to: client.phone,
              body: smsBody,
            }).catch(err2 => logger.warn({ err: err2 }, 'Maintenance SMS error'));
          }
        }
      } catch (notifyErr) {
        logger.warn({ err: notifyErr, event: 'maintenance.scheduled' }, 'Maintenance client notification error');
      }
    } catch (err) {
      logger.error({ err, event: 'maintenance.scheduled' }, 'Notification hook error');
    }
  });

  // --- Invoice Late Fee Applied (§2.2 Phase B) ---
  eventBus.on('invoice.late_fee_applied', async ({ organizationId, invoice, client, rule, fee_amount, currency }) => {
    try {
      if (client?.email) {
        const subject = `Late Fee Applied — Invoice ${invoice.invoice_number}`;
        const html = `<p>Dear ${esc(client.name || 'Client')},</p>`
          + `<p>A late fee of <strong>${currency} ${parseFloat(fee_amount).toFixed(2)}</strong> `
          + `has been applied to invoice <strong>${esc(invoice.invoice_number)}</strong> `
          + `as per your account's late fee policy (${esc(rule.name)}).</p>`
          + '<p>Please arrange payment at your earliest convenience to avoid further charges.</p>';

        await emailTransport.sendEmail({
          organizationId,
          to: client.email,
          subject,
          html,
        });
      }

      getBroadcast()(`org:${organizationId}:notifications`, 'invoice.late_fee_applied', {
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        client_id: invoice.client_id,
        fee_amount,
        currency,
      });
    } catch (err) {
      logger.error({ err, event: 'invoice.late_fee_applied' }, 'Notification hook error');
    }
  });

  // --- Refund Requested (notify billing staff via webhook) — §2.5 ---
  eventBus.on('refund.requested', async ({ organizationId, refundRequest }) => {
    try {
      await webhookService.dispatch(organizationId, 'refund.requested', {
        id: refundRequest.id,
        amount: refundRequest.amount,
        reason: refundRequest.reason,
      });
    } catch (err) {
      logger.error({ err, event: 'refund.requested' }, 'Notification hook error');
    }
  });

  // --- Refund Processed (notify client via email if available) — §2.5 ---
  eventBus.on('refund.processed', async ({ organizationId, refundRequest, client }) => {
    try {
      if (client?.email) {
        await emailTransport.sendEmail({
          organizationId,
          to: client.email,
          subject: 'Your refund has been processed',
          html: `<p>Your refund of ${refundRequest.amount} has been processed.</p>`,
        });
      }
      await webhookService.dispatch(organizationId, 'refund.processed', {
        id: refundRequest.id,
        amount: refundRequest.amount,
        refund_method: refundRequest.refund_method,
      });
    } catch (err) {
      logger.error({ err, event: 'refund.processed' }, 'Notification hook error');
    }
  });

  // --- PPPoE Auth Failures (Phase B §4) ---
  eventBus.on('pppoe.auth_failures', async ({ organizationId, username, failureCount, window_minutes, reasons }) => {
    try {
      getBroadcast()(`org:${organizationId}:notifications`, 'pppoe.auth_failures', {
        username,
        failureCount,
      });
      await webhookService.dispatch(organizationId, 'pppoe.auth_failures', {
        username,
        failureCount,
        window_minutes,
        reasons,
      });
    } catch (err) {
      logger.error({ err, event: 'pppoe.auth_failures' }, 'Notification hook error');
    }
  });

  // --- IP Pool Utilization Threshold ---
  eventBus.on('ip_pool.threshold', async ({ organizationId, pool, percent, threshold, assigned, usable }) => {
    try {
      const db = require('../config/database');
      const [admins] = await db.query(
        `SELECT u.email, u.first_name FROM users u
         WHERE u.organization_id = ?
           AND u.role IN ('admin', 'technician')
           AND u.status = 'active'
           AND u.email IS NOT NULL`,
        [organizationId],
      );
      const html = `<p>IP Pool <strong>${esc(pool.name)}</strong> (${esc(pool.network)}) has reached `
        + `<strong>${percent}%</strong> utilization (${assigned}/${usable} addresses assigned).</p>`
        + `<p>Threshold crossed: ${threshold}%</p>`
        + '<p>Consider expanding the pool or adding a new one.</p>';
      for (const admin of admins) {
        await emailTransport.sendEmail({
          organizationId,
          to: admin.email,
          subject: `IP Pool Alert: ${pool.name} at ${percent}% capacity`,
          html,
        }).catch(err2 => logger.warn({ err: err2, event: 'ip_pool.threshold' }, 'Admin pool threshold email error'));
      }
    } catch (err) {
      logger.error({ err, event: 'ip_pool.threshold' }, 'Notification hook error');
    }
  });

  logger.info('Notification hooks registered');
}

module.exports = { registerHooks };
