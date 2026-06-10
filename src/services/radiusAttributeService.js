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
 * @param {string|null} [plan.radius_vendor] - 'mikrotik'|'cisco'|'juniper'|null
 * @returns {object} Attribute map ready for inclusion in RADIUS response
 */
function generateAttributes(plan) {
  const dl = plan.download_speed_mbps || 0;
  const ul = plan.upload_speed_mbps || 0;
  const burstDl = plan.burst_download_mbps || dl * 2;
  const burstUl = plan.burst_upload_mbps || ul * 2;

  switch (plan.radius_vendor) {
    case 'mikrotik':
      return generateMikrotikAttributes(dl, ul, burstDl, burstUl);
    case 'cisco':
      return generateCiscoAttributes(dl, ul);
    case 'juniper':
      return generateJuniperAttributes(dl, ul);
    default:
      return generateGenericAttributes(dl, ul);
  }
}

/**
 * MikroTik rate-limit format: "CIR/CIR burst/burst threshold/threshold burst-time priority"
 * Simplified: "DL/UL burstDL/burstUL"
 */
function generateMikrotikAttributes(dl, ul, burstDl, burstUl) {
  return {
    'Mikrotik-Rate-Limit': `${dl}M/${ul}M ${burstDl}M/${burstUl}M ${dl}M/${ul}M`,
  };
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
