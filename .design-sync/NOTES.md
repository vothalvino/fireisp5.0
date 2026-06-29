# design-sync notes — @fireisp/ui

Repo-specific gotchas for future syncs.

## Setup
- The synced package is `frontend/ui-kit/` (`@fireisp/ui`) — a **new** component library
  extracted from the FireISP app's design tokens (`frontend/src/index.css`). It is NOT the app.
- Build it before the converter: `cd frontend/ui-kit && npm run build` (tsup → `dist/index.mjs`,
  `dist/index.d.ts`, `dist/index.css`). Converter entry: `--entry frontend/ui-kit/dist/index.mjs`,
  `--node-modules frontend/ui-kit/node_modules`.
- Tokens are the cssEntry (`dist/index.css`). Components style via inline styles + `var(--token)`;
  no provider/context. Dark theme via `[data-theme="dark"]`.

## Fonts
- Inter + JetBrains Mono. The app self-hosts via `@fontsource`; the kit loads the same families
  via a Google Fonts `@import` at the top of `src/tokens.css`, so validate reports `[FONT_REMOTE]`
  (not `[FONT_MISSING]`). Designs load the real fonts at runtime.

## Known render warns / limitations
- **Modal preview title-bar clip**: the `Modal` is a `position: fixed` full-screen overlay. In the
  static preview card (cardMode `single`, viewport `720x560`) the centered dialog's **title bar
  crops at the top** — a capture artifact of fixed-positioned overlays, NOT a component bug. The
  live component renders the title fine; the `.d.ts`/`.prompt.md` document the `title` prop. Graded
  `good` deliberately. If a future sync wants a pixel-perfect card, render the dialog content in a
  relatively-positioned wrapper for the preview only.
- `Table` and `Card` use `cardMode: column` (wide/multi-row stories); `Modal` uses `single`.

## Re-sync risks (what can silently go stale)
- The kit's tokens are a **copy** of `frontend/src/index.css`. If the app's tokens change, re-copy
  them into `frontend/ui-kit/src/tokens.css` and rebuild, or the design system drifts from the app.
- Preview content (client names, invoice numbers, amounts) is illustrative FireISP data inlined in
  `.design-sync/previews/*.tsx` — safe, but update if the brand examples should change.
- Group is `general` for all 6 components (no per-component docs). To split into Actions/Forms/
  Feedback/Surfaces/Data, add `cfg.docsMap` stubs with `---\ncategory: <Group>\n---`.
- Render check needs Playwright + Chromium (installed under `.ds-sync/`); a fresh clone must
  reinstall them.
