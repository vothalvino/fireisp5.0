---
name: regex-escape-lint
description: ESLint no-useless-escape fires on `\-` inside character classes; workaround for MAC normalization
metadata:
  type: feedback
---

ESLint `no-useless-escape` fires on patterns like `/[:\-\.]/g` — the `\-` is unnecessary inside a character class unless it's between two chars that form a range.

**Why:** ESLint enforces no-useless-escape; `\-` is not needed in `[:\-.]` — a bare `-` at the start/end is literal.

**How to apply:** Split the replace into two calls or move `-` to the end/start without escaping:
```js
// Safe pattern for MAC normalization
mac.replace(/[:.]/g, '').replace(/-/g, '').toLowerCase()
```
