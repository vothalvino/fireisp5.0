// =============================================================================
// FireISP 5.0 — Portal Knowledge Base (§11.4)
// =============================================================================
// Lists and displays KB / FAQ articles within the portal.
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { portalTokenStore } from '@/auth/PortalAuthContext';

const API_BASE = '/api/v1/portal';

interface KbArticle {
  id: number;
  category: string;
  title: string;
  slug: string;
  body?: string;
  view_count: number;
  helpful_yes: number;
  helpful_no: number;
  updated_at: string;
}

async function portalFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = portalTokenStore.getAccess();
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error('Request failed');
  return res.json() as Promise<T>;
}

export function PortalKb() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [rated, setRated] = useState<Set<string>>(new Set());
  const [rateError, setRateError] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data: listData, isLoading } = useQuery({
    queryKey: ['portal-kb', category, search],
    queryFn: () => {
      const q = new URLSearchParams();
      if (category) q.set('category', category);
      if (search) q.set('search', search);
      q.set('limit', '50');
      return portalFetch<{ data: KbArticle[] }>(`/kb?${q}`);
    },
    staleTime: 60_000,
  });

  const { data: articleData } = useQuery({
    queryKey: ['portal-kb-article', selectedSlug],
    queryFn: () => portalFetch<{ data: KbArticle }>(`/kb/${selectedSlug!}`),
    enabled: selectedSlug !== null,
  });

  const rateMutation = useMutation({
    mutationFn: ({ slug, helpful }: { slug: string; helpful: boolean }) =>
      portalFetch(`/kb/${slug}/rate`, {
        method: 'POST',
        body: JSON.stringify({ helpful }),
      }),
    onSuccess: (_, { slug }) => {
      setRateError(null);
      setRated(r => new Set(r).add(slug));
      qc.invalidateQueries({ queryKey: ['portal-kb-article', slug] });
    },
    onError: (e: Error) => {
      setRateError(e.message || 'Failed to submit feedback. Please try again.');
    },
  });

  const articles = listData?.data ?? [];
  const article = articleData?.data ?? null;

  if (selectedSlug && article) {
    return (
      <div>
        <button onClick={() => setSelectedSlug(null)} style={styles.backBtn}>← Back to articles</button>
        <article style={styles.articleDetail}>
          <div style={styles.meta}>
            <span style={styles.category}>{article.category}</span>
          </div>
          <h1 style={styles.articleTitle}>{article.title}</h1>
          <div
            style={styles.body}
            dangerouslySetInnerHTML={{ __html: article.body ?? '' }}
          />
          <div style={styles.helpful}>
            <span style={styles.helpfulLabel}>Was this helpful?</span>
            {rated.has(article.slug) ? (
              <span style={styles.muted}>Thank you for your feedback!</span>
            ) : (
              <>
                <button
                  style={styles.helpBtn}
                  onClick={() => rateMutation.mutate({ slug: article.slug, helpful: true })}
                  disabled={rateMutation.isPending}
                >
                  Yes ({article.helpful_yes})
                </button>
                <button
                  style={styles.helpBtn}
                  onClick={() => rateMutation.mutate({ slug: article.slug, helpful: false })}
                  disabled={rateMutation.isPending}
                >
                  No ({article.helpful_no})
                </button>
              </>
            )}
            {rateError && (
              <span style={styles.rateError}>{rateError}</span>
            )}
          </div>
        </article>
      </div>
    );
  }

  return (
    <div>
      <h1 style={styles.heading}>Knowledge Base</h1>
      <p style={styles.sub}>Find answers to common questions</p>

      <div style={styles.filterBar}>
        <input
          type="search"
          placeholder="Search articles…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={styles.searchInput}
        />
        <select value={category} onChange={e => setCategory(e.target.value)} style={styles.select}>
          <option value="">All categories</option>
          <option value="billing">Billing</option>
          <option value="connectivity">Connectivity</option>
          <option value="account">Account</option>
          <option value="plans">Plans</option>
          <option value="general">General</option>
        </select>
      </div>

      {isLoading && <p style={styles.muted}>Loading…</p>}
      {!isLoading && articles.length === 0 && (
        <p style={styles.muted}>No articles found.</p>
      )}

      <div style={styles.articleList}>
        {articles.map(a => (
          <button key={a.id} style={styles.articleCard} onClick={() => setSelectedSlug(a.slug)}>
            <div style={styles.articleMeta}>
              <span style={styles.category}>{a.category}</span>
            </div>
            <h3 style={styles.articleCardTitle}>{a.title}</h3>
            <p style={styles.articleStats}>
              {a.view_count} views &middot; {a.helpful_yes} found helpful
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  heading: { margin: '0 0 0.25rem', fontSize: '1.4rem', color: 'var(--text-primary)' },
  sub: { margin: '0 0 1rem', color: 'var(--text-muted)', fontSize: '0.95rem' },
  muted: { color: 'var(--text-muted)', fontSize: '0.9rem' },
  filterBar: { display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' as const },
  searchInput: { flex: 1, minWidth: 180, padding: '0.45rem 0.6rem', border: '1px solid var(--input-border)', borderRadius: 4, fontSize: '0.9rem', background: 'var(--bg-input)', color: 'var(--text-primary)' },
  select: { padding: '0.45rem 0.6rem', border: '1px solid var(--input-border)', borderRadius: 4, fontSize: '0.9rem', background: 'var(--bg-input)', color: 'var(--text-primary)' },
  articleList: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' },
  articleCard: {
    textAlign: 'left' as const,
    padding: '1rem',
    background: 'var(--bg-card)',
    borderRadius: 8,
    border: '1px solid var(--border)',
    cursor: 'pointer',
    display: 'block',
    width: '100%',
  },
  articleMeta: { marginBottom: '0.3rem' },
  category: { fontSize: '0.75rem', padding: '0.1rem 0.4rem', borderRadius: 10, background: 'var(--bg-subtle)', color: 'var(--text-muted)', textTransform: 'capitalize' as const },
  articleCardTitle: { margin: '0.25rem 0 0.5rem', fontSize: '0.95rem', color: 'var(--text-primary)', fontWeight: 600 },
  articleStats: { margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' },
  backBtn: { background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.9rem', marginBottom: '1rem', padding: 0 },
  articleDetail: { background: 'var(--bg-card)', borderRadius: 8, padding: '1.5rem', boxShadow: '0 0 0 1px var(--border)' },
  meta: { marginBottom: '0.5rem' },
  articleTitle: { margin: '0 0 1rem', fontSize: '1.3rem', color: 'var(--text-primary)' },
  body: { fontSize: '0.95rem', lineHeight: 1.7, color: 'var(--text-secondary)' },
  helpful: { marginTop: '2rem', paddingTop: '1rem', borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: '0.75rem' },
  helpfulLabel: { fontSize: '0.875rem', color: 'var(--text-muted)' },
  helpBtn: { padding: '0.3rem 0.75rem', border: '1px solid var(--border-strong)', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem', background: 'var(--bg-card)', color: 'var(--text-secondary)' },
  rateError: { color: '#991b1b', fontSize: '0.8rem' },
};
