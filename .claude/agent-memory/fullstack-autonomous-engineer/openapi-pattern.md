---
name: openapi-pattern
description: FireISP OpenAPI spec is generated STATICALLY by hand in src/utils/openapi.js — not scanned from JSDoc. New paths must be added manually to generateSpec(). Frontend API types use `as never` casts on entire options objects when generated types have `query?: never` or narrow path types. components.schemas is auto-derived from EVERY file in src/middleware/schemas/, independent of whether any path references it.
metadata:
  type: project
---

## Static OpenAPI generation

The spec lives in `src/utils/openapi.js` inside `generateSpec()`. It uses a `crudPaths(resource, tag, schemaName)` helper for standard CRUD, then adds custom paths inline. Running `pnpm openapi` writes `docs/openapi.json`; `pnpm spec:check` verifies drift.

**Why:** The project chose static generation for full control over schema details. Auto-scanning was never wired up.

**How to apply:** Every new route file MUST be accompanied by path additions in `src/utils/openapi.js`. Always run `pnpm spec:check` after to confirm 0 drift.

## Frontend `as never` pattern for API calls

When `openapi-typescript` generates `query?: never` or `path?: never` for an operation (because the OpenAPI spec uses generic `jsonBody()` helpers that don't produce typed schemas), TypeScript rejects any options object. Fix: cast the **entire options argument** as never:

```ts
// correct
const res = await api.GET('/some-path' as never, { params: { path: { id } as never } } as never);

// also correct for body calls
const res = await api.POST('/some-path' as never, { body: data as never } as never);
```

The inner `as never` on `path:` / `query:` is optional when the outer object is already cast, but harmless.

**Why:** openapi-fetch validates the options shape against the operation's parameter types. When parameters are `never`, passing anything fails TS.

**How to apply:** Any new page making API calls to paths added via `crudPaths()` or custom paths with `jsonBody()` responses will need this pattern until the OpenAPI spec is updated with typed request/response schemas.

## `components.schemas` is auto-derived from every validation schema FILE, not from what paths actually reference

`generateSpec()` (top of `src/utils/openapi.js`) walks every file in `src/middleware/schemas/`, and for each exported object converts it to an OpenAPI component schema keyed `${filename}_${exportKey}` (e.g. `devices_createDevice`). This happens **unconditionally** — it does not check whether any path's `requestBody`/`responses` actually `$ref`s that schema. Most CRUD paths use the generic `crudPaths()` helper whose `jsonBody()`/`r200()`/`r201()` all emit bare `{ type: 'object' }` (no `$ref` at all), which can make it *look* like editing a `src/middleware/schemas/*.js` file has no OpenAPI-visible effect.

**Why this matters:** `pnpm spec:check` (`src/scripts/spec-drift.js`) does a `JSON.stringify` deep-equal on the whole `components` section, not just on schemas that paths reference. Adding/removing a field from ANY file in `src/middleware/schemas/` changes `components.schemas` and fails `spec:check` until `pnpm run openapi` is re-run — even for a resource (like `/devices`) whose paths never `$ref` that schema and whose request bodies stay untyped either way. A same-day fix spec for this exact case (`devices.client_id` added to `createDevice`/`updateDevice`) asserted "No OpenAPI change needed" reasoning only from the path-body-is-untyped angle — that was wrong; `pnpm run openapi` was required and changed exactly `components.schemas.devices_{createDevice,updateDevice,patchDevice}.properties.client_id` (12 lines in `docs/openapi.json`).

**How to apply:** Any edit to a `src/middleware/schemas/*.js` file — even one whose route only ever emits generic `{type:'object'}` bodies — requires `pnpm run openapi` + `pnpm run spec:check` before calling the change done. Don't reason from "does any path reference this schema" to "do I need to regenerate" — always regenerate and let `spec:check` be the actual arbiter.
