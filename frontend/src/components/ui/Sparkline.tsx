// =============================================================================
// FireISP UI — Sparkline
// =============================================================================
// A minimal inline SVG trend line. Originally authored inside the Operations
// Console widgets (frontend/src/pages/operations-console/consoleWidgets.tsx)
// and extracted here so any page can reuse the same compact trend visual
// (e.g. the SNMP fleet-glance cards) without importing an unrelated page's
// full widget module.
// =============================================================================

export interface SparklineProps {
  points: number[] | null;
  stroke?: string;
  vbW?: number;
  vbH?: number;
  h?: number;
}

export function Sparkline({ points, stroke = 'var(--accent)', vbW = 120, vbH = 24, h = 22 }: SparklineProps) {
  if (!points || points.length === 0) {
    return (
      <svg viewBox={`0 0 ${vbW} ${vbH}`} preserveAspectRatio="none" style={{ width: '100%', height: h, display: 'block' }}>
        <line x1="0" y1={vbH - 4} x2={vbW} y2={vbH - 4} stroke="var(--border-strong)" strokeWidth="1.5" />
      </svg>
    );
  }
  const n = points.length;
  const pts = points.map((v, i) => `${((i / (n - 1 || 1)) * vbW).toFixed(1)},${v}`).join(' ');
  return (
    <svg viewBox={`0 0 ${vbW} ${vbH}`} preserveAspectRatio="none" style={{ width: '100%', height: h, display: 'block' }}>
      <polyline fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" points={pts} />
    </svg>
  );
}
