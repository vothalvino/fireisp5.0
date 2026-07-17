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
- **Modal preview** (title-clip — RESOLVED): the `Modal` defaults to a `position: fixed` overlay,
  which clipped the title bar in the static preview card. The component now has an **`inline`** prop
  (renders in-flow, no fixed overlay / no dim) for embedding in docs/previews; the Modal preview uses
  `<Modal inline>`, so the full dialog (title + body + footer) renders in the card.
- `Modal`, `Table`, and `Card` all use `cardMode: column` (wide / multi-row stories).

## Re-sync risks (what can silently go stale)
- The kit's tokens are a **copy** of `frontend/src/index.css`. If the app's tokens change, re-copy
  them into `frontend/ui-kit/src/tokens.css` and rebuild, or the design system drifts from the app.
- Preview content (client names, invoice numbers, amounts) is illustrative FireISP data inlined in
  `.design-sync/previews/*.tsx` — safe, but update if the brand examples should change.
- Groups come from `cfg.docsDir` (`../../.design-sync/docs`): each `<Name>.md`'s frontmatter
  `category` sets the section (Actions / Forms / Feedback / Surfaces / Data) and doubles as the
  component's `.prompt.md`. Add or re-group a component by adding/editing its doc there.
- Render check needs Playwright + Chromium (installed under `.ds-sync/`); a fresh clone must
  reinstall them. **Pin the Playwright version to the cached chromium build**: this machine's
  `~/.cache/ms-playwright/` had `chromium-1217`, which is pinned by **playwright@1.59.0** (verify
  a build↔version match via `packages/playwright-core/browsers.json` on the playwright GitHub tag;
  the repo/cache regularly disagree). Installing a mismatched version fails with
  `browserType.launch: Executable doesn't exist`.

## Re-sync history
- 2026-07-16 re-sync (from terminal, off VS Code): ui-kit source unchanged since #331, so the
  driver verdict was all-6 `unchanged`, `upload.any=false` — a true no-op. Conventions header
  re-validated clean against the fresh build (every token/component/prop still resolves). Nothing
  uploaded, nothing committed. If a future re-sync reports `upload.any=false` and the header
  validates, that's the expected steady state — stop there.
