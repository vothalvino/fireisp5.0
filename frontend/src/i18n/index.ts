// =============================================================================
// FireISP 5.0 — i18n (internationalisation) configuration
// =============================================================================
// Supported locales: en (default), es (Spanish MX), pt-BR (Portuguese BR).
// Language detection order: cookie → localStorage → browser language header.
// Falls back to 'en' when the detected language has no catalogue.
// =============================================================================

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en.json';
import es from './locales/es.json';
import ptBR from './locales/pt-BR.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en:    { translation: en },
      es:    { translation: es },
      'pt-BR': { translation: ptBR },
    },
    fallbackLng: 'en',
    supportedLngs: ['en', 'es', 'pt-BR'],
    interpolation: {
      // React already escapes values
      escapeValue: false,
    },
    detection: {
      order: ['cookie', 'localStorage', 'navigator'],
      caches: ['cookie', 'localStorage'],
      cookieMinutes: 525600, // 1 year
    },
  });

export default i18n;
