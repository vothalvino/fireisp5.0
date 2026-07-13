// =============================================================================
// FireISP 5.0 — PortalKb page tests
// =============================================================================
// Regression coverage for the DOMPurify hardening added alongside the removal
// of the global input-side sanitize.js middleware (see src/app.js). Once
// request bodies stop being HTML-entity-encoded on the way in, PortalKb's
// dangerouslySetInnerHTML render of a staff-authored KB article body is the
// one real stored-XSS sink in the frontend and must sanitize on output
// instead.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PortalKb } from '../PortalKb';

vi.mock('@/auth/PortalAuthContext', () => ({
  portalTokenStore: { getAccess: () => 'portal-token' },
}));

const listArticle = {
  id: 1,
  category: 'general',
  title: 'XSS Test Article',
  slug: 'xss-article',
  view_count: 3,
  helpful_yes: 1,
  helpful_no: 0,
  updated_at: '2026-01-01T00:00:00Z',
};

const XSS_BODY = '<p>Hello <b>world</b></p><img src="x" onerror="window.__xssFired = true">';

const detailArticle = { ...listArticle, body: XSS_BODY };

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { __xssFired?: boolean }).__xssFired = undefined;
  global.fetch = vi.fn((url: string) => {
    if (url.includes('/kb/xss-article') && !url.includes('/rate')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: detailArticle }) } as Response);
    }
    if (url.includes('/kb?')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [listArticle] }) } as Response);
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) } as Response);
  }) as unknown as typeof fetch;
});

function renderPortalKb() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PortalKb />
    </QueryClientProvider>
  );
}

describe('PortalKb page', () => {
  it('renders the article list', async () => {
    renderPortalKb();
    await waitFor(() => expect(screen.getByText('XSS Test Article')).toBeInTheDocument());
  });

  it('sanitizes a malicious article body with DOMPurify before rendering it', async () => {
    const { container } = renderPortalKb();
    await waitFor(() => expect(screen.getByText('XSS Test Article')).toBeInTheDocument());

    fireEvent.click(screen.getByText('XSS Test Article'));

    await waitFor(() => expect(screen.getByText('Hello', { exact: false })).toBeInTheDocument());

    // Legitimate formatting survives sanitization.
    expect(container.querySelector('b')?.textContent).toBe('world');

    // The onerror handler is stripped — DOMPurify removes any `on*` attribute
    // that is not explicitly allowlisted, regardless of the tag it's on.
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('onerror')).toBeNull();
    expect((window as unknown as { __xssFired?: boolean }).__xssFired).toBeUndefined();
  });
});
