-- Migration: 120_seed_default_settings
-- Description: Populates the settings table with sensible defaults for a new
--              FireISP installation.  The application layer reads these values
--              on startup; without them it must either hard-code its own
--              defaults or fail to boot when a required key is missing.
--
--              Uses INSERT IGNORE so re-running this migration on an existing
--              installation does not overwrite administrator-customised values.
--              The settings table has a UNIQUE KEY on setting_key, so the
--              INSERT IGNORE is fully idempotent.

INSERT IGNORE INTO settings (setting_key, setting_value, description) VALUES
    -- Financial
    ('default_currency',            'USD',          'ISO 4217 currency code used as system default for new documents'),
    ('default_tax_rate',            '0.00',         'Default tax rate percentage applied to new invoices when no tax_rate_id is selected'),
    ('invoice_prefix',              'INV-',         'Prefix prepended to auto-generated invoice numbers'),
    ('quote_prefix',                'QUT-',         'Prefix prepended to auto-generated quote numbers'),
    ('credit_note_prefix',          'CN-',          'Prefix prepended to auto-generated credit note numbers'),
    -- Email / SMTP
    ('smtp_host',                   '',             'SMTP server hostname for outbound email'),
    ('smtp_port',                   '587',          'SMTP server port (25, 465, or 587)'),
    ('smtp_encryption',             'tls',          'SMTP encryption method: tls, ssl, or none'),
    ('smtp_username',               '',             'SMTP authentication username'),
    ('smtp_password',               '',             'SMTP authentication password (stored encrypted at app layer)'),
    -- SNMP / Monitoring
    ('snmp_default_poll_interval',  '300',          'Default SNMP polling interval in seconds'),
    ('snmp_default_community',      'public',       'Default SNMP community string for read-only access'),
    -- Company profile
    ('company_name',                '',             'ISP company name shown on invoices and reports'),
    ('company_email',               '',             'Primary contact email address for the ISP'),
    ('company_phone',               '',             'Primary contact phone number for the ISP'),
    -- Locale / UI
    ('timezone',                    'UTC',          'Default timezone for date/time display (IANA timezone name, e.g. America/Mexico_City)'),
    ('date_format',                 'YYYY-MM-DD',   'Display format for dates throughout the UI'),
    ('pagination_per_page',         '25',           'Default number of rows per page in list views'),
    -- Security
    ('session_timeout_minutes',     '60',           'Idle session timeout in minutes before the user is logged out'),
    ('max_login_attempts',          '5',            'Maximum consecutive failed login attempts before account lockout'),
    ('password_min_length',         '8',            'Minimum required password length for user accounts'),
    -- Automation
    ('auto_suspend_enabled',        'false',        'Enable automatic contract suspension for overdue invoices'),
    ('auto_suspend_days_overdue',   '30',           'Number of days past due before a contract is automatically suspended'),
    ('auto_invoice_enabled',        'false',        'Enable automatic invoice generation from billing periods'),
    ('auto_invoice_days_before_due','7',            'Generate invoices this many days before the billing period end date');
