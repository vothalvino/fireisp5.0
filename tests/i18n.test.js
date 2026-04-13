// =============================================================================
// FireISP 5.0 — i18n Tests
// =============================================================================

const path = require('path');

// Verify locale files exist before testing
const fs = require('fs');
const localesDir = path.resolve(__dirname, '../src/locales');

describe('i18n', () => {
  let i18n;

  beforeAll(() => {
    i18n = require('../src/utils/i18n');
  });

  describe('Locale files', () => {
    it('en.json exists and is valid JSON', () => {
      const filePath = path.join(localesDir, 'en.json');
      expect(fs.existsSync(filePath)).toBe(true);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      expect(data.errors).toBeDefined();
      expect(data.auth).toBeDefined();
      expect(data.billing).toBeDefined();
      expect(data.common).toBeDefined();
    });

    it('es.json exists and is valid JSON', () => {
      const filePath = path.join(localesDir, 'es.json');
      expect(fs.existsSync(filePath)).toBe(true);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      expect(data.errors).toBeDefined();
      expect(data.auth).toBeDefined();
      expect(data.billing).toBeDefined();
      expect(data.common).toBeDefined();
    });

    it('both locales have the same keys', () => {
      const en = JSON.parse(fs.readFileSync(path.join(localesDir, 'en.json'), 'utf8'));
      const es = JSON.parse(fs.readFileSync(path.join(localesDir, 'es.json'), 'utf8'));

      const flatKeys = (obj, prefix = '') => {
        const keys = [];
        for (const [k, v] of Object.entries(obj)) {
          const key = prefix ? `${prefix}.${k}` : k;
          if (typeof v === 'object' && v !== null) {
            keys.push(...flatKeys(v, key));
          } else {
            keys.push(key);
          }
        }
        return keys;
      };

      const enKeys = flatKeys(en).sort();
      const esKeys = flatKeys(es).sort();
      expect(enKeys).toEqual(esKeys);
    });
  });

  describe('t()', () => {
    it('translates a key in English', () => {
      expect(i18n.t('errors.not_found', 'en')).toBe('Resource not found');
    });

    it('translates a key in Spanish', () => {
      expect(i18n.t('errors.not_found', 'es')).toBe('Recurso no encontrado');
    });

    it('falls back to English for unknown locale', () => {
      expect(i18n.t('errors.not_found', 'fr')).toBe('Resource not found');
    });

    it('returns the key itself for unknown key', () => {
      expect(i18n.t('nonexistent.key', 'en')).toBe('nonexistent.key');
    });

    it('defaults to English when no locale specified', () => {
      expect(i18n.t('common.created')).toBe('Created successfully');
    });

    it('replaces {{var}} placeholders', () => {
      expect(i18n.t('billing.invoice_generated', 'en', { invoiceNumber: 'INV-001' }))
        .toBe('Invoice INV-001 generated successfully');
    });

    it('replaces {{var}} placeholders in Spanish', () => {
      expect(i18n.t('billing.invoice_generated', 'es', { invoiceNumber: 'INV-001' }))
        .toBe('Factura INV-001 generada exitosamente');
    });

    it('handles nested keys', () => {
      expect(i18n.t('suspension.warning', 'en'))
        .toBe('Your service may be suspended due to overdue balance');
      expect(i18n.t('suspension.warning', 'es'))
        .toBe('Su servicio puede ser suspendido por saldo vencido');
    });
  });

  describe('availableLocales()', () => {
    it('returns array with at least en and es', () => {
      const locales = i18n.availableLocales();
      expect(locales).toContain('en');
      expect(locales).toContain('es');
    });
  });
});
