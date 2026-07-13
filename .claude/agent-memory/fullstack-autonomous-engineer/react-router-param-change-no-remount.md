---
name: react-router-param-change-no-remount
description: React Router v6 does not remount a route element when only the URL param changes — a child component with a "prime state once" ref/effect needs key={id} or it leaks stale data across the param change
metadata:
  type: feedback
---

For `<Route path="/things/:id" element={<ThingDetail />} />`, navigating
from `/things/41` to `/things/42` (via `<Link>`/`navigate()`, not a full
page reload) reuses the SAME `ThingDetail` component instance — React
Router only remounts when the matched *route element* changes, not when
just the param does. `useParams()`/dependent `useQuery` keys correctly
re-fetch, but any **child** component's own local state that primes once
from fetched data (e.g. a `useRef` "already initialized" flag gating a
`useEffect`) does NOT reset — it silently keeps showing/submitting the
PREVIOUS id's data against the NEW id.

**Why this matters**: found in migration 388's `DeviceDetail.tsx` ->
`RfThresholdsTab` (a form component that fetches an `ap_sector_configs`
row keyed on `deviceId` and primes its inputs once via
`primedRef.current` gating a `useEffect`). An independent
code-review agent confirmed the mechanism: navigating between two
AP/PTP devices' detail pages without an intervening unmount would leave
device A's threshold values in the form, and clicking Save would PUT/POST
device A's numbers onto device B's sector row — a silent cross-record
data corruption, not a crash. See
[[migration-388-diagnostic-thresholds]].

**How to apply**: any child component keyed by an id-like prop that owns
"prime once from a fetch" local state must be given `key={theId}` at its
call site (`<RfThresholdsTab key={device.id} deviceId={device.id} />`) so
React fully remounts (fresh `useState`/`useRef`) whenever the id changes,
rather than trying to manually track "did the id change" inside the
component. Also worth a defense-in-depth check on any sibling
`activeTab === 'x' && <SomeConditionalPanel/>` render gate if the tab's
availability itself depends on the same changing prop (e.g. device type)
— re-check the condition at render time, don't rely solely on stale
`activeTab` state having been reset elsewhere.
