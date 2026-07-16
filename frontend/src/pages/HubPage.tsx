// =============================================================================
// FireISP 5.0 — Hub overview page ("Faro" nav)
// =============================================================================
// Card-grid landing page for the Billing / Network / Admin sections. Cards and
// their links are generated from the nav route registry with the same
// role/locale filtering as the sidebar — a route added to the registry appears
// on its hub automatically. The sidebar shows each section's high-frequency
// shortlist; everything else in the section lives here, one click away.
// =============================================================================

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/auth/AuthContext';
import { visibleHubCards, type SectionId } from '@/nav/routes';

interface HubPageProps {
  section: Extract<SectionId, 'billing' | 'network' | 'admin'>;
}

export function HubPage({ section }: HubPageProps) {
  const { user } = useAuth();
  const { t } = useTranslation();

  const cards = user ? visibleHubCards(user, section) : [];

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>{t(`nav.hubs.${section}.title`)}</h1>
      </div>
      <p style={styles.hint}>{t(`nav.hubs.${section}.hint`)}</p>
      {cards.length === 0 ? (
        <p style={styles.empty}>{t('nav.hubs.empty')}</p>
      ) : (
        <div style={styles.grid}>
          {cards.map(({ card, items }) => (
            <div key={card} style={styles.card}>
              <h2 style={styles.cardTitle}>{t(`nav.cards.${card}`)}</h2>
              <ul style={styles.cardList}>
                {items.map(item => (
                  <li key={item.path}>
                    <Link to={item.path} style={styles.cardLink}>
                      {t(item.labelKey)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles = {
  page: { padding: '1.5rem' },
  header: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 },
  pageTitle: { fontSize: '1.4rem', margin: 0, color: 'var(--text-primary)' },
  hint: { color: 'var(--text-secondary)', fontSize: '0.9rem', margin: '4px 0 20px', maxWidth: 640 },
  empty: { color: 'var(--text-secondary)', fontSize: '0.9rem' },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
    gap: 14,
  },
  card: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '14px 16px',
  },
  cardTitle: {
    margin: '0 0 8px',
    fontSize: '0.72rem',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.07em',
    color: 'var(--text-secondary)',
  },
  cardList: { listStyle: 'none', margin: 0, padding: 0 },
  cardLink: {
    display: 'block',
    padding: '4px 0',
    color: 'var(--text-primary)',
    textDecoration: 'none',
    fontSize: '0.9rem',
  },
} as const;
