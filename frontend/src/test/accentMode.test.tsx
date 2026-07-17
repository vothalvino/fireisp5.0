// =============================================================================
// FireISP 5.0 — AccentContext tests
// =============================================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccentProvider, useAccent } from '@/auth/AccentContext';

function AccentDisplay() {
  const { accent, toggleAccent, setAccent } = useAccent();
  return (
    <div>
      <span data-testid="accent">{accent}</span>
      <button onClick={toggleAccent} data-testid="toggle">toggle</button>
      <button onClick={() => setAccent('green')} data-testid="set-green">green</button>
      <button onClick={() => setAccent('orange')} data-testid="set-orange">orange</button>
    </div>
  );
}

describe('AccentContext', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-accent');
    vi.restoreAllMocks();
  });

  it('defaults to orange and stamps data-accent on <html>', () => {
    render(<AccentProvider><AccentDisplay /></AccentProvider>);
    expect(screen.getByTestId('accent').textContent).toBe('orange');
    expect(document.documentElement.getAttribute('data-accent')).toBe('orange');
  });

  it('toggles between orange and green', async () => {
    const user = userEvent.setup();
    render(<AccentProvider><AccentDisplay /></AccentProvider>);
    await user.click(screen.getByTestId('toggle'));
    expect(screen.getByTestId('accent').textContent).toBe('green');
    expect(document.documentElement.getAttribute('data-accent')).toBe('green');
    await user.click(screen.getByTestId('toggle'));
    expect(screen.getByTestId('accent').textContent).toBe('orange');
  });

  it('persists the choice to localStorage and restores it', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<AccentProvider><AccentDisplay /></AccentProvider>);
    await user.click(screen.getByTestId('set-green'));
    expect(localStorage.getItem('fireisp_accent')).toBe('green');
    unmount();

    render(<AccentProvider><AccentDisplay /></AccentProvider>);
    expect(screen.getByTestId('accent').textContent).toBe('green');
    expect(document.documentElement.getAttribute('data-accent')).toBe('green');
  });

  it('ignores an invalid stored value and falls back to orange', () => {
    localStorage.setItem('fireisp_accent', 'purple');
    render(<AccentProvider><AccentDisplay /></AccentProvider>);
    expect(screen.getByTestId('accent').textContent).toBe('orange');
  });

  it('throws when useAccent is used outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<AccentDisplay />)).toThrow(/must be used within AccentProvider/);
    spy.mockRestore();
  });
});
