// =============================================================================
// FireISP 5.0 — Vitest global test setup
// =============================================================================
import '@testing-library/jest-dom';
import { toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);
