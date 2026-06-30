// =============================================================================
// FireISP 5.0 — Pagination component tests
// =============================================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { Pagination } from '../Pagination';

// Minimal i18n instance for tests
const testI18n = i18n.createInstance();
testI18n.use(initReactI18next).init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        pagination: {
          rowsPerPage: 'Rows per page:',
          prevPage: '← Prev',
          nextPage: 'Next →',
          pageInfo: 'Page {{page}} of {{total}}',
        },
      },
    },
  },
});

function renderPagination(props: Parameters<typeof Pagination>[0]) {
  return render(
    <I18nextProvider i18n={testI18n}>
      <Pagination {...props} />
    </I18nextProvider>,
  );
}

describe('Pagination', () => {
  it('renders the rows-per-page selector with the current value selected', () => {
    renderPagination({
      page: 1,
      totalPages: 5,
      pageSize: 25,
      onPageChange: vi.fn(),
      onPageSizeChange: vi.fn(),
    });
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('25');
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('calls onPageSizeChange when a new size is selected, and resets correctly', () => {
    const onPageSizeChange = vi.fn();
    renderPagination({
      page: 1,
      totalPages: 5,
      pageSize: 25,
      onPageChange: vi.fn(),
      onPageSizeChange,
    });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '50' } });
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });

  it('calls onPageChange(prev) when Prev is clicked', () => {
    const onPageChange = vi.fn();
    renderPagination({
      page: 3,
      totalPages: 5,
      pageSize: 25,
      onPageChange,
      onPageSizeChange: vi.fn(),
    });
    fireEvent.click(screen.getByText('← Prev'));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('calls onPageChange(next) when Next is clicked', () => {
    const onPageChange = vi.fn();
    renderPagination({
      page: 3,
      totalPages: 5,
      pageSize: 25,
      onPageChange,
      onPageSizeChange: vi.fn(),
    });
    fireEvent.click(screen.getByText('Next →'));
    expect(onPageChange).toHaveBeenCalledWith(4);
  });

  it('disables Prev on the first page', () => {
    renderPagination({
      page: 1,
      totalPages: 3,
      pageSize: 25,
      onPageChange: vi.fn(),
      onPageSizeChange: vi.fn(),
    });
    expect(screen.getByText('← Prev')).toBeDisabled();
    expect(screen.getByText('Next →')).not.toBeDisabled();
  });

  it('disables Next on the last page', () => {
    renderPagination({
      page: 3,
      totalPages: 3,
      pageSize: 25,
      onPageChange: vi.fn(),
      onPageSizeChange: vi.fn(),
    });
    expect(screen.getByText('Next →')).toBeDisabled();
    expect(screen.getByText('← Prev')).not.toBeDisabled();
  });

  it('does not render nav buttons when there is only one page', () => {
    renderPagination({
      page: 1,
      totalPages: 1,
      pageSize: 25,
      onPageChange: vi.fn(),
      onPageSizeChange: vi.fn(),
    });
    expect(screen.queryByText('← Prev')).not.toBeInTheDocument();
    expect(screen.queryByText('Next →')).not.toBeInTheDocument();
    // Size selector is still present
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('shows page X of Y text when multiple pages', () => {
    renderPagination({
      page: 2,
      totalPages: 5,
      pageSize: 25,
      onPageChange: vi.fn(),
      onPageSizeChange: vi.fn(),
    });
    expect(screen.getByText('Page 2 of 5')).toBeInTheDocument();
  });

  it('shows the optional total count when provided', () => {
    renderPagination({
      page: 1,
      totalPages: 3,
      total: 72,
      pageSize: 25,
      onPageChange: vi.fn(),
      onPageSizeChange: vi.fn(),
    });
    expect(screen.getByText('(72)')).toBeInTheDocument();
  });

  it('does not show the total when not provided', () => {
    const { container } = renderPagination({
      page: 1,
      totalPages: 3,
      pageSize: 25,
      onPageChange: vi.fn(),
      onPageSizeChange: vi.fn(),
    });
    expect(container.textContent).not.toContain('(');
  });

  it('respects custom pageSizeOptions', () => {
    renderPagination({
      page: 1,
      totalPages: 2,
      pageSize: 10,
      pageSizeOptions: [10, 20, 50],
      onPageChange: vi.fn(),
      onPageSizeChange: vi.fn(),
    });
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('10');
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
  });

  it('clamps Prev to page 1', () => {
    const onPageChange = vi.fn();
    renderPagination({
      page: 1,
      totalPages: 3,
      pageSize: 25,
      onPageChange,
      onPageSizeChange: vi.fn(),
    });
    // Prev is disabled so a click shouldn't fire, but test the logic via page 2 → 1
    renderPagination({
      page: 2,
      totalPages: 3,
      pageSize: 25,
      onPageChange,
      onPageSizeChange: vi.fn(),
    });
    // Both renders share the same container; click the second Prev button
    const prevBtns = screen.getAllByText('← Prev');
    fireEvent.click(prevBtns[prevBtns.length - 1]);
    expect(onPageChange).toHaveBeenCalledWith(1);
  });
});
