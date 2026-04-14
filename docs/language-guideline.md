# Language & Localization Guideline

## Documentation

All documentation (README, markdown files in `docs/`, code comments, commit messages, PR descriptions) **must be written in English**.

**Exception — Spanish domain terms:** Because FireISP was built for the Mexican ISP market, certain regulatory and fiscal terms that originate from Mexican law or the SAT (Servicio de Administración Tributaria) may remain in Spanish when no clear English equivalent exists or when the Spanish term is the industry-standard reference. Examples include *factura pública*, *CFDI*, *Carta de Adhesión*, *régimen fiscal*, *Complemento de Pago*, and SAT catalog names (`c_FormaPago`, `c_UsoCFDI`, etc.). When a Spanish term is used, provide a brief English explanation on first mention so readers unfamiliar with the term can follow along.

## User Interface (UI)

The UI **must be fully translated** into the following three languages:

| Code    | Language              |
|---------|-----------------------|
| `en`    | English               |
| `es`    | Spanish               |
| `pt-BR` | Brazilian Portuguese  |

All user-facing text — labels, buttons, menus, error messages, notifications, PDF documents, and email templates — must have complete translations in every supported locale.

**No other languages should be added at this time.** If a new locale is needed in the future, this guideline should be updated first.

### Easy language switching

The locale system must allow users (or administrators) to switch the active language without code changes. The current implementation uses JSON locale files in `src/locales/` and a `t()` helper from `src/utils/i18n.js`; any future refactoring should preserve or improve this ease of switching.

## Implementation

Agents and contributors are free to decide *when and how* to implement or improve localization coverage, as long as the end result satisfies the rules above. There is no mandated framework or library — choose whatever fits best at the time of implementation.
