---
category: Data
---

# Table

High-density data table in FireISP's flat industrial style. Muted uppercase headers; numeric columns use tabular mono. Shows an empty-state message when there are no rows.

- **columns**: `{ key, header, align?, numeric? }[]`. **rows**: `Record<string, ReactNode>[]` (cells can be any node, e.g. a `Badge`).
- **empty**: message shown when `rows` is empty. Wrap in a `Card` (`padding={false}`) for a bordered panel.

```tsx
<Table
  columns={[{ key: 'number', header: 'Invoice #' }, { key: 'total', header: 'Total', align: 'right', numeric: true }]}
  rows={[{ number: 'INV-000557', total: '$1,299.00' }]}
/>
```
