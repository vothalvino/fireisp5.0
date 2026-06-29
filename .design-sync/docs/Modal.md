---
category: Surfaces
---

# Modal

Focused dialog for confirmations and create/edit flows — a centered card over a dimmed overlay. Returns null when closed.

- **open**, **title**, **onClose** (required). **footer**: right-aligned action row (typically Cancel + a primary/danger Button).
- **inline**: render in-flow instead of a fixed full-screen overlay — for embedding in docs or constrained containers.

```tsx
<Modal open={open} title="Void invoice" onClose={close}
  footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="danger" onClick={confirm}>Void</Button></>}>
  Voiding this invoice marks it as $0 on the ledger.
</Modal>
```
