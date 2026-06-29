# FireISP UI (`@fireisp/ui`) — how to build with it

A small, flat, **industrial** component kit: borders over shadows, **exactly one accent**
(`--accent`, FireISP orange `#e25822`), high information density, a 4px spacing grid, Inter
for text and JetBrains Mono for numbers/IDs.

## Setup — no provider needed
Components style themselves from CSS **custom-property tokens** that ship in the bundle's
stylesheet (`styles.css` → tokens). Just render them — there is **no** ThemeProvider/context
to wrap. Dark mode is opt-in: set `data-theme="dark"` on any ancestor (e.g. `<html>`) and every
token flips; light is the default.

## Styling idiom — token variables, inline styles
This kit is a **token system**, not a utility-class or prop-theme system. There are no CSS
classes to memorize and no `sx`/style props on the components. For your **own** layout glue
(wrappers, grids, spacing), use inline `style={{ … }}` with `var(--token)` values — never
hard-coded hexes or arbitrary px when a token exists. The core vocabulary:

- **Accent (one only):** `--accent`, `--accent-hover`, `--accent-active`, `--accent-fg`, `--accent-soft`
- **Surfaces:** `--bg-card` (panels), `--bg-subtle` / `--bg-muted`, `--bg-page`
- **Text:** `--text-primary`, `--text-secondary`, `--text-muted`
- **Borders:** `--border`, `--border-strong`, `--border-subtle`; focus: `--focus-ring`
- **Status:** `--success`/`--success-soft`, `--danger`/`--danger-soft`, `--warning`/`--warning-soft`; neutral chip `--badge-bg`/`--badge-fg`
- **Inputs:** `--input-bg`, `--input-border`
- **Spacing (4px grid):** `--sp-1`…`--sp-6` (4/8/12/16/24/32px)
- **Radius (≤8px):** `--radius-sm`, `--radius-md`, `--radius-lg`
- **Type:** `--font-sans` (Inter, UI), `--font-mono` (JetBrains Mono, numbers/IDs/money)

Money, IDs, and counts use `--font-mono` + `fontVariantNumeric: 'tabular-nums'`.

## Components
`Button` (variant: primary | secondary | ghost | danger; size: sm | md) · `Badge`
(tone: neutral | success | danger | warning | accent) · `Field` (labeled input with error/hint/
required) · `Modal` (open/title/onClose/footer — a centered dialog over a dimmed overlay) ·
`Table` (columns/rows, numeric columns get tabular mono) · `Card` (titled surface panel; set
`padding={false}` to wrap a full-bleed `Table`). Each component's `.d.ts` is the API contract and
its `.prompt.md` the usage reference — read those before composing.

## Idiomatic snippet
```tsx
import { Card, Table, Badge, Button } from '@fireisp/ui';

<Card
  title="Recent invoices"
  actions={<Button size="sm">Record Payment</Button>}
  padding={false}
>
  <Table
    columns={[
      { key: 'number', header: 'Invoice #' },
      { key: 'total',  header: 'Total',  align: 'right', numeric: true },
      { key: 'status', header: 'Status', align: 'right' },
    ]}
    rows={[
      { number: 'INV-000557', total: '$1,299.00', status: <Badge tone="success">Paid</Badge> },
      { number: 'INV-000558', total: '$349.00',   status: <Badge tone="danger">Overdue</Badge> },
    ]}
  />
</Card>
```
Lay out around components with token-driven inline styles, e.g.
`<div style={{ display: 'grid', gap: 'var(--sp-4)' }}>`.
