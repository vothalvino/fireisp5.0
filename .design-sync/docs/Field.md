---
category: Forms
---

# Field

Labeled form field wrapping a native `<input>` — handles label, focus ring, error, hint, required marker, and disabled styling.

- **label**, **value**, **onChange** (required).
- **error**: red border + message below. **hint**: muted help text (hidden when `error` is set).
- **required**: appends an asterisk. **type**, **placeholder**, **disabled**, **id** as usual.

```tsx
<Field label="Email" value={email} onChange={onChange} error={emailError} required />
```
