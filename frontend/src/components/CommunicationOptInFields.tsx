import { useTranslation } from 'react-i18next';
import { MarkdownView } from '@/components/MarkdownView';

export interface CommunicationOptIns {
  email: boolean;
  sms: boolean;
  whatsapp: boolean;
}

export interface CommunicationContacts {
  email: boolean;
  phone: boolean;
}

export interface SigningPrivacyNotice {
  version: string;
  content: string;
  hash: string;
}

interface CommunicationOptInFieldsProps {
  contacts: CommunicationContacts;
  privacyNotice: SigningPrivacyNotice | null;
  value: CommunicationOptIns;
  onChange: (value: CommunicationOptIns) => void;
  confirmed: boolean;
  onConfirmedChange: (confirmed: boolean) => void;
  disabled?: boolean;
}

/**
 * Explicit, optional marketing choices captured alongside the customer's
 * handoff signature. All channels deliberately start unchecked in the parent
 * modal. These choices grant marketing permission only; a channel DND opt-out
 * remains an overriding veto for every client-directed message class.
 */
export function CommunicationOptInFields({
  contacts,
  privacyNotice,
  value,
  onChange,
  confirmed,
  onConfirmedChange,
  disabled = false,
}: CommunicationOptInFieldsProps) {
  const { t } = useTranslation();
  const channels: Array<{
    key: keyof CommunicationOptIns;
    available: boolean;
    unavailableKey: 'emailUnavailable' | 'phoneUnavailable';
  }> = [
    { key: 'email', available: contacts.email, unavailableKey: 'emailUnavailable' },
    { key: 'sms', available: contacts.phone, unavailableKey: 'phoneUnavailable' },
    { key: 'whatsapp', available: contacts.phone, unavailableKey: 'phoneUnavailable' },
  ];

  return (
    <section
      aria-labelledby="communication-opt-in-title"
      style={{
        border: '1px solid var(--border, var(--border-color, #d1d5db))',
        borderRadius: 8,
        padding: '0.85rem',
        marginTop: '0.9rem',
      }}
    >
      <h4 id="communication-opt-in-title" style={{ margin: '0 0 0.35rem' }}>
        {t('communicationOptIn.title')}
      </h4>
      <p style={{ margin: '0 0 0.7rem', color: 'var(--text-secondary)', fontSize: '0.84rem' }}>
        {t('communicationOptIn.optionalHelp')}
      </p>

      <div style={{ display: 'grid', gap: 8 }}>
        {channels.map(({ key, available, unavailableKey }) => (
          <label key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: '0.88rem' }}>
            <input
              type="checkbox"
              checked={value[key]}
              disabled={disabled || !available}
              onChange={event => onChange({ ...value, [key]: event.target.checked })}
            />
            <span>
              {t(`communicationOptIn.channels.${key}`)}
              {!available && (
                <span style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '0.76rem' }}>
                  {t(`communicationOptIn.${unavailableKey}`)}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>

      <p style={{ margin: '0.75rem 0', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
        {t('communicationOptIn.essentialSeparate')}
      </p>

      {privacyNotice ? (
        <div style={{ borderTop: '1px solid var(--border, var(--border-color, #d1d5db))', paddingTop: '0.75rem' }}>
          <strong style={{ fontSize: '0.84rem' }}>
            {t('communicationOptIn.privacyNotice', { version: privacyNotice.version })}
          </strong>
          <div
            data-testid="signing-privacy-notice"
            style={{
              maxHeight: 180,
              overflowY: 'auto',
              marginTop: 6,
              padding: '0.65rem',
              borderRadius: 6,
              background: 'var(--bg-subtle, #f9fafb)',
              fontSize: '0.8rem',
            }}
          >
            <MarkdownView markdown={privacyNotice.content} />
          </div>
        </div>
      ) : (
        <p role="alert" style={{ margin: '0.75rem 0', color: '#991b1b', fontSize: '0.82rem' }}>
          {t('communicationOptIn.privacyUnavailable')}
        </p>
      )}

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: '0.8rem', fontSize: '0.86rem', fontWeight: 600 }}>
        <input
          type="checkbox"
          checked={confirmed}
          disabled={disabled || !privacyNotice}
          onChange={event => onConfirmedChange(event.target.checked)}
        />
        {t('communicationOptIn.reviewedConfirmation')}
      </label>
    </section>
  );
}
