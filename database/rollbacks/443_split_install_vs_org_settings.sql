-- =============================================================================
-- Rollback 443: undo the install-vs-org settings split
-- =============================================================================
-- Moves any per-org values back to the global table (first org's value wins,
-- matching the pre-split reality where ONE global row served every org), drops
-- organization_settings, and re-seeds the migration-120 defaults it deleted.
-- Like rollback 431, this restores seed DEFAULTS, not administrator-customised
-- values — and since nothing ever read the dead keys, no behaviour depended on
-- those values either way.

INSERT IGNORE INTO settings (setting_key, setting_value)
SELECT os.setting_key, os.setting_value
FROM organization_settings os
JOIN (
    SELECT setting_key, MIN(id) AS min_id
    FROM organization_settings
    WHERE setting_key IN ('mab_password_mode', 'pppoe_auth_failure_threshold')
    GROUP BY setting_key
) first_row ON first_row.min_id = os.id;

DROP TABLE IF EXISTS organization_settings;

INSERT IGNORE INTO settings (setting_key, setting_value, description) VALUES
    ('invoice_prefix',               'INV-',       'Prefix prepended to auto-generated invoice numbers'),
    ('quote_prefix',                 'QUT-',       'Prefix prepended to auto-generated quote numbers'),
    ('credit_note_prefix',           'CN-',        'Prefix prepended to auto-generated credit note numbers'),
    ('smtp_host',                    '',           'SMTP server hostname for outbound email'),
    ('smtp_port',                    '587',        'SMTP server port (25, 465, or 587)'),
    ('smtp_encryption',              'tls',        'SMTP encryption method: tls, ssl, or none'),
    ('smtp_username',                '',           'SMTP authentication username'),
    ('smtp_password',                '',           'SMTP authentication password (stored encrypted at app layer)'),
    ('snmp_default_poll_interval',   '300',        'Default SNMP polling interval in seconds'),
    ('snmp_default_community',       'public',     'Default SNMP community string for read-only access'),
    ('company_name',                 '',           'ISP company name shown on invoices and reports'),
    ('company_email',                '',           'Primary contact email address for the ISP'),
    ('company_phone',                '',           'Primary contact phone number for the ISP'),
    ('timezone',                     'UTC',        'Default timezone for date/time display (IANA timezone name)'),
    ('date_format',                  'YYYY-MM-DD', 'Display format for dates throughout the UI'),
    ('pagination_per_page',          '25',         'Default number of rows per page in list views'),
    ('session_timeout_minutes',      '60',         'Idle session timeout in minutes before the user is logged out'),
    ('max_login_attempts',           '5',          'Maximum consecutive failed login attempts before account lockout'),
    ('password_min_length',          '8',          'Minimum required password length for user accounts'),
    ('auto_suspend_enabled',         'false',      'Enable automatic contract suspension for overdue invoices'),
    ('auto_suspend_days_overdue',    '30',         'Number of days past due before a contract is automatically suspended'),
    ('auto_invoice_enabled',         'false',      'Enable automatic invoice generation from billing periods'),
    ('auto_invoice_days_before_due', '7',          'Generate invoices this many days before the billing period end date');
