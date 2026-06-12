---
name: section14-inventory-asset
description: Section 14 Inventory & Asset Management — migrations 305-307 complete; 6 new tables, 20 perms, 4 route files, 5-tab frontend page; next migration: 308
metadata:
  type: project
---

## Status: COMPLETE — branch 14-of-isp-platform-feature.md

### Database

- **305**: 6 new tables — `vendors`, `purchase_orders`, `purchase_order_items` (with GENERATED STORED total_cost), `assets` (serial#, barcode, warranty, depreciation, disposal), `asset_assignments` (customer/device/port history), `rma_requests`
- **306**: 20 permissions — `vendors.*` (4), `purchase_orders.*` (5 incl. receive), `assets.*` (7 incl. assign/dispose/scan), `rma.*` (4 incl. close)
- **307**: `inventory_low_stock_check` scheduled task (notification type, hourly)

### Post-run fix (orchestrator sweep finding)

Migration 307 seeded the task but NO `taskRunner.js` case existed — the hourly task was a silent no-op (4th half-workflow across sections). Fixed in commit 7aff639: `case 'inventory_low_stock_check'` → `handleInventoryLowStockCheck(organizationId)` calling `assetService.getLowStockItems`; NULL org passed through like `sla_breach_check`; dispatch tests added to tests/taskRunner.sla.test.js. RULE: every seeded scheduled task MUST get a taskRunner case + dispatch test in the same change.

### Backend files

- `src/services/assetService.js` — generateBarcode, calculateDepreciation (straight-line + declining-balance), getLowStockItems, findByBarcode, getStats
- `src/models/Vendor.js`, `PurchaseOrder.js` (getItems()), `Asset.js` (getAssignments(), getRmaRequests()), `RmaRequest.js`
- `src/middleware/schemas/vendors.js`, `purchaseOrders.js`, `assets.js`, `rmaRequests.js`
- `src/routes/vendors.js` — CRUD + restore
- `src/routes/purchaseOrders.js` — CRUD + restore + `/:id/items` sub-resource + `POST /:id/receive`
- `src/routes/assets.js` — static routes first (/stats, /low-stock, /scan) + CRUD + barcode/depreciation/assign/unassign/swap/dispose
- `src/routes/rmaRequests.js` — CRUD + ship/receive/close transitions
- `src/app.js` — 4 new mounts at v1.use('/vendors'), /purchase-orders, /assets, /rma-requests

### Frontend

- `frontend/src/pages/InventoryManagement.tsx` — 5-tab page (Stock/Assets/Vendors/Purchase Orders/RMA)
- Route: `<Route path="inventory-management" element={<InventoryManagement />} />`
- ~79 new `inventoryManagement.*` i18n keys in en/es/pt-BR (2132 keys total)

### Verification results (2026-06-12)

- schema-parity-check: 0 failures
- pnpm spec:check: 669 paths, 0 drift
- pnpm lint: clean
- Full backend suite (after taskRunner fix): 4099 passed, 24 skipped, 0 failed
- Frontend lint (gen:api + tsc --noEmit): clean
- Frontend tests: 406 passed (82 test files)
- i18n:check: 2132/2132 100%
- Frontend build: clean
- FK dup check: only 3 pre-existing tax_rate dups
- README: 260 tables, 409 endpoints, migrations 001-307

### Next migration: 308

**Why:** All 17 §14 items ticked in isp-platform-features.md.

**How to apply:** Next section work starts at migration 308. Table count is 260.
