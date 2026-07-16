# No-redeploy live verification of frontend PRs (vite proxy → demo)

**Learned:** 2026-07-16 overnight campaign (PRs #431/#432). The demo server cannot be redeployed by the agent (no SSH), but frontend-only PRs can still be FULLY live-verified pre-merge against the real production backend.

**Recipe:**
1. From the PR worktree: `VITE_API_URL=https://demo.opentrk.com.mx node_modules/.bin/vite --port 5173` — `frontend/vite.config.ts` proxies `/api`, `/healthz`, `/health` with `changeOrigin: true`.
2. Auth works: the backend's `Secure` cookies are accepted on `http://localhost` (browsers treat localhost as a trustworthy origin); CSRF is same-origin through the proxy.
3. Drive with Playwright from `e2e/node_modules` (`chromium` lives in `~/.cache/ms-playwright`); a standalone config with `testDir` pointed at a scratch dir works — no need to touch `e2e/tests/`.
4. Only valid when the PR needs **zero backend changes** — the demo runs `main`, so new endpoints/migrations won't exist. Backend PRs still need a redeploy to walk.

**Playwright gotchas for this app (cost real debugging time):**
- The admin DR-drill modal pops **asynchronously** after login and swallows all clicks (`aria-hidden` backdrop). A one-shot dismiss races it — use `page.addLocatorHandler(page.getByRole('button', { name: /acknowledge & dismiss|reconocer y descartar/i }), h => h.click())` so it is dismissed whenever it appears.
- Org switcher: `page.getByLabel('Active organization')`. Never `select.first()` — the workspace preset select comes first in the sidebar.
- Waiting for a `<option>`: options inside a closed `<select>` are "hidden" to Playwright — `waitForSelector('option[value="9"]', { state: 'attached' })`.
- Async-loaded `<select>` options (e.g. `/work-orders/assignable-users` fetched with `enabled: open`): wait for a concrete option before filling, or the form submits unassigned.

**Shell gotcha:** `pkill -f 'vite --port 5173'` matches its own invoking shell and kills the compound command (exit 144). Use a self-escaping pattern like `pkill -f 'bin/[v]ite'`.
