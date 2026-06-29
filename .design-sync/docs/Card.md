---
category: Surfaces
---

# Card

Surface panel — the primary grouping primitive in FireISP's flat UI. White background, 1px border, 8px radius, no shadow.

- **title**: optional left-aligned header title. **actions**: optional right-aligned header node (e.g. a Button).
- **padding**: standard body padding; set `false` for full-bleed content like a `Table`.

```tsx
<Card title="Account balance" actions={<Button size="sm">Record Payment</Button>}>
  <strong>$1,648.00</strong>
</Card>
```
