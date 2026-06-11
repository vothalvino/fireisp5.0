---
name: env-setup
description: Node/pnpm/npm tool location and how to invoke them from PowerShell
metadata:
  type: reference
---

Node 24 and pnpm are installed at `C:\Users\votha\tools\node24\`. They are NOT on the default PATH.

Before running any `pnpm`, `npx`, or `npm` commands in PowerShell, set:
```powershell
$env:PATH = "C:\Users\votha\tools\node24;$env:PATH"
```

Then `cd` to the project root and run commands normally, e.g.:
- `pnpm lint` — ESLint on `src/`
- `npx jest tests/<file>.test.js --forceExit` — single test file
- `pnpm openapi` — regenerate `docs/openapi.json`
- `pnpm spec:check` — verify no spec drift

**Why:** The shell environment is reset between commands so the PATH must be set each time in a new PowerShell session.
