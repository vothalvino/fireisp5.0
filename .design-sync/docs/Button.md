---
category: Actions
---

# Button

Primary interactive control covering the four FireISP action tones.

- **variant**: `primary` (accent fill) · `secondary` (bordered) · `ghost` (text-only) · `danger` (destructive red). Default `primary`.
- **size**: `sm` · `md`. Default `md`.
- Accepts all native `<button>` props (`onClick`, `disabled`, `type`, …).

```tsx
<Button variant="danger" onClick={voidInvoice}>Void invoice</Button>
```
