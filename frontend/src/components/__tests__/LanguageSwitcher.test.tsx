// =============================================================================
// FireISP 5.0 — LanguageSwitcher tests
// =============================================================================
// Verifies the switcher renders the supported languages, changing it updates
// the active i18n language, and a detected regional/base code (e.g. "en-US",
// "pt") normalises to a rendered option so the controlled <select> stays valid.
// =============================================================================
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { LanguageSwitcher } from '../LanguageSwitcher';
import i18n from '@/i18n';

afterEach(async () => {
  // Restore the default language so tests don't leak state into each other.
  await act(async () => { await i18n.changeLanguage('en'); });
});

describe('LanguageSwitcher', () => {
  it('renders the supported languages as options', () => {
    render(<LanguageSwitcher />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    const values = Array.from(select.options).map(o => o.value);
    expect(values).toEqual(['en', 'es', 'pt-BR']);
    // Endonyms, not translated.
    expect(screen.getByRole('option', { name: 'English' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Español' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Português' })).toBeInTheDocument();
  });

  it('reflects the active language and switches on change', async () => {
    render(<LanguageSwitcher />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('en');

    fireEvent.change(select, { target: { value: 'es' } });

    await waitFor(() => expect(i18n.language).toBe('es'));
    expect(select.value).toBe('es');
  });

  it('normalises a regional code to a supported option', async () => {
    // A detected "en-US" must map to the "en" option, not produce a value with
    // no matching <option> (which would break the controlled select).
    await act(async () => { await i18n.changeLanguage('en-US'); });
    render(<LanguageSwitcher />);
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('en');
  });

  it('normalises a base code to its regional option', async () => {
    // A detected base "pt" must map to the "pt-BR" option.
    await act(async () => { await i18n.changeLanguage('pt'); });
    render(<LanguageSwitcher />);
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('pt-BR');
  });
});
