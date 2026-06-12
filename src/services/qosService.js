// =============================================================================
// FireISP 5.0 — QoS Service
// =============================================================================
// Provides queue-tree configuration export and rate-limit string generation
// for §10.1 (Speed Profiles) and §10.2 (Rate Limiting).
// =============================================================================

const db = require('../config/database');

// ---------------------------------------------------------------------------
// Rate-string builders (mirrors radiusAttributeService logic but for templates)
// ---------------------------------------------------------------------------

/**
 * Build a MikroTik Mikrotik-Rate-Limit string from individual fields.
 *
 * Full format: "CIR-dl/CIR-ul burst-dl/burst-ul threshold-dl/threshold-ul burst-time"
 *
 * @param {object} params
 * @param {number} params.download_mbps
 * @param {number} params.upload_mbps
 * @param {number|null} [params.burst_download_mbps]
 * @param {number|null} [params.burst_upload_mbps]
 * @param {number|null} [params.burst_threshold_mbps]
 * @param {number|null} [params.burst_time_seconds]
 * @returns {string}
 */
function buildMikrotikRateString(params) {
  const dl = params.download_mbps || 0;
  const ul = params.upload_mbps || 0;
  const burstDl = params.burst_download_mbps || dl * 2;
  const burstUl = params.burst_upload_mbps || ul * 2;
  const threshDl = params.burst_threshold_mbps || dl;
  const threshUl = params.burst_threshold_mbps || ul;
  const burstTime = params.burst_time_seconds || 8;
  return `${dl}M/${ul}M ${burstDl}M/${burstUl}M ${threshDl}M/${threshUl}M ${burstTime}`;
}

/**
 * Build a Cisco sub-QoS policy pair string (informational — actual attrs are AVPairs).
 */
function buildCiscoRateString(params) {
  return `sub-qos-policy-in=ISP_DL_${params.download_mbps}M sub-qos-policy-out=ISP_UL_${params.upload_mbps}M`;
}

/**
 * Build a Juniper ERX QoS profile name.
 */
function buildJuniperRateString(params) {
  return `ISP_${params.download_mbps}M_${params.upload_mbps}M`;
}

/**
 * Build a WISPr-style bandwidth annotation (bps).
 */
function buildGenericRateString(params) {
  return `down=${params.download_mbps * 1000000} up=${params.upload_mbps * 1000000}`;
}

/**
 * Build the rendered rate string for a rate-limit template row.
 *
 * @param {object} template - rate_limit_templates row
 * @returns {string}
 */
function buildRateString(template) {
  switch (template.radius_vendor) {
    case 'mikrotik': return buildMikrotikRateString(template);
    case 'cisco':    return buildCiscoRateString(template);
    case 'juniper':  return buildJuniperRateString(template);
    default:         return buildGenericRateString(template);
  }
}

// ---------------------------------------------------------------------------
// Queue-tree export (stub driver pattern — matching §7 OLT/ONU approach)
// ---------------------------------------------------------------------------

/**
 * Build a MikroTik RouterOS /queue tree export script from org's active nodes.
 *
 * This is a stub: actual NAS push requires SSH/API access to the router.
 * The generated script can be copied into RouterOS terminal or applied via API.
 *
 * @param {Array} nodes - queue_tree_nodes rows ordered by sort_order
 * @returns {string} RouterOS CLI script
 */
function buildMikrotikQueueTreeScript(nodes) {
  const lines = [
    '# FireISP 5.0 — MikroTik Queue Tree Export',
    '# Generated: ' + new Date().toISOString(),
    '# Apply via: /import file-name=queue-tree.rsc',
    '',
    '/queue tree',
  ];

  for (const node of nodes) {
    if (node.queue_type !== 'tree') continue;
    const maxLimit = node.max_limit_mbps ? `${node.max_limit_mbps}M` : '0';
    const burstLimit = node.burst_limit_mbps ? `${node.burst_limit_mbps}M` : '0';
    const burstThresh = node.burst_threshold_mbps ? `${node.burst_threshold_mbps}M` : '0';
    const burstTime = node.burst_time_seconds ? `${node.burst_time_seconds}s` : '0s';
    const parent = node.parent_name || 'none';
    lines.push(
      `add name="${node.name}" parent=${parent}` +
      ` max-limit=${maxLimit} burst-limit=${burstLimit}` +
      ` burst-threshold=${burstThresh} burst-time=${burstTime}` +
      ` priority=${node.priority} queue=${node.queue_kind}` +
      (node.interface ? ' packet-mark=""' : '') +
      ' comment="FireISP auto-generated"',
    );
  }

  lines.push('');
  lines.push('/queue simple');
  for (const node of nodes) {
    if (node.queue_type !== 'simple') continue;
    const maxLimit = node.max_limit_mbps ? `${node.max_limit_mbps}M/${node.max_limit_mbps}M` : '0/0';
    lines.push(
      `add name="${node.name}" max-limit=${maxLimit}` +
      ` priority=${node.priority}/${node.priority}` +
      ` queue=${node.queue_kind}/${node.queue_kind}` +
      ' comment="FireISP auto-generated"',
    );
  }

  return lines.join('\n');
}

/**
 * Export queue tree configuration for an organization.
 *
 * @param {number} organizationId
 * @param {'mikrotik'} [vendor='mikrotik'] - target vendor (only MikroTik for now)
 * @returns {Promise<{script: string, node_count: number}>}
 */
async function exportQueueTreeConfig(organizationId, vendor = 'mikrotik') {
  // Load active nodes with parent name join
  const [nodes] = await db.query(
    `SELECT n.*, p.name AS parent_name
     FROM queue_tree_nodes n
     LEFT JOIN queue_tree_nodes p ON p.id = n.parent_id AND p.deleted_at IS NULL
     WHERE (n.organization_id = ? OR n.organization_id IS NULL)
       AND n.status = 'active'
       AND n.deleted_at IS NULL
     ORDER BY n.sort_order ASC, n.id ASC`,
    [organizationId],
  );

  let script;
  if (vendor === 'mikrotik') {
    script = buildMikrotikQueueTreeScript(nodes);
  } else {
    script = `# Vendor "${vendor}" queue tree export not yet implemented\n`;
  }

  return { script, node_count: nodes.length };
}

// ---------------------------------------------------------------------------
// Protocol shaping rule export
// ---------------------------------------------------------------------------

/**
 * Export protocol shaping rules for an organization (and optionally a plan)
 * as MikroTik mangle rules.
 *
 * @param {number} organizationId
 * @param {number|null} [planId]
 * @returns {Promise<{script: string, rule_count: number}>}
 */
async function exportShapingRulesConfig(organizationId, planId = null) {
  let sql = `SELECT * FROM protocol_shaping_rules
    WHERE (organization_id = ? OR organization_id IS NULL)
      AND enabled = 1
      AND deleted_at IS NULL`;
  const params = [organizationId];

  if (planId !== null) {
    sql += ' AND (plan_id = ? OR plan_id IS NULL)';
    params.push(planId);
  }
  sql += ' ORDER BY priority ASC, id ASC';

  const [rules] = await db.query(sql, params);

  const lines = [
    '# FireISP 5.0 — MikroTik Mangle Rules (Protocol Shaping)',
    '# Generated: ' + new Date().toISOString(),
    '',
    '/ip firewall mangle',
  ];

  for (const rule of rules) {
    if (rule.action === 'drop') {
      // Drop rule → filter instead
      lines.push(
        `# SKIP (drop rules belong in /ip firewall filter, not mangle): ${rule.name}`,
      );
      continue;
    }
    const proto = rule.protocol !== 'any' ? ` protocol=${rule.protocol}` : '';
    const dstPort = rule.dst_port_range ? ` dst-port=${rule.dst_port_range}` : '';
    const srcPort = rule.src_port_range ? ` src-port=${rule.src_port_range}` : '';
    const chain = rule.direction === 'download' ? 'forward' : 'forward';
    const markConn = `mangle-${rule.id}-conn`;
    const markPkt = `mangle-${rule.id}-pkt`;

    if (rule.dscp_mark) {
      lines.push(
        `add chain=${chain} action=mark-connection${proto}${dstPort}${srcPort}` +
        ` new-connection-mark=${markConn} passthrough=yes comment="${rule.name}"`,
      );
      lines.push(
        `add chain=${chain} action=mark-packet connection-mark=${markConn}` +
        ` new-packet-mark=${markPkt} passthrough=no`,
      );
    } else if (rule.limit_download_mbps || rule.limit_upload_mbps) {
      lines.push(
        `add chain=${chain} action=mark-connection${proto}${dstPort}${srcPort}` +
        ` new-connection-mark=${markConn} passthrough=yes comment="${rule.name}"`,
      );
      lines.push(
        `add chain=${chain} action=mark-packet connection-mark=${markConn}` +
        ` new-packet-mark=${markPkt} passthrough=no`,
      );
    }
  }

  return { script: lines.join('\n'), rule_count: rules.length };
}

module.exports = {
  buildRateString,
  buildMikrotikRateString,
  exportQueueTreeConfig,
  exportShapingRulesConfig,
};
