// =============================================================================
// FireISP 5.0 — RADIUS Attribute Service
// =============================================================================
// Generates vendor-formatted RADIUS attribute sets for a plan's speed policy.
// Supports MikroTik, Cisco, and Juniper vendor-specific attributes,
// falling back to WISPr generic attributes when no vendor is configured.
// =============================================================================

const BYTES_PER_MBPS = 1000 * 1000;

/**
 * Generate vendor-specific RADIUS attributes for a plan.
 *
 * @param {object} plan - Plan row from the database
 * @param {number} plan.download_speed_mbps
 * @param {number} plan.upload_speed_mbps
 * @param {number|null} [plan.burst_download_mbps]
 * @param {number|null} [plan.burst_upload_mbps]
 * @param {number|null} [plan.burst_threshold_mbps] - MikroTik burst-threshold (migration 286)
 * @param {number|null} [plan.burst_time_seconds]   - MikroTik burst-time (migration 286)
 * @param {string|null} [plan.radius_vendor] - 'mikrotik'|'cisco'|'juniper'|null
 * @returns {object} Attribute map ready for inclusion in RADIUS response
 */
function generateAttributes(plan) {
  const dl = plan.download_speed_mbps || 0;
  const ul = plan.upload_speed_mbps || 0;
  const burstDl = plan.burst_download_mbps || dl * 2;
  const burstUl = plan.burst_upload_mbps || ul * 2;
  // MikroTik burst semantics (§10.1): threshold defaults to CIR, time defaults to 8 s
  const burstThreshDl = plan.burst_threshold_mbps || dl;
  const burstThreshUl = plan.burst_threshold_mbps || ul;
  const burstTime = plan.burst_time_seconds || 8;

  switch (plan.radius_vendor) {
    case 'mikrotik':
      return generateMikrotikAttributes(dl, ul, burstDl, burstUl, burstThreshDl, burstThreshUl, burstTime, plan.priority);
    case 'cisco':
      return generateCiscoAttributes(dl, ul);
    case 'juniper':
      return generateJuniperAttributes(dl, ul);
    default:
      return generateGenericAttributes(dl, ul);
  }
}

/**
 * MikroTik Mikrotik-Rate-Limit format (full form):
 *   rx/tx burst-rx/burst-tx burst-threshold-rx/burst-threshold-tx burst-time priority min-rx/min-tx
 * Emitted as: "CIR-DL/CIR-UL burst-DL/burst-UL threshold-DL/threshold-UL burst-time [priority]"
 *
 * The optional 5th field is the queue PRIORITY (1 = highest … 8 = lowest). When the
 * plan sets one it is appended so the session's dynamic queue carries it — this is
 * how "business (low number) out-prioritises residential" reaches the device, since
 * RouterOS has no RADIUS attribute to assign a session to a specific parent queue.
 * Omitted when the plan has no priority, keeping the legacy 4-field string intact.
 *
 * Reference: https://wiki.mikrotik.com/wiki/Queues#Burst_Parameters
 *
 * @param {number|string|null|undefined} [priority] Plan queue priority 1-8
 */
function generateMikrotikAttributes(dl, ul, burstDl, burstUl, burstThreshDl, burstThreshUl, burstTime, priority) {
  let rateLimit = `${dl}M/${ul}M ${burstDl}M/${burstUl}M ${burstThreshDl}M/${burstThreshUl}M ${burstTime}`;
  if (priority !== null && priority !== undefined && priority !== '') {
    rateLimit += ` ${priority}`;
  }
  return { 'Mikrotik-Rate-Limit': rateLimit };
}

/**
 * Cisco VSA sub-QoS policy attribute pairs
 */
function generateCiscoAttributes(dl, ul) {
  return {
    'Cisco-AVPair': [
      `sub-qos-policy-in=ISP_DL_${dl}M`,
      `sub-qos-policy-out=ISP_UL_${ul}M`,
    ],
  };
}

/**
 * Juniper ERX QoS profile attributes
 */
function generateJuniperAttributes(dl, ul) {
  return {
    'ERX-Qos-Profile-Name': `ISP_${dl}M_${ul}M`,
    'ERX-Input-Gigapkts': String(dl),
  };
}

/**
 * WISPr generic bandwidth attributes (bits per second)
 */
function generateGenericAttributes(dl, ul) {
  return {
    'WISPr-Bandwidth-Max-Down': dl * BYTES_PER_MBPS,
    'WISPr-Bandwidth-Max-Up': ul * BYTES_PER_MBPS,
  };
}

module.exports = { generateAttributes };
