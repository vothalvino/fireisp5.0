// =============================================================================
// FireISP Operations Console — ThroughputChart point inspector
// =============================================================================
// The chart is clickable/hoverable: a crosshair + tooltip shows the bucket's
// timestamp and ingress/egress rates; click pins the tooltip, Escape releases.
// Stats read in the unit picked from the series peak (Mbps here, never a
// rounded-to-nothing "0.04 Gbps").
// =============================================================================
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThroughputChart } from '../consoleWidgets';
import { buildChartFromSeries, type ThroughputSeries } from '../consoleModel';

const series: ThroughputSeries = {
  points: [
    { ts: '2026-07-02T00:00:00Z', in_bps: 10_000_000, out_bps: 2_000_000 },
    { ts: '2026-07-02T00:15:00Z', in_bps: 40_000_000, out_bps: 8_000_000 },
  ],
  peak_bps: 40_000_000, avg_bps: 25_000_000, p95_bps: 40_000_000,
  peak_gbps: 0.04, avg_gbps: 0.03, p95_gbps: 0.04, has_data: true,
};

function renderChart() {
  return render(
    <ThroughputChart range="24H" onRange={() => {}} chart={buildChartFromSeries(series)} />,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('ThroughputChart', () => {
  it('renders stats in the peak-scaled unit instead of hardcoded Gbps', () => {
    renderChart();
    expect(screen.getAllByText('Mbps')).toHaveLength(3);
    expect(screen.getAllByText('40.0')).toHaveLength(2); // peak + p95
    expect(screen.getByText('25.0')).toBeTruthy();       // avg
    expect(screen.queryByText('Gbps')).toBeNull();
  });

  it('steps through buckets with arrow keys and shows the point tooltip', () => {
    renderChart();
    const hit = screen.getByRole('application');
    // First press lands on the most recent bucket.
    fireEvent.keyDown(hit, { key: 'ArrowLeft' });
    expect(screen.getByText('40.00 Mbps')).toBeTruthy();  // ingress @ point 1
    expect(screen.getByText('8.00 Mbps')).toBeTruthy();   // egress @ point 1
    fireEvent.keyDown(hit, { key: 'ArrowLeft' });
    expect(screen.getByText('10.00 Mbps')).toBeTruthy();  // ingress @ point 0
    fireEvent.keyDown(hit, { key: 'Escape' });
    expect(screen.queryByText('10.00 Mbps')).toBeNull();
  });

  it('pins the tooltip on click and releases on Escape', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 820, height: 200, left: 0, top: 0, right: 820, bottom: 200, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    renderChart();
    const hit = screen.getByRole('application');
    // Click near the right edge → nearest bucket is the last point.
    fireEvent.click(hit, { clientX: 810 });
    expect(screen.getByText(/pinned/)).toBeTruthy();
    expect(screen.getByText('40.00 Mbps')).toBeTruthy();
    // Pinned tooltip survives the pointer leaving the chart.
    fireEvent.pointerLeave(hit);
    expect(screen.getByText('40.00 Mbps')).toBeTruthy();
    fireEvent.keyDown(hit, { key: 'Escape' });
    expect(screen.queryByText('40.00 Mbps')).toBeNull();
  });

  it('renders the empty state when there is no chart', () => {
    render(<ThroughputChart range="24H" onRange={() => {}} emptyMessage="No SNMP telemetry yet." />);
    expect(screen.getByText('No SNMP telemetry yet.')).toBeTruthy();
    expect(screen.queryByRole('application')).toBeNull();
  });
});
