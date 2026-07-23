-- Rollback 415 — re-seed the RG-EW1300G template exactly as migration 413 did.
INSERT IGNORE INTO snmp_profiles
    (name, manufacturer, model_pattern, device_type, snmp_version, poll_interval_sec, is_default, description)
VALUES (
    'Ruijie RG-EW1300G',
    'Ruijie', '%EW1300G%', 'indoor_cpe',
    'v2c', 300, FALSE,
    'Reyee RG-EW1300G home router. CAUTION: stock Reyee firmware is cloud-managed and may not expose an SNMP agent at all — template applies where SNMP is available. Standard IF-MIB traffic/errors only.'
);
INSERT IGNORE INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, aggregate, transform, sort_order)
SELECT p.id, o.oid, o.metric_column, o.label, o.oid_type, o.is_per_interface, FALSE, NULL, o.sort_order
FROM snmp_profiles p
JOIN (
    SELECT '1.3.6.1.2.1.2.2.1.10' AS oid, 'if_in_octets'  AS metric_column, 'Inbound Octets'   AS label, 'counter' AS oid_type, TRUE AS is_per_interface, 10 AS sort_order UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.16',        'if_out_octets',                  'Outbound Octets',          'counter',             TRUE,                     20 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.14',        'if_in_errors',                   'Inbound Errors',           'counter',             TRUE,                     30 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.20',        'if_out_errors',                  'Outbound Errors',          'counter',             TRUE,                     40
) o
WHERE p.name = 'Ruijie RG-EW1300G' AND p.deleted_at IS NULL;
