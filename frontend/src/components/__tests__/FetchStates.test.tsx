// =============================================================================
// FireISP 5.0 — FetchStates tests (j23, first pass)
// =============================================================================
// The consistency problem was the smaller half. The real defect: 22 pages
// rendered a literal English "Loading..." while a fully translated
// `common.loading` sat unused in all three locales, so a Spanish-speaking
// operator hit random English mid-flow.
//
// The last describe is the one that matters long-term — it fails if the
// hardcoded pattern comes back.
// =============================================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { LoadingState, EmptyState, ErrorState } from '../FetchStates';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { changeLanguage: vi.fn() } }),
}));

describe('each state renders a translated default', () => {
  it('LoadingState uses common.loading', () => {
    render(<LoadingState />);
    expect(screen.getByText('common.loading')).toBeInTheDocument();
  });

  it('EmptyState uses common.noResults', () => {
    render(<EmptyState />);
    expect(screen.getByText('common.noResults')).toBeInTheDocument();
  });

  it('ErrorState uses common.loadError', () => {
    render(<ErrorState />);
    expect(screen.getByText('common.loadError')).toBeInTheDocument();
  });
});

describe('a page can still say something specific', () => {
  it.each([
    ['LoadingState', <LoadingState message="Consultando al PAC…" />],
    ['EmptyState', <EmptyState message="Sin facturas este mes" />],
    ['ErrorState', <ErrorState message="El PAC no respondió" />],
  ])('%s prefers an explicit message over the default', (_n, el) => {
    render(el);
    expect(screen.queryByText(/^common\./)).toBeNull();
  });
});

describe('accessibility and retry', () => {
  it('announces loading politely rather than silently swapping content', () => {
    render(<LoadingState />);
    const el = screen.getByRole('status');
    expect(el).toHaveAttribute('aria-live', 'polite');
  });

  it('an error is announced as an alert', () => {
    render(<ErrorState />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('offers a retry only when the caller can actually retry', () => {
    const { rerender } = render(<ErrorState />);
    expect(screen.queryByRole('button')).toBeNull();   // no dead-end button
    const onRetry = vi.fn();
    rerender(<ErrorState onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onRetry).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The regression guard. Without this the 22 pages drift back one PR at a time.
// ---------------------------------------------------------------------------
describe('no page hardcodes an English fetch-state string', () => {
  const pagesDir = path.resolve(__dirname, '../../pages');

  function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(full);
      return e.name.endsWith('.tsx') ? [full] : [];
    });
  }

  it('renders no literal "Loading..." anywhere under pages/', () => {
    const offenders = walk(pagesDir).filter(f => />Loading\.\.\.</.test(fs.readFileSync(f, 'utf8')));
    // Name them, so a failure tells you exactly what to fix.
    expect(offenders.map(f => path.basename(f))).toEqual([]);
  });

  it('the translated key these pages should use exists in ALL three locales', () => {
    // The defect was never a missing translation — it was 22 pages not using
    // the one that already existed. Pin that it still exists everywhere.
    const localesDir = path.resolve(__dirname, '../../i18n/locales');
    for (const loc of ['en', 'es', 'pt-BR']) {
      const json = JSON.parse(fs.readFileSync(path.join(localesDir, `${loc}.json`), 'utf8'));
      expect(json.common?.loading, `${loc} common.loading`).toBeTruthy();
      expect(json.common?.noResults, `${loc} common.noResults`).toBeTruthy();
      expect(json.common?.loadError, `${loc} common.loadError`).toBeTruthy();
      expect(json.common?.retry, `${loc} common.retry`).toBeTruthy();
    }
  });
});
