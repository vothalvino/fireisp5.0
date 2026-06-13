-- =============================================================================
-- Migration 348 — §20.2 Third-Party Integrations: provider catalog
-- Tables: integration_providers
-- =============================================================================

CREATE TABLE IF NOT EXISTS integration_providers (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider_key  VARCHAR(64)     NOT NULL,
  name          VARCHAR(255)    NOT NULL,
  category      ENUM(
                  'accounting',
                  'payment_gateway',
                  'communication',
                  'maps',
                  'monitoring',
                  'helpdesk',
                  'tax_sat',
                  'lorawan'
                ) NOT NULL,
  capabilities  JSON            NULL COMMENT 'Array of capability strings e.g. ["send_invoice","sync_contacts"]',
  description   TEXT            NULL,
  logo_url      VARCHAR(500)    NULL,
  docs_url      VARCHAR(500)    NULL,
  is_active     TINYINT(1)      NOT NULL DEFAULT 1,
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_integration_providers_key (provider_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed the named providers (idempotent via UNIQUE key on provider_key)
INSERT IGNORE INTO integration_providers
  (provider_key, name, category, capabilities, description)
VALUES
  -- Accounting
  ('quickbooks',    'QuickBooks Online',   'accounting',       '["sync_invoices","sync_payments","sync_contacts","export_gl"]',        'Intuit QuickBooks Online accounting integration'),
  ('contpaqi',      'ContPAQi',            'accounting',       '["sync_invoices","sync_payments","export_gl"]',                        'ContPAQi Mexican accounting software integration'),
  ('sap',           'SAP Business One',    'accounting',       '["sync_invoices","sync_payments","sync_contacts","export_gl"]',        'SAP B1 ERP accounting integration'),
  ('erpnext',       'ERPNext',             'accounting',       '["sync_invoices","sync_payments","sync_contacts","export_gl"]',        'Open-source ERPNext ERP integration'),
  -- Payment Gateways
  ('stripe',        'Stripe',              'payment_gateway',  '["charge","refund","webhook","recurring"]',                           'Stripe payment processing (delegates to paymentGatewayService)'),
  ('paypal',        'PayPal',              'payment_gateway',  '["charge","refund","webhook"]',                                       'PayPal payment processing'),
  ('conekta',       'Conekta',             'payment_gateway',  '["charge","refund","webhook","oxxo_pay"]',                            'Conekta Mexican payment gateway (delegates to paymentGatewayService)'),
  ('openpay',       'Openpay',             'payment_gateway',  '["charge","refund","webhook","oxxo_pay"]',                            'Openpay Mexican payment gateway'),
  ('mercadopago',   'MercadoPago',         'payment_gateway',  '["charge","refund","webhook","recurring"]',                           'MercadoPago Latin American payment platform'),
  ('oxxo_pay',      'OXXO Pay',            'payment_gateway',  '["charge","cash_payment"]',                                           'OXXO Pay cash voucher payment (Mexico)'),
  -- Communication
  ('twilio',        'Twilio',              'communication',    '["sms","voice","whatsapp"]',                                          'Twilio SMS/voice/WhatsApp (delegates to smsTransport)'),
  ('vonage',        'Vonage',              'communication',    '["sms","voice"]',                                                     'Vonage (Nexmo) SMS/voice (delegates to smsTransport)'),
  ('whatsapp_biz',  'WhatsApp Business',   'communication',    '["whatsapp"]',                                                        'WhatsApp Business API messaging'),
  ('sendgrid',      'SendGrid',            'communication',    '["email","templates","analytics"]',                                   'Twilio SendGrid email (delegates to emailTransport)'),
  -- Maps
  ('google_maps',   'Google Maps',         'maps',             '["geocoding","routing","distance_matrix","static_maps"]',             'Google Maps Platform APIs'),
  ('openstreetmap', 'OpenStreetMap',       'maps',             '["geocoding","tile_server"]',                                         'OpenStreetMap tile and Nominatim geocoding'),
  ('mapbox',        'MapBox',              'maps',             '["geocoding","routing","vector_tiles","static_maps"]',                'MapBox GL mapping platform'),
  -- Monitoring
  ('zabbix',        'Zabbix',              'monitoring',       '["host_sync","alert_sync","metric_pull","trigger_push"]',             'Zabbix network monitoring bidirectional sync'),
  ('prometheus',    'Prometheus',          'monitoring',       '["metric_push","scrape_target","alert_push"]',                        'Prometheus metrics scrape/push'),
  ('grafana',       'Grafana',             'monitoring',       '["dashboard_embed","annotation_push","alert_sync"]',                  'Grafana dashboards and alerting'),
  ('prtg',          'PRTG',                'monitoring',       '["sensor_sync","alert_sync","status_pull"]',                          'PRTG Network Monitor bidirectional sync'),
  -- Helpdesk
  ('zendesk',       'Zendesk',             'helpdesk',         '["ticket_import","ticket_export","contact_sync"]',                    'Zendesk support platform import/export'),
  ('freshdesk',     'Freshdesk',           'helpdesk',         '["ticket_import","ticket_export","contact_sync"]',                    'Freshdesk helpdesk import/export'),
  ('osticket',      'osTicket',            'helpdesk',         '["ticket_import","ticket_export"]',                                   'osTicket open-source helpdesk import/export'),
  -- Tax/SAT
  ('cfdi_pac',      'CFDI 4.0 PAC',        'tax_sat',          '["stamp_cfdi","cancel_cfdi","payment_complement"]',                   'CFDI 4.0 PAC stamping (delegates to cfdiService)'),
  -- LoRaWAN
  ('chirpstack',    'ChirpStack',          'lorawan',          '["device_sync","uplink_ingest","downlink_send","gateway_status"]',    'ChirpStack LoRaWAN network server integration');
