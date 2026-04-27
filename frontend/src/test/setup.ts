// =============================================================================
// FireISP 5.0 — Vitest global test setup
// =============================================================================
import '@testing-library/jest-dom';
import { toHaveNoViolations } from 'jest-axe';
import '@/i18n';

expect.extend(toHaveNoViolations);
