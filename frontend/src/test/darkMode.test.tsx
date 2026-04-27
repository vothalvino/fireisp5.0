// =============================================================================
// FireISP 5.0 — DarkModeContext tests
// =============================================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DarkModeProvider, useDarkMode } from '@/auth/DarkModeContext';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ThemeDisplay() {
  const { theme, effectiveTheme, toggleTheme, setTheme } = useDarkMode();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="effective">{effectiveTheme}</span>
      <button onClick={toggleTheme} data-testid="toggle">toggle</button>
      <button onClick={() => setTheme('dark')} data-testid="set-dark">dark</button>
      <button onClick={() => setTheme('light')} data-testid="set-light">light</button>
      <button onClick={() => setTheme('system')} data-testid="set-system">system</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DarkModeContext', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    // Default system preference = light in jsdom
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      media: '(prefers-color-scheme: dark)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList);
  });

  it('defaults to system theme (light in jsdom)', () => {
    render(<DarkModeProvider><ThemeDisplay /></DarkModeProvider>);
    expect(screen.getByTestId('theme').textContent).toBe('system');
    expect(screen.getByTestId('effective').textContent).toBe('light');
  });

  it('applies data-theme attribute on mount', () => {
    render(<DarkModeProvider><ThemeDisplay /></DarkModeProvider>);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('toggleTheme switches from light to dark', async () => {
    render(<DarkModeProvider><ThemeDisplay /></DarkModeProvider>);
    await userEvent.click(screen.getByTestId('toggle'));
    expect(screen.getByTestId('effective').textContent).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('toggleTheme switches from dark back to light', async () => {
    render(<DarkModeProvider><ThemeDisplay /></DarkModeProvider>);
    await userEvent.click(screen.getByTestId('toggle'));
    await userEvent.click(screen.getByTestId('toggle'));
    expect(screen.getByTestId('effective').textContent).toBe('light');
  });

  it('setTheme("dark") sets theme and persists to localStorage', async () => {
    render(<DarkModeProvider><ThemeDisplay /></DarkModeProvider>);
    await userEvent.click(screen.getByTestId('set-dark'));
    expect(localStorage.getItem('fireisp_theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('setTheme("light") sets theme and persists to localStorage', async () => {
    render(<DarkModeProvider><ThemeDisplay /></DarkModeProvider>);
    await userEvent.click(screen.getByTestId('set-dark'));
    await userEvent.click(screen.getByTestId('set-light'));
    expect(localStorage.getItem('fireisp_theme')).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('reads persisted theme from localStorage on mount', () => {
    localStorage.setItem('fireisp_theme', 'dark');
    render(<DarkModeProvider><ThemeDisplay /></DarkModeProvider>);
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('setTheme("system") resolves to system preference', async () => {
    localStorage.setItem('fireisp_theme', 'dark');
    render(<DarkModeProvider><ThemeDisplay /></DarkModeProvider>);
    await userEvent.click(screen.getByTestId('set-system'));
    expect(screen.getByTestId('theme').textContent).toBe('system');
    // jsdom system = light
    expect(screen.getByTestId('effective').textContent).toBe('light');
  });

  it('throws when useDarkMode used outside provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<ThemeDisplay />)).toThrow('useDarkMode must be used within DarkModeProvider');
    spy.mockRestore();
  });
});
