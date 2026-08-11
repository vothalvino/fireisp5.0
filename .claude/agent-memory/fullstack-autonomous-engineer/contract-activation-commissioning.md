# Contract activation and bounded commissioning

Migration 450 makes first activation a guided, evidence-backed lifecycle instead of a generic contract status edit.

## Canonical flow

- A newly created contract stays `pending`. Operators use `GET /contracts/:id/activation`, `POST /contracts/:id/activation/prepare`, then `POST /contracts/:id/activate` from the contract detail page.
- Preparation owns one `new_install` service order and its installation work order. Commissioning evidence is accepted only from that exact work order, for its assigned technician (or a permission-based `contracts.update` supervisor), and only while the service order is in process.
- Preparation is idempotent recovery as well as creation: a cancelled/deleted visit, or a historical completed visit that predates bound speed/acceptance evidence, is replaced with a fresh commissioning work order from ContractDetail.
- `speed_tests.work_order_id` distinguishes trusted commissioning evidence from generic SLA/client speed-test rows. Generic speed-test CRUD must not create, edit, delete, or restore bound rows.
- Work-order acceptance and the bound speed result must exist before activation. Mexican organizations must publish at least one reviewed `activation_contract` template before dispatch and must sign every currently-active exact template ID; `organization_locale = 'global'` skips Mexican legal documents entirely.
- Active or instantiated legal-template content is immutable. Revised terms use a new template ID, and an older frozen signature never satisfies that new version. Active arrival-authorization template IDs are signed before the visit crosses into `in_progress`; later publication does not retroactively strand a visit already under way.
- Final activation is centralized in the lifecycle service. Generic contract updates, automation, service-order shortcuts, renew/unsuspend of never-activated records, and network push endpoints must not bypass it.

## Bounded PPPoE test window

- `POST /work-orders/:id/test-window/start` opens a configurable, non-extendable window. RouterOS local PPP secrets are removed first because they do not carry a safe per-secret time bound; commissioning authenticates through RADIUS.
- Embedded RADIUS checks the contract expiry and returns `Session-Timeout`. Standard FreeRADIUS SQL rows carry both `Expiration` and `Session-Timeout`.
- `POST /work-orders/:id/test-window/complete` records the work-order-bound technician result and immediately disables authentication. `end` is a broad safety action; recording evidence additionally requires `speed_tests.create`.
- `contracts.test_window_cleanup_pending` is durable external-cleanup state. Activation is blocked while it is set, and the fair sweep retries RouterOS deletion and live-session disconnect after cancellation, type changes, or soft deletion. UI copy must say shutdown is pending—not claim the line is off—until cleanup is confirmed.
- Legacy pending PPPoE contracts are fail-closed even when they predate test-window markers: migration disables RADIUS/FreeRADIUS state, materialized NAS credentials get a durable cleanup marker with a NULL expiry, and cancellation/reset removes every linked RouterOS secret before cleanup is considered confirmed.
- Static and dual-IP contracts use `POST /work-orders/:id/commissioning-test`; the UI must truthfully require manual line shutoff rather than claim automatic shutdown.

## Durable activation state

- `contracts.first_activated_at` records the first legitimate activation and grandfathers legacy active/suspended/expired/terminated records during the first migration run. Ambiguous legacy `cancelled` rows stay NULL and re-enter commissioning fail-closed.
- Renew/unsuspend may return a previously activated subscriber directly to active. A never-activated cancelled/suspended record returns to `pending` with `activation_required: true` and follows commissioning.
- Bulk subscriber import is the explicit historical-live exception: it stamps `first_activated_at` and must bring RADIUS/FreeRADIUS online consistently.
- Direct RouterOS restoration after permanent activation is best effort. `network_retry_available` and `POST /contracts/:id/activation/retry-network` provide operator recovery without replaying billing or lifecycle effects.

## Permissions and UI

- Final activation requires `contracts.update`; invoice creation additionally requires `invoices.create`.
- A commissioning assignee requires effective `work_orders.view`, `work_orders.update`, and `speed_tests.create`. Starting/recording additionally requires either assignment to that technician or effective `contracts.update` supervision. Ending a window remains broadly available as a safety operation.
- Cancelling a `new_install` service order also requires `contracts.update`, because it cancels the linked pending contract; non-install order cancellation remains a `service_orders.update` operation.
- Mexican document metadata/actions respect `signed_documents.view` and `signed_documents.sign`. Global organizations must not receive or display Mexican legal metadata or CFDI flags.
- Activation projections redact service orders, work orders, speed measurements, and legal-document metadata independently by their view permissions; contract-only viewers receive boolean readiness flags instead.
- Contract creation navigates to `/contracts/:id`; status is not editable in the generic contract form.
