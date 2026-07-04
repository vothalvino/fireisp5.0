// =============================================================================
// FireISP 5.0 — RADIUS Attribute Service Tests
// =============================================================================

const { generateAttributes } = require('../src/services/radiusAttributeService');

describe('radiusAttributeService.generateAttributes()', () => {
  const basePlan = {
    download_speed_mbps: 10,
    upload_speed_mbps: 2,
    burst_download_mbps: 20,
    burst_upload_mbps: 4,
    radius_vendor: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns WISPr generic attributes when vendor is null', () => {
    const attrs = generateAttributes({ ...basePlan, radius_vendor: null });
    expect(attrs).toHaveProperty('WISPr-Bandwidth-Max-Down');
    expect(attrs).toHaveProperty('WISPr-Bandwidth-Max-Up');
    expect(attrs['WISPr-Bandwidth-Max-Down']).toBe(10 * 1000 * 1000);
    expect(attrs['WISPr-Bandwidth-Max-Up']).toBe(2 * 1000 * 1000);
  });

  it('returns MikroTik rate-limit attribute for mikrotik vendor', () => {
    const attrs = generateAttributes({ ...basePlan, radius_vendor: 'mikrotik' });
    expect(attrs).toHaveProperty('Mikrotik-Rate-Limit');
    expect(attrs['Mikrotik-Rate-Limit']).toMatch(/10M\/2M/);
    expect(attrs['Mikrotik-Rate-Limit']).toMatch(/20M\/4M/);
  });

  it('formats MikroTik burst speeds correctly', () => {
    const attrs = generateAttributes({
      download_speed_mbps: 100,
      upload_speed_mbps: 20,
      burst_download_mbps: 200,
      burst_upload_mbps: 40,
      radius_vendor: 'mikrotik',
    });
    expect(attrs['Mikrotik-Rate-Limit']).toBe('100M/20M 200M/40M 100M/20M 8');
  });

  it('defaults burst to 2x speed when burst fields are null', () => {
    const attrs = generateAttributes({
      download_speed_mbps: 10,
      upload_speed_mbps: 2,
      burst_download_mbps: null,
      burst_upload_mbps: null,
      radius_vendor: 'mikrotik',
    });
    expect(attrs['Mikrotik-Rate-Limit']).toBe('10M/2M 20M/4M 10M/2M 8');
  });

  it('appends the plan priority as the 5th rate-limit field when set', () => {
    // Business tier (priority 2) — the low number out-ranks residential under a
    // shared parent queue; RouterOS reads it as the queue priority.
    const attrs = generateAttributes({
      download_speed_mbps: 100,
      upload_speed_mbps: 20,
      burst_download_mbps: 200,
      burst_upload_mbps: 40,
      radius_vendor: 'mikrotik',
      priority: 2,
    });
    expect(attrs['Mikrotik-Rate-Limit']).toBe('100M/20M 200M/40M 100M/20M 8 2');
  });

  it('omits the priority field when the plan has no priority (legacy 4-field form)', () => {
    for (const priority of [null, undefined, '']) {
      const attrs = generateAttributes({
        download_speed_mbps: 10,
        upload_speed_mbps: 2,
        burst_download_mbps: 20,
        burst_upload_mbps: 4,
        radius_vendor: 'mikrotik',
        priority,
      });
      expect(attrs['Mikrotik-Rate-Limit']).toBe('10M/2M 20M/4M 10M/2M 8');
    }
  });

  it('returns Cisco AVPair attributes for cisco vendor', () => {
    const attrs = generateAttributes({ ...basePlan, radius_vendor: 'cisco' });
    expect(attrs).toHaveProperty('Cisco-AVPair');
    expect(Array.isArray(attrs['Cisco-AVPair'])).toBe(true);
    expect(attrs['Cisco-AVPair']).toContain('sub-qos-policy-in=ISP_DL_10M');
    expect(attrs['Cisco-AVPair']).toContain('sub-qos-policy-out=ISP_UL_2M');
  });

  it('returns Juniper ERX attributes for juniper vendor', () => {
    const attrs = generateAttributes({ ...basePlan, radius_vendor: 'juniper' });
    expect(attrs).toHaveProperty('ERX-Qos-Profile-Name');
    expect(attrs['ERX-Qos-Profile-Name']).toBe('ISP_10M_2M');
    expect(attrs).toHaveProperty('ERX-Input-Gigapkts');
  });
});
