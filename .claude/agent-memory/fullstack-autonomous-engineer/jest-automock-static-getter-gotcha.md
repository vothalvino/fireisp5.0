---
name: jest-automock-static-getter-gotcha
description: jest.mock('../src/models/X') automocks inherited BaseModel methods (findById, create, update...) but silently drops inherited static getters (fillable, tableName, hasOrgScope, softDelete) — reads back as undefined
metadata:
  type: feedback
---

`jest.mock('../src/models/SomeModel')` (bare automock, no factory) mocks every method Jest can see on the class — including ones only reachable via the `BaseModel` prototype chain, like `findById`/`findByIdIncludingDeleted`/`update`/`create`/`delete` — but it does **NOT** preserve `static get` accessor properties inherited from `BaseModel`: `fillable`, `tableName`, `hasOrgScope`, `softDelete`. Reading `MockedModel.fillable` under automock returns `undefined`. Verified empirically: `Object.getOwnPropertyDescriptor(MockedModel, 'fillable')` is also `undefined` — the automocked class doesn't have the property at all, own or inherited, because Jest's automocker builds a fresh mock class that doesn't actually extend `BaseModel`.

**Why this matters:** any route/service code that reads `Model.fillable` or `Model.tableName` directly — as opposed to just calling one of the model's own (properly-mocked) methods — will crash under a test file that automocks that model. This is a real pattern: `BaseModel.create()`/`.update()` build their INSERT/UPDATE by filtering the payload through `this.fillable` internally, and any hand-rolled route code that needs to replicate that filtering *outside* `BaseModel` (e.g. to run an INSERT on a specific transaction connection rather than the pool) has to reference `Model.fillable` directly, and will hit this.

**Fix, not a workaround:** plain assignment works — the mocked class has no blocking getter — so right after requiring the mocked model in the test file, restore the real values once at module scope:
```js
const Quote = require('../src/models/Quote');
Quote.fillable = ['organization_id', 'client_id', /* ...mirror the real model exactly... */];
Quote.tableName = 'quotes';
```
`jest.resetAllMocks()` in `beforeEach` does **not** clear plain non-mock-function properties, so a one-time top-level assignment persists correctly for every test in the file.

**How to apply:** whenever new route/service code reads `SomeModel.fillable`/`.tableName`/`.hasOrgScope`/`.softDelete` directly (not just calling `SomeModel.someMethod(...)`), check whether the test file automocks that model with a bare `jest.mock('../src/models/SomeModel')` — if so, add the restoration lines or the new code will throw in tests despite being correct in production. First hit: `src/routes/quotes.js`'s single-transaction auto-number INSERT (built by filtering `req.body` through `Quote.fillable`), fixed in `tests/routesCoverage.test.js`.
