// =============================================================================
// FireISP 5.0 — Scheduled Task Validation Schemas
// =============================================================================

const createScheduledTask = {
  task_name: { type: 'string', required: true, min: 1, max: 100 },
  task_type: { type: 'string', required: true, enum: ['auto_suspend', 'generate_invoice', 'radius_sync', 'populate_revenue_summary', 'populate_network_health_snapshots', 'csd_expiry_monitor', 'snmp_poll', 'webhook_delivery', 'email_send'] },
  cron_expression: { type: 'string', required: true, max: 100 },
  description: { type: 'string', max: 500 },
  payload: { type: 'string', max: 5000 },
  priority: { type: 'string', enum: ['low', 'normal', 'high', 'critical'] },
  is_enabled: { type: 'boolean' },
};

const updateScheduledTask = {
  task_name: { type: 'string', min: 1, max: 100 },
  cron_expression: { type: 'string', max: 100 },
  description: { type: 'string', max: 500 },
  payload: { type: 'string', max: 5000 },
  priority: { type: 'string', enum: ['low', 'normal', 'high', 'critical'] },
  is_enabled: { type: 'boolean' },
};

module.exports = { createScheduledTask, updateScheduledTask };
