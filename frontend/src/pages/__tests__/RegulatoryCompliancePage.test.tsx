// =============================================================================
// FireISP 5.0 — RegulatoryCompliancePage tests (§16)
// =============================================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import RegulatoryCompliancePage from '../RegulatoryCompliancePage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: vi.fn() },
  }),
}));

vi.stubGlobal('fetch', vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ data: [] }),
  } as unknown as Response),
));

// Mock localStorage
Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: vi.fn(() => 'mock-token'),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
  writable: true,
});

describe('RegulatoryCompliancePage', () => {
  it('renders the page title', () => {
    render(<RegulatoryCompliancePage />);
    expect(screen.getByText('regulatoryCompliance.title')).toBeDefined();
  });

  it('renders all 8 tab buttons', () => {
    render(<RegulatoryCompliancePage />);
    // consent appears in both the button strip and the active tab h2 — use getAllByText
    expect(screen.getAllByText('regulatoryCompliance.tabs.consent').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('regulatoryCompliance.tabs.dsar').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('regulatoryCompliance.tabs.identity').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('regulatoryCompliance.tabs.numbering').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('regulatoryCompliance.tabs.uso').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('regulatoryCompliance.tabs.consumer').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('regulatoryCompliance.tabs.residency').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('regulatoryCompliance.tabs.audit').length).toBeGreaterThanOrEqual(1);
  });

  it('shows consent tab content by default', () => {
    render(<RegulatoryCompliancePage />);
    // Consent tab heading should be rendered (same key as tab button, appears twice —
    // once in the tab strip and once as the h2)
    const matches = screen.getAllByText('regulatoryCompliance.tabs.consent');
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});
