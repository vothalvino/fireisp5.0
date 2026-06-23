// =============================================================================
// FireISP 5.0 — Language Switcher
// =============================================================================
// Small <select> for changing the UI language. i18next's LanguageDetector is
// configured with caches: ['cookie', 'localStorage'], so calling
// i18n.changeLanguage() persists the choice automatically — no extra wiring.
//
// Two visual variants:
//   • "sidebar" — dark styling for the admin Layout sidebar (matches orgSelect)
//   • "bar"     — neutral styling for light surfaces (portal header, login card)
// =============================================================================

import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

// Endonyms (each language in its own name) — conventionally NOT translated.
const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'pt-BR', label: 'Português' },
] as const;

interface LanguageSwitcherProps {
  variant?: 'sidebar' | 'bar';
  style?: CSSProperties;
}

export function LanguageSwitcher({ variant = 'bar', style }: LanguageSwitcherProps) {
  const { i18n, t } = useTranslation();

  // Normalise the detected language to a supported option so the <select>
  // value always matches an <option> (avoids React's controlled-value warning
  // when the detector yields a regional variant like "en-US" or a base "pt").
  const active = i18n.language ?? 'en';
  const current =
    LANGUAGES.find(l => l.code === active) ??
    LANGUAGES.find(l => active.split('-')[0] === l.code.split('-')[0]) ??
    LANGUAGES[0];

  return (
    <select
      aria-label={t('languageSwitcher.label')}
      title={t('languageSwitcher.label')}
      value={current.code}
      onChange={e => { void i18n.changeLanguage(e.target.value); }}
      style={{ ...(variant === 'sidebar' ? sidebarStyle : barStyle), ...style }}
    >
      {LANGUAGES.map(l => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  );
}

const sidebarStyle: CSSProperties = {
  background: 'var(--sidebar-hover-bg)',
  color: '#fff',
  border: '1px solid var(--sidebar-border)',
  borderRadius: 4,
  padding: '4px 6px',
  fontSize: '0.8rem',
  cursor: 'pointer',
  // The sidebar is always dark; hint the native dropdown popup to render dark
  // too so the white option text stays legible (light theme / Chrome-Windows).
  colorScheme: 'dark',
};

const barStyle: CSSProperties = {
  background: 'var(--bg-card)',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border-strong)',
  borderRadius: 4,
  padding: '0.35rem 0.5rem',
  fontSize: '0.85rem',
  cursor: 'pointer',
};
