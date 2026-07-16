// =============================================================================
// FireISP 5.0 — Sidebar section icons ("Faro" nav)
// =============================================================================
// Nine hand-inlined stroke SVGs, one per nav section — no icon library.
// Child rows are text-only; these replace the per-item emoji that used to be
// embedded in the nav label strings.
// =============================================================================

import type { ReactElement } from 'react';
import type { SectionId } from '@/nav/routes';

const PATHS: Record<SectionId, ReactElement> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  clients: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c.7-3 2.9-4.5 5.5-4.5s4.8 1.5 5.5 4.5" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M16 14.7c2.3.2 4 1.6 4.6 4" />
    </>
  ),
  billing: (
    <>
      <path d="M6 3h12v18l-2-1.4L14 21l-2-1.4L10 21l-2-1.4L6 21z" />
      <path d="M9 8h6M9 12h6" />
    </>
  ),
  support: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.6" />
      <path d="M5.7 5.7l3.7 3.7M14.6 14.6l3.7 3.7M18.3 5.7l-3.7 3.7M9.4 14.6l-3.7 3.7" />
    </>
  ),
  fieldops: (
    <path d="M14.5 6.5a4.5 4.5 0 0 0-6 5.7L3 17.7V21h3.3l5.5-5.5a4.5 4.5 0 0 0 5.7-6L14 13l-3-3z" />
  ),
  network: (
    <>
      <path d="M4 12.5a11 11 0 0 1 16 0" />
      <path d="M7.5 15.8a6.5 6.5 0 0 1 9 0" />
      <circle cx="12" cy="19" r="1.4" />
    </>
  ),
  inventory: (
    <>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
    </>
  ),
  compliance: (
    <>
      <path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" />
      <path d="M9 12l2 2 4-4.5" />
    </>
  ),
  admin: (
    <>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </>
  ),
};

export function SectionIcon({ id }: { id: SectionId }) {
  return (
    <svg
      className="nav-sec-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[id]}
    </svg>
  );
}
