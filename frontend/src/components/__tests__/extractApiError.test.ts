// =============================================================================
// FireISP 5.0 — API errors never render raw English to a translated operator
// =============================================================================
// 93 call sites across 36 files passed English literals like
// 'Failed to load invoices' as the fallback. Whenever the server returned a
// bare status with no message, a Spanish-speaking operator got English
// mid-flow — the same defect as the "Loading..." sweep, on the error path.
//
// j47's decision: the server's message when it sends one, otherwise ONE
// translated generic. No per-page wording, and no ~180 new translation keys.
// =============================================================================
import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import i18n from '@/i18n';
import { extractApiError } from '@/components/ClientFormModal';

beforeAll(async () => {
  if (!i18n.isInitialized) await i18n.init();
});

describe('the server message always wins', () => {
  it('uses error.message from the API envelope', () => {
    expect(extractApiError({ error: { message: 'Folio 12 ya está timbrado' } }, 'Failed to X'))
      .toBe('Folio 12 ya está timbrado');
  });

  it('falls through to a bare .message', () => {
    expect(extractApiError({ message: 'network down' }, 'Failed to X')).toBe('network down');
  });

  it('prefers the server message over the generic, because it says WHY', () => {
    const out = extractApiError({ error: { message: 'CFDI_STAMPED' } }, 'Failed to X');
    expect(out).toBe('CFDI_STAMPED');
    expect(out).not.toMatch(/wrong|Failed to X/);
  });
});

describe('with no server message, the operator sees their own language', () => {
  it('does not render the English fallback the call site passed', async () => {
    await i18n.changeLanguage('es');
    const out = extractApiError({}, 'Failed to load invoices');
    expect(out).not.toBe('Failed to load invoices');
    expect(out).toBe(i18n.t('common.error'));
  });

  it('is genuinely Spanish, not the key or English', async () => {
    await i18n.changeLanguage('es');
    const out = extractApiError({}, 'Failed to load invoices');
    // Guards the two silent failures: an untranslated key reaching the UI, and
    // a locale that quietly falls back to English.
    expect(out).not.toBe('common.error');
    expect(out).not.toMatch(/Something went wrong/);
  });

  it('works for pt-BR too', async () => {
    await i18n.changeLanguage('pt-BR');
    expect(extractApiError({}, 'Failed to X')).toBe(i18n.t('common.error'));
  });

  it('still gives English to an English operator', async () => {
    await i18n.changeLanguage('en');
    expect(extractApiError({}, 'Failed to X')).toBe('Something went wrong');
  });
});

afterEach(() => vi.restoreAllMocks());

describe('degrading safely', () => {
  it('never shows a raw i18n key to an operator', async () => {
    await i18n.changeLanguage('es');
    for (const input of [{}, null, undefined, { error: {} }, { error: { message: '' } }]) {
      expect(extractApiError(input, 'Failed to X')).not.toMatch(/^common\./);
    }
  });

  it('uses the English fallback when the KEY ITSELF is missing', async () => {
    // i18next returns the key verbatim when a translation is absent, so a
    // missing `common.error` would render the literal string "common.error" to
    // an operator. Simulated rather than waited for: it only happens if someone
    // deletes the key from a locale, which no other test would notice.
    await i18n.changeLanguage('es');
    const spy = vi.spyOn(i18n, 't').mockReturnValue('common.error' as never);
    expect(extractApiError({}, 'Failed to load invoices')).toBe('Failed to load invoices');
    spy.mockRestore();
  });

  it('handles a null/undefined error object without throwing', () => {
    expect(() => extractApiError(null, 'Failed to X')).not.toThrow();
    expect(() => extractApiError(undefined, 'Failed to X')).not.toThrow();
  });
});
