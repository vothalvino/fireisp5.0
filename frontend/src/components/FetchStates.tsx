// =============================================================================
// FireISP 5.0 — shared fetch-state presentation
// =============================================================================
// ~150 pages hand-roll their loading / empty / error JSX. The consistency is
// the smaller half of the problem; the real defect is that many of them
// hardcode ENGLISH — 22 pages render a literal "Loading..." while a fully
// translated `common.loading` sits unused in all three locales. A
// Spanish-speaking operator hits random English mid-flow.
//
// react-query already unifies the state MACHINE. Only the presentation was
// missing, so this is deliberately three tiny components and no logic:
// anything cleverer would be a second state machine to keep in step.
//
// Adopting these is incremental by design. A page that needs bespoke copy
// passes `message`; a page that just needs "this did not load" passes nothing
// and gets a translated default.
// =============================================================================

import { useTranslation } from 'react-i18next';

const wrap: React.CSSProperties = {
  padding: '14px 4px',
  fontSize: 14,
  color: 'var(--text-muted, #6b7280)',
};

/** Data is on its way. */
export function LoadingState({ message }: { message?: string }) {
  const { t } = useTranslation();
  return <p style={wrap} role="status" aria-live="polite">{message ?? t('common.loading')}</p>;
}

/** The request succeeded and there is genuinely nothing to show. */
export function EmptyState({ message }: { message?: string }) {
  const { t } = useTranslation();
  return <p style={{ ...wrap, textAlign: 'center' }}>{message ?? t('common.noResults')}</p>;
}

/**
 * The request failed.
 *
 * `onRetry` is optional and renders a button rather than leaving the operator
 * with a dead end — react-query's refetch drops straight in.
 */
export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div style={wrap} role="alert">
      <span style={{ color: 'var(--danger, #b91c1c)' }}>{message ?? t('common.loadError')}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          style={{
            marginLeft: 10, padding: '3px 10px', fontSize: 12, cursor: 'pointer',
            borderRadius: 4, border: '1px solid var(--border-strong, #d1d5db)',
            background: 'transparent', color: 'var(--text-secondary, #374151)',
          }}
        >
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}
