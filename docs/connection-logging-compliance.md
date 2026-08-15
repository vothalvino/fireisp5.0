# Connection Logging and IP Attribution Evidence Operations

This guide explains the subscriber-accounting and privacy-minimal CGNAT
attribution datasets exposed by FireISP, how to validate them, and where the
product boundary ends.

> Connection data is highly sensitive. Enable and use it only for a documented
> lawful purpose. The LMTR does not expressly enumerate CGNAT address/port
> bindings, so enabling this operator control is not, by itself, proof of a
> Mexican Article 183 requirement or a compliance certification. See
> [Mexican Telecommunications Regulatory Compliance](compliance-mexico.md).

## Dataset boundaries

### Subscriber sessions

The RADIUS accounting pipeline receives `Start`, `Interim-Update`, and `Stop`
records and maintains a subscriber-session view. It records the organization,
subscriber/contract association when resolvable, RADIUS username and session
identifier, assigned IPv4/IPv6 address, MAC/circuit identifiers, NAS, traffic
counters, start/last-seen/end state, duration, and termination cause.

Application-level append-only accounting evidence preserves lifecycle
milestones separately from the mutable current-session projection: Start, the
first transition to Interim, Stop, and a later corrected final Stop when
applicable. Routine Interim heartbeats advance counters and the receipt time on
the projection without creating a durable evidence row. The public API exposes
no update/delete operation, while the controlled retention job can delete
expired records. This distinction is important: the session projection answers
"what was the latest/final state?" while the evidence record answers "which
lifecycle evidence arrived, and when?"

The evidence table contains selected, normalized application milestones—not
raw RADIUS packets, every heartbeat, or a byte-for-byte NAS archive. Its
idempotency key and integrity hash detect common replay/inconsistency cases but
do not prevent a privileged database operator from changing both data and hash.
Treat it as operational evidence, not as a tamper-proof or automatically
complete statutory vault.

The logger does not infer destination hosts from RADIUS. RADIUS accounting
contains subscriber/session metadata and cumulative counters, not every
connection made by the subscriber.

### Direct public-address attribution

When RADIUS assigns a public IPv4 address directly to one subscriber session,
the attribution key is that public address plus an exact UTC instant. The
session interval must certainly cover the instant and exactly one
same-organization subscriber/access session must match. For the lower bound,
FireISP uses the first normalized lifecycle evidence for that exact public IP:
the queried instant must be at or after both its NAS event time and its server
receipt time. For a closed session, the instant must be strictly before both
the Stop event time and its receipt time. For an active session, both the latest
normalized accounting event time and its receipt time must cover the instant,
and the receipt must still satisfy the configured liveness window. Thus a
projection timestamp alone, an unreceived NAS event, or the nearest session is
never enough.

Source port and transport protocol are not required to distinguish subscribers
in this direct-address case. The case-gated legal lookup uses
`POST /connection-logs/ip-attribution/lookup`. Return API status `unavailable`
(`no_direct_assignment`) or `ambiguous` when the bounded evidence is missing or
intervals overlap; never choose the nearest session. This still attributes the
subscription/access session, not a human, destination, or action.

### Operational UTC usage rollup

`radius_accounting_usage_daily` records only monotonic increases between
accepted application-ingest observations and assigns the delta to the
normalized event's UTC day. It avoids summing repeated cumulative Interim
counters, but it cannot split an interval exactly across midnight. A same-month
UTC-day crossing is labeled as an allocation estimate while preserving the
exact monthly total. A non-zero first observation, a counter appearing late or
resetting, or an interval that crosses a UTC calendar-month boundary marks the
affected accounting period incomplete. Billing, FUP, and rollover automation
must reject incomplete periods; daily estimates and any legal attribution still
require operator review.

This rollup is populated transactionally by the supported embedded-server,
tenant REST, and unambiguous compatibility REST application paths. Deprecated
direct-SQL `connection_logs` writers do not populate it and are not a supported
usage-accounting source.

### Privacy-minimal CGNAT attribution bindings

`cgnat_attribution_bindings` stores normalized translation or port-allocation
bindings supplied by an operator-controlled external collector. The minimum
useful record associates:

- a subscriber/account and RADIUS access session when correlation succeeds;
- the private source address and, for a single-port mapping, private source port;
- the translated public source address and port or allocated public port range;
- transport protocol;
- precise UTC allocation start and release times;
- CGNAT gateway, pool/realm and collector/exporter identity; and
- a stable source event identifier for replay control and provenance.

This mode requires an exclusive-source-tuple invariant: at any instant, one
public IPv4 address + translated source port + transport protocol belongs to at
most one subscriber, regardless of remote destination. Configure exclusive
single-port or port-block allocation and verify the invariant on every CGNAT
implementation. If a translator can reuse that public source tuple concurrently
for different subscribers and distinguishes them only by remote destination,
privacy-minimal attribution is unsupported and readiness must report
`unavailable`. Do not solve that incompatibility by collecting destination
fields; use a supported exclusive allocation mode or obtain a separate
privacy/legal design.

Each `cgnat_exporter_configs` entry is tenant-owned and disabled by default.
Enabling it requires a documented `purpose_reference`, an explicit
`tuple_exclusivity_confirmed=true` attestation, a reconciled authoritative
starting baseline, and the approving user's identity and time. Register every
exporter/NAT instance/pool/realm combination and mark all coverage-required
paths accordingly; readiness is incomplete if a required entry is disabled,
stale, unapproved, nonexclusive, lacks its baseline, or reports sequence/loss
or metadata incidents.

The v1 baseline is deliberately narrow. Before enabling an epoch, drain and
reconcile the covered pool so that no pre-existing allocation remains (or
otherwise prove that the covered starting point is empty), retain the external
change/reconciliation evidence, set `authoritative_baseline_confirmed=true`,
and put that evidence reference in `baseline_reference`. Then start a new
`exporter_boot_id` sequence at 0 or 1 and begin collection. FireISP does not
import a nonempty translator snapshot or historical live allocations; an
allocation whose `allocated_at` predates baseline confirmation is rejected.
Until the old mappings have drained and the clean epoch begins, historical
attribution for that pool is unavailable.

A boot transition never silently resumes an existing evidence epoch. Neither a
returning boot identifier nor a successor `exporter_boot_id` proves that open
mappings survived correctly. Drain and reconcile the covered pool again,
establish a new provably empty baseline and evidence reference, and register a
newly versioned exporter identity/configuration epoch whose sequence begins at
0 or 1. The old or interrupted epoch remains unavailable; do not reuse its
declaration merely because the device or normalizer restarted cleanly.

Incident counters are deliberately cumulative for one exporter identity/epoch.
An observed sequence gap, out-of-order event, reported loss, or incomplete
metadata keeps that epoch fail-closed. After the operator reconciles the source
against the authoritative translator, disable/retire the affected identity and
register a newly versioned exporter identity/epoch for future events. Do not
zero the old counters: old-epoch evidence remains unavailable, and resetting it
would falsely turn an unproven period green.

For a clean epoch with no incident counters, first close every allocation and
then retire the declaration by setting both `enabled=false` and
`is_required=false`. After its first accepted event, the declaration's
evidentiary fields are immutable; a changed gateway, token, pool, range,
purpose, baseline, or exclusivity design requires a new versioned exporter
identity.
Retirement ends the declaration's effective interval but does not erase clean
historical evidence: during its approved retention period, an exact lookup for
an instant between collection approval and retirement may still use that clean
retired epoch. An instant at or after retirement is unavailable from it.

Authorized administrators inspect these declarations with
`GET /connection-logs/cgnat-attribution/exporters` and create or replace an
exact exporter/NAT-instance/pool/realm declaration with
`PUT /connection-logs/cgnat-attribution/exporters`. The write requires an
interactive user with `cgnat_attribution.manage`; an API token cannot approve
collection. These are coverage-configuration routes, not binding-history or
legal-response routes.

An exporter declaration names `exporter_id`, `nat_instance_id`, `nat_pool_id`,
`nat_realm`, the same-organization `nat_pool_record_id`, and the dedicated
`collector_api_token_id`. It may also bind the source to a same-organization
NAS/address. `is_required` defaults to true and `enabled` defaults to false.
Before enabling, set the documented `purpose_reference` and
`tuple_exclusivity_confirmed=true`, plus
`authoritative_baseline_confirmed=true` and a nonblank `baseline_reference`
after the empty starting point has been externally reconciled; the referenced
token must be active and have exactly the `cgnat_attribution:ingest` scope. The
application copies the active CGNAT/PAT pool's public range into the declaration
and rejects overlapping enabled pool coverage.

There is deliberately no destination address or port, URL, domain, DNS answer,
packet payload, application content, byte counter, or browsing-history field.
A collector must not smuggle any of those values into an identifier or notes
field. Legacy per-destination connection collection is not part of this
compliance mode.
This engineering minimization is also consistent with
[RFC 6888 section 4](https://www.rfc-editor.org/rfc/rfc6888.html#section-4),
which addresses subscriber attribution from external address/port/protocol/time
information without treating destination logging as the default.

FireISP does not derive translations from RADIUS accounting and does not decode
RouterOS, NetFlow/IPFIX or syslog packets itself. Deploy an external normalizer
that receives authoritative binding/allocation events from every CGNAT device
and submits only the minimum normalized records through
`POST /connection-logs/cgnat-attribution/bindings/ingest`. Use a dedicated
organization API token whose only scope is `cgnat_attribution:ingest` and a
durable queue/retry policy. A successful HTTP response proves only that the
submitted batch was accepted; it does not prove that a translator emitted every
binding.

The request body is exactly `{ "bindings": [ ... ] }`; unknown top-level and
binding fields are rejected. Each usable record carries:

- `event_type` (`allocate` or `release`), stable `binding_key`, and
  `binding_type` (`single_port` or `port_block`);
- private/public source addresses, translated public port or inclusive port
  range, and `protocol` (`tcp`/`6` or `udp`/`17`); a single-port record repeats
  its one private and public port in the corresponding start/end fields, while
  a port-block record omits both private-port fields;
- timezone-qualified `allocated_at` and `device_recorded_at`; an allocation
  leaves `released_at` empty, and its later release repeats the exact allocation
  identity/tuple and supplies `released_at`;
- `session_instance_id`, required on every allocate and release record, copied
  exactly from the canonical UUID returned by the tenant RADIUS accounting
  ingest for that access-session lifecycle;
- `exporter_id`, `exporter_boot_id`, `nat_instance_id`, `nat_pool_id`,
  `nat_realm`, a source `event_id` unique within that registered exporter and
  `exporter_boot_id` epoch, and a monotonic `sequence_number`; and
- `clock_offset_ms`, `clock_uncertainty_ms`, and `records_lost_before`, including
  explicit zeroes. Omitting this health evidence makes the stored record
  incomplete and therefore unavailable for a positive legal attribution.

`session_instance_id` is authority from FireISP's tenant RADIUS ledger, not an
optional collector guess. A collector must capture the UUID returned by
`POST /api/v1/radius/accounting/tenant` and carry it through its authoritative
allocation source. Client, contract, username and NAS-facing RADIUS-session
values remain optional consistency hints. FireISP requires that exact canonical
session to be same-organization, to own the private address, and to cover the
allocation interval; it rejects a missing, unknown, mismatched or non-covering
session instead of searching by reused private address alone.

The device-clock sign convention is `clock_offset_ms = raw device clock - UTC`.
FireISP subtracts that offset from `device_recorded_at`, then subtracts
`clock_uncertainty_ms` again to obtain the last certain exporter coverage
horizon. Exact tuple attribution also excludes the uncertainty bands at the
allocation and release boundaries. Missing clock health never widens a claim.

V1 has no checkpoint or heartbeat event. An open single-port mapping or
long-lived deterministic port block is attributable only through the last
certain coverage horizon advanced by authoritative allocate/release traffic for
that exporter/pool. A quiet feed eventually becomes stale, lookup returns
`unavailable`, and readiness fails closed even if the allocation row remains
open. Do not treat an HTTP-accepted allocation or a long configured block
lifetime as proof of continuous coverage.

An exact event replay is idempotent; reusing its exporter boot/event identity
with different content, releasing a different tuple, or overlapping an existing
subscriber allocation fails closed. The response separately reports received,
inserted, replayed, allocated and released counts, metadata incompleteness, and
sequence-state counts so the normalizer can reconcile its durable queue.

The synchronous HTTP/MySQL sink is for measured low-volume mapping events or
exclusive deterministic port-block allocations. Prefer port blocks where the
CGNAT supports them: they reduce collection volume while preserving the unique
source-tuple invariant. Do not send a carrier-scale unsampled per-connection
mapping stream to the application database. At high rates, require a durable
queue/normalizer and a dedicated partitioned append/search store with a reviewed
case-gated integration; measure end-to-end exporter loss, queue backlog, ingest
lag, index growth, backup and purge throughput under peak load. Until that
boundary is implemented and accepted, report coverage unavailable rather than
assuming HTTP success means completeness.

If the device's raw event format contains a destination, the normalizer must
discard it before persistence, queuing, dead-letter handling, telemetry or API
submission. Disable raw-event/body logging and scrub crash reports. Collector
buffers, rejected payloads and backups are part of the privacy and retention
boundary even though FireISP rejects unknown/destination fields.

The same `POST /connection-logs/ip-attribution/lookup` route handles shared
CGNAT with a public source IP, public source port, transport protocol, UTC
instant, and the authorized government-request case identifier. Unlike direct
public-address attribution, the port and protocol are required because the
public address is shared. The lookup must return:

- **`matched`** only when exactly one same-organization binding covers that
  tuple and instant and it links to a subscriber access session;
- **`unavailable`** when no binding matches or the sole candidate has incomplete
  clock, sequence, loss, correlation, or coverage evidence; or
- **`ambiguous`** when more than one direct-session/binding candidate matches.

Never choose the closest record or infer a subscriber from an address alone.
The unique result supports the statement that an identified subscriber account
and access session held the translated source tuple at that time. It does not
prove the identity of the human operating a device, the destination contacted,
the content exchanged, intent, or an action performed.

Do not enable CGNAT attribution merely because an organization uses the `MX`
locale or to make a readiness card green. The LMTR does not expressly enumerate
CGNAT address/port bindings. Before collection, the operator and counsel must
approve and document the applicable service and purpose, minimum field set,
privacy-notice treatment, authorized roles, all-device/pool coverage, clock and
loss controls, retention, suppression/legal-hold process, and incident response.

## Tenant isolation

Every newly ingested session event and CGNAT binding carries an explicit
`organization_id`. Read, lookup, readiness, and export queries scope directly
to the authenticated organization. Shared-database organizations must never
rely on a reused private IP, port, username, client link, session ID, or NAS join
alone for isolation. Isolated-database organizations execute the same queries
within their tenant database context.

An uncorrelated binding remains owned by the authenticated organization and is
reported as incomplete. Correlation must never search or attach a subscriber
from another organization. Keeping unresolved bindings for repair requires an
approved short quarantine window; otherwise the collector should reject or
discard them according to the operator's documented policy.

## Access model

- Session history requires the existing connection-log view permission.
- Session export requires a separate export permission.
- IP-attribution lookup and export require separate sensitive
  `ip_attribution.view` and `ip_attribution.export` permissions in addition to
  the applicable government-request permission and case gate.
- CGNAT collector ingestion requires `cgnat_attribution.ingest`; exporter/config
  administration requires the separate `cgnat_attribution.manage` permission.
- Accounting collection requires an organization API token whose one and only
  scope is `connection_logs:ingest`, owned by a principal with the
  `connection_logs.ingest` RBAC permission.
- CGNAT collection requires a different organization API token whose only scope
  is `cgnat_attribution:ingest`, owned by a principal with
  `cgnat_attribution.ingest`. JWTs, wildcard scopes, write scopes, or a token
  shared with the RADIUS collector must be rejected.
- IP-attribution and CGNAT permissions should be granted only to explicitly
  authorized roles. They are not intended for routine technician, support,
  billing, or general read-only personas.
- Every export is recorded in `report_access_logs` with the organization, user,
  report type, filters, source IP, user agent, and access time.
- A data-subject access export is a separate, audited privacy-response path. It
  may enumerate only records already linked to the exact same-organization
  client through client, contract, or access-session identity and requires
  `clients.view`, `dsar_requests.manage`, and `connection_logs.export`. It is not
  a public-tuple search, does not use a government-request case, and must not be
  used to discover another subscriber from an address or port.

These permissions govern the independently justified operational dataset. A
legal-response lookup or export must additionally carry a validated
`gov_data_request_id` from the same organization, remain within that case's
approved public-address and UTC time scope (plus source port/protocol for
shared CGNAT), and be handled only by designated legal-response personnel. A
case should begin in legal review; approval and
processing must precede fulfillment. Record the case, actor, query, outcome
(`matched`, `unavailable`, or `ambiguous`), reason, result count and export
checksum in the access audit. A platform-level operator must first assume one
organization and must never run an unscoped cross-tenant lookup. Product
permissions do not determine whether a government request is lawful.

### Government-request case gate

The case record is part of the security boundary, not a free-form note. An
IP-attribution case must validate a nonblank authority name, official reference,
cited legal basis, attribution-appropriate request type, public address, and
one exact timezone-qualified UTC instant. A direct-public case and lookup omit
both port and protocol; a shared-CGNAT case and lookup supply both. Supplying
only one is invalid, and a broader informational date range on the case cannot
authorize a different tuple or instant. Any referenced
client, contract, session, binding, reviewer, or hold must belong to the same
organization. When the approved case names a client or contract, the unique
attribution result must match that subject or the lookup is forbidden; the case
reference is not merely descriptive. Only an attribution-appropriate case type
can authorize these lookups; a `traffic_mirror` label in a request register does
not enable traffic
mirroring or interception and cannot broaden the stored dataset.

New cases enter `pending_legal_review`. Only an authorized reviewer can move a
validated case to `processing`; lookup/export is rejected in every other state.
Fulfillment is allowed only from `processing`, rejection only from a nonterminal
state, and a missing or wrong-organization update returns a not-found/conflict
result rather than unconditional success. Where staffing permits, keep the case
creator and legal approver separate.

A preservation hold is explicit and scoped to the case, organization, source
address/tuple, access session or binding, and UTC instant. The validated case
records authority and legal review; the evidence link records pin/release actor,
time, and release reason. The operator must separately schedule periodic hold
review. A case row by itself is not an indefinite hold. Purge may skip only
evidence covered by an active scoped hold, and resumes the approved
deletion/suppression process after release.

## API walkthrough

Every path below uses the `/api/v1` prefix. `Authorization: Bearer` is for an
interactive user with the named permissions; it must not be replaced by an API
token. `X-API-Key` is only for the dedicated machine collector whose one exact
scope is `cgnat_attribution:ingest`. Inject secrets from a secret manager rather
than committing them or leaving them in shell history.

Set these placeholders before using the examples. Numeric IDs must remain JSON
numbers. `OPERATOR_PUBLIC_IPV4` and `DIRECT_PUBLIC_IPV4` must be real,
operator-controlled globally routable addresses; documentation ranges are
rejected. Event times must be real timezone-qualified source evidence after the
approved baseline, and `SESSION_INSTANCE_ID` must be the canonical UUID returned
by the tenant RADIUS ingest—not a locally generated value.

```bash
API_BASE='https://isp.example.com/api/v1'
USER_JWT='<interactive-user-jwt>'
CGNAT_COLLECTOR_API_KEY='<dedicated-cgnat-ingest-api-key>'
RECOVERY_API_KEY='<different-release-recovery-api-key>'

NAT_POOL_RECORD_ID=42
COLLECTOR_TOKEN_ID=9001
RECOVERY_TOKEN_ID=9002
CLIENT_ID=101
CONTRACT_ID=201

OPERATOR_PUBLIC_IPV4='<address-in-the-configured-cgnat-pool>'
DIRECT_PUBLIC_IPV4='<address-assigned-directly-by-radius>'
PRIVATE_IPV4='<private-address-on-the-radius-session>'
SESSION_INSTANCE_ID='<uuid-returned-by-radius-accounting-tenant>'
ALLOCATED_AT='<actual-allocation-utc-after-baseline>'
RELEASED_AT='<actual-release-utc>'
DIRECT_OBSERVED_AT='<utc-instant-inside-certain-direct-session-bounds>'
CGNAT_OBSERVED_AT='<utc-instant-inside-certain-cgnat-bounds>'
```

### Approve a new exporter and empty baseline

First drain and reconcile the covered translator pool to a provably empty
starting point. Create an active same-organization API token whose only scope is
`cgnat_attribution:ingest`; its owner also needs
`cgnat_attribution.ingest`. The numeric token ID goes in the configuration, while
the secret token value is used later in `X-API-Key`.

The interactive approver needs `cgnat_attribution.manage`. The `exporter_id` is
versioned because a boot, token change, incident, pool change, or new baseline
requires a new evidence epoch. The referenced `nat_pool_record_id` must identify
one active same-organization CGNAT/PAT pool.

```bash
curl --fail-with-body --silent --show-error \
  --request PUT "${API_BASE}/connection-logs/cgnat-attribution/exporters" \
  --header "Authorization: Bearer ${USER_JWT}" \
  --header 'Content-Type: application/json' \
  --data-binary @- <<JSON
{
  "exporter_id": "mx-cgn-01-epoch-20260815-01",
  "nat_instance_id": "mx-cgn-01",
  "nat_pool_id": "public-pool-a",
  "nat_pool_record_id": ${NAT_POOL_RECORD_ID},
  "nat_realm": "mx-fixed-broadband",
  "collector_api_token_id": ${COLLECTOR_TOKEN_ID},
  "purpose_reference": "DPIA-2026-014 and counsel decision LEGAL-2026-031",
  "tuple_exclusivity_confirmed": true,
  "authoritative_baseline_confirmed": true,
  "baseline_reference": "CHG-2026-0821: pool drained, reconciled empty, evidence retained",
  "is_required": true,
  "enabled": true
}
JSON
```

The response is `{ "data": { ... } }`; retain `data.id` as
`EXPORTER_CONFIG_ID`. Approval and baseline times are server-generated. Do not
submit an allocation whose uncertainty interval or certain coverage horizon
predates either time. Start a new `exporter_boot_id` at sequence 0 or 1 only
after this approval.

### Submit authoritative allocate and release events

This port-block example deliberately omits private-port fields and all
destination fields. It assumes the block is exclusive to the named access
session for TCP regardless of remote endpoint. For a single-port event, use
`binding_type=single_port` and repeat the same private and public port in both
start/end fields.

```bash
curl --fail-with-body --silent --show-error \
  --request POST "${API_BASE}/connection-logs/cgnat-attribution/bindings/ingest" \
  --header "X-API-Key: ${CGNAT_COLLECTOR_API_KEY}" \
  --header 'Content-Type: application/json' \
  --data-binary @- <<JSON
{
  "bindings": [{
    "event_type": "allocate",
    "binding_key": "mx-cgn-01-tcp-block-000001",
    "binding_type": "port_block",
    "private_ipv4": "${PRIVATE_IPV4}",
    "public_ipv4": "${OPERATOR_PUBLIC_IPV4}",
    "public_port_start": 20000,
    "public_port_end": 20063,
    "protocol": "tcp",
    "allocated_at": "${ALLOCATED_AT}",
    "session_instance_id": "${SESSION_INSTANCE_ID}",
    "exporter_id": "mx-cgn-01-epoch-20260815-01",
    "exporter_boot_id": "boot-20260815-01",
    "nat_instance_id": "mx-cgn-01",
    "nat_pool_id": "public-pool-a",
    "nat_realm": "mx-fixed-broadband",
    "event_id": "event-000001-allocate",
    "sequence_number": 1,
    "device_recorded_at": "${ALLOCATED_AT}",
    "clock_offset_ms": 0,
    "clock_uncertainty_ms": 50,
    "records_lost_before": 0
  }]
}
JSON
```

The later release repeats the complete allocation identity and tuple. It uses a
new event ID and the next sequence number; it does not create a second binding.

```bash
curl --fail-with-body --silent --show-error \
  --request POST "${API_BASE}/connection-logs/cgnat-attribution/bindings/ingest" \
  --header "X-API-Key: ${CGNAT_COLLECTOR_API_KEY}" \
  --header 'Content-Type: application/json' \
  --data-binary @- <<JSON
{
  "bindings": [{
    "event_type": "release",
    "binding_key": "mx-cgn-01-tcp-block-000001",
    "binding_type": "port_block",
    "private_ipv4": "${PRIVATE_IPV4}",
    "public_ipv4": "${OPERATOR_PUBLIC_IPV4}",
    "public_port_start": 20000,
    "public_port_end": 20063,
    "protocol": "tcp",
    "allocated_at": "${ALLOCATED_AT}",
    "released_at": "${RELEASED_AT}",
    "session_instance_id": "${SESSION_INSTANCE_ID}",
    "exporter_id": "mx-cgn-01-epoch-20260815-01",
    "exporter_boot_id": "boot-20260815-01",
    "nat_instance_id": "mx-cgn-01",
    "nat_pool_id": "public-pool-a",
    "nat_realm": "mx-fixed-broadband",
    "event_id": "event-000002-release",
    "sequence_number": 2,
    "device_recorded_at": "${RELEASED_AT}",
    "clock_offset_ms": 0,
    "clock_uncertainty_ms": 50,
    "records_lost_before": 0
  }]
}
JSON
```

Both calls return `{ "data": { "received": 1, ... } }`. Acceptance means
FireISP stored that batch; it does not prove end-to-end completeness. The raw
device time convention is device clock minus UTC, so FireISP subtracts
`clock_offset_ms`; only corrected time minus uncertainty advances the certain
exporter horizon. V1 has no heartbeat/checkpoint, so a quiet feed becomes stale
even while a binding remains open.

### Register and approve exact government cases

Case creation requires an interactive user with `gov_data_requests.create`;
legal approval requires `gov_data_requests.manage`. A new case starts in
`pending_legal_review`; its returned `id` must be processed before lookup. Use
distinct cases for direct-public and CGNAT scopes.

```bash
curl --fail-with-body --silent --show-error \
  --request POST "${API_BASE}/regulatory-compliance/gov-data-requests" \
  --header "Authorization: Bearer ${USER_JWT}" \
  --header 'Content-Type: application/json' \
  --data-binary @- <<JSON
{
  "authority_name": "Authorized requesting authority",
  "authority_ref": "AUTH-DIRECT-2026-001",
  "request_type": "ip_traceability",
  "client_id": ${CLIENT_ID},
  "contract_id": ${CONTRACT_ID},
  "ip_address": "${DIRECT_PUBLIC_IPV4}",
  "observed_at": "${DIRECT_OBSERVED_AT}",
  "legal_basis": "Validated written authority and operator legal-review reference"
}
JSON
```

Set `DIRECT_CASE_ID` to the numeric `id` in the `{ "id": ..., "row_hash": ... }`
response, then approve the immutable exact scope:

```bash
DIRECT_CASE_ID=501 # replace with the numeric id returned above
curl --fail-with-body --silent --show-error \
  --request PUT "${API_BASE}/regulatory-compliance/gov-data-requests/${DIRECT_CASE_ID}/process" \
  --header "Authorization: Bearer ${USER_JWT}"
```

The success body is `{ "success": true, "status": "processing" }`. A direct
case omits both port and protocol. Create and process the CGNAT case separately:

```bash
curl --fail-with-body --silent --show-error \
  --request POST "${API_BASE}/regulatory-compliance/gov-data-requests" \
  --header "Authorization: Bearer ${USER_JWT}" \
  --header 'Content-Type: application/json' \
  --data-binary @- <<JSON
{
  "authority_name": "Authorized requesting authority",
  "authority_ref": "AUTH-CGNAT-2026-001",
  "request_type": "ip_traceability",
  "client_id": ${CLIENT_ID},
  "contract_id": ${CONTRACT_ID},
  "ip_address": "${OPERATOR_PUBLIC_IPV4}",
  "public_port": 20017,
  "protocol": "tcp",
  "observed_at": "${CGNAT_OBSERVED_AT}",
  "legal_basis": "Validated written authority and operator legal-review reference"
}
JSON

CGNAT_CASE_ID=502 # replace with the numeric id returned above
curl --fail-with-body --silent --show-error \
  --request PUT "${API_BASE}/regulatory-compliance/gov-data-requests/${CGNAT_CASE_ID}/process" \
  --header "Authorization: Bearer ${USER_JWT}"
```

### Look up and export direct-public or CGNAT attribution

Lookup requires `gov_data_requests.view` plus `ip_attribution.view`; export
requires `gov_data_requests.view` plus `ip_attribution.export`. The body must
repeat the processing case's exact scope. Direct-public lookup/export omits both
port and protocol:

```bash
curl --fail-with-body --silent --show-error \
  --request POST "${API_BASE}/connection-logs/ip-attribution/lookup" \
  --header "Authorization: Bearer ${USER_JWT}" \
  --header 'Content-Type: application/json' \
  --data-binary @- <<JSON
{
  "gov_data_request_id": ${DIRECT_CASE_ID},
  "public_ipv4": "${DIRECT_PUBLIC_IPV4}",
  "observed_at": "${DIRECT_OBSERVED_AT}"
}
JSON

curl --fail-with-body --silent --show-error \
  --request POST "${API_BASE}/connection-logs/ip-attribution/export" \
  --header "Authorization: Bearer ${USER_JWT}" \
  --header 'Content-Type: application/json' \
  --dump-header direct-attribution.headers \
  --output direct-attribution.csv \
  --data-binary @- <<JSON
{
  "gov_data_request_id": ${DIRECT_CASE_ID},
  "public_ipv4": "${DIRECT_PUBLIC_IPV4}",
  "observed_at": "${DIRECT_OBSERVED_AT}"
}
JSON
```

CGNAT lookup/export supplies both source port and protocol:

```bash
curl --fail-with-body --silent --show-error \
  --request POST "${API_BASE}/connection-logs/ip-attribution/lookup" \
  --header "Authorization: Bearer ${USER_JWT}" \
  --header 'Content-Type: application/json' \
  --data-binary @- <<JSON
{
  "gov_data_request_id": ${CGNAT_CASE_ID},
  "public_ipv4": "${OPERATOR_PUBLIC_IPV4}",
  "public_port": 20017,
  "protocol": "tcp",
  "observed_at": "${CGNAT_OBSERVED_AT}"
}
JSON

curl --fail-with-body --silent --show-error \
  --request POST "${API_BASE}/connection-logs/ip-attribution/export" \
  --header "Authorization: Bearer ${USER_JWT}" \
  --header 'Content-Type: application/json' \
  --dump-header cgnat-attribution.headers \
  --output cgnat-attribution.csv \
  --data-binary @- <<JSON
{
  "gov_data_request_id": ${CGNAT_CASE_ID},
  "public_ipv4": "${OPERATOR_PUBLIC_IPV4}",
  "public_port": 20017,
  "protocol": "tcp",
  "observed_at": "${CGNAT_OBSERVED_AT}"
}
JSON
```

Lookup returns `matched`, `unavailable`, or `ambiguous`; only `matched` includes
one attribution. Check each export's `X-Evidence-SHA256` response header and the
audited report-access record. Neither response contains a destination field.

### Release-only incident recovery

Use this path only instead of the ordinary release example when the frozen
primary collector token has become invalid while that active, required epoch
still has open allocations. Create a different, active, same-organization,
unbound exact-scope CGNAT token. An interactive
`cgnat_attribution.manage` user records the incident and approves its numeric
token ID:

```bash
EXPORTER_CONFIG_ID=314 # replace with numeric data.id from exporter approval
curl --fail-with-body --silent --show-error \
  --request POST "${API_BASE}/connection-logs/cgnat-attribution/exporters/${EXPORTER_CONFIG_ID}/release-recovery" \
  --header "Authorization: Bearer ${USER_JWT}" \
  --header 'Content-Type: application/json' \
  --data-binary @- <<JSON
{
  "collector_api_token_id": ${RECOVERY_TOKEN_ID},
  "incident_reference": "INC-2026-044: primary collector credential lost; releases reconciled to translator"
}
JSON
```

Submit only the exact release payload shown earlier to the normal ingest route,
but authenticate it with `X-API-Key: ${RECOVERY_API_KEY}`. The recovery token is
forbidden from allocating or binding to another exporter. Approval permanently
increments the old epoch's incident state, so it can never produce a positive
attribution even after every open mapping is closed. Reconcile and release the
remaining allocations, retire the old declaration, then drain/rebaseline and
register a newly versioned exporter identity for future evidence. Never reset
the old counters or reuse its baseline.

## Retention

RADIUS session projections, application-level event evidence, and the UTC usage
rollup default to 24 calendar months. This is a product policy, not a conclusion
that every RADIUS session is a covered numbered communication. The purge must
cover the primary database and active isolated tenant databases. Monthly
partition creation applies to the session/evidence tables; CGNAT tables are
indexed but not monthly partitioned. Partition creation and the application
purge are complementary controls; operators should monitor both and test
retrieval near the retention boundary.

Transactional collector provenance is aggregated by minute, source, NAS, event
type, and action, and defaults to 90 days. It is an operational receipt rollup,
not a replacement for the 24-month session/evidence records or an archive of
every raw accounting packet.

CGNAT binding retention must use the period documented in the operator's
privacy/legal assessment; the `MX` locale must not silently select a statutory
basis. Collection, ordinary deletion, backup expiry, and legal holds must use
the same approved schedule. A government-request row is case metadata, not an
automatic hold. Activate a same-organization hold over a specific tuple/session
and time range before ordinary deletion reaches responsive rows, audit it, and
release or review it when its authority ends.

`CGNAT_ATTRIBUTION_RETENTION_MONTHS` is one installation-wide setting. The
configured period must be approved for every organization that enables a CGNAT
exporter in that FireISP installation. Per-organization retention is not
implemented; tenants requiring divergent schedules must use separate
deployments. An isolated tenant database does not change this because the same
application retention worker and environment policy sweep it. Ordinary CGNAT
retention is capped at 24 calendar months as a product minimization control;
only evidence covered by an active, scoped case hold may remain longer. A value
above 24 is clamped to 24 rather than creating an unreviewed longer archive.

Ordinary CGNAT age is measured from `released_at`; an active binding is not
deleted merely because its allocation is old. That means a lost release event
can otherwise create indefinite retention. Alert on stale open bindings and
sequence gaps, reconcile them against the authoritative translator, and close
or quarantine them through a reviewed procedure—never invent a release time.
Retire the incident exporter identity and start a newly versioned epoch after
reconciliation; do not reset its cumulative incident counters or make its old
evidence available.

IP-attribution searches and exports are case-scoped and deliberately bounded.
Evidence export uses `POST /connection-logs/ip-attribution/export` and represents
the one exact address/tuple and instant approved in the case, including a
non-match or ambiguity outcome. It is not a bulk subscriber-history or arbitrary
date-range export.

Backups, replicas, exports, and collector queues are part of the retention
boundary. A database purge alone does not remove copies held elsewhere.

## Collector and query limits

| Setting or limit | Default | Enforced boundary |
|---|---:|---:|
| `RADIUS_ACCOUNTING_REQUESTS_PER_MINUTE` | 6,000 | 1–60,000 requests per tenant accounting token |
| `RADIUS_ACCOUNTING_MAX_CLOCK_SKEW_SECONDS` | 300 | Future event timestamps capped at 3,600 seconds |
| `CGNAT_ATTRIBUTION_INGEST_REQUESTS_PER_MINUTE` | 120 | 1–600 binding requests per tenant token |
| `CGNAT_ATTRIBUTION_MAX_BATCH` | 500 | At most 1,000 binding events per request |
| `CGNAT_ATTRIBUTION_MAX_CLOCK_SKEW_SECONDS` | 300 | 0–3,600 seconds accepted future timestamp skew |
| `CGNAT_ATTRIBUTION_SESSION_GRACE_SECONDS` | 900 | 0–86,400 seconds correlation grace around a RADIUS session |
| `CGNAT_ATTRIBUTION_STALE_MINUTES` | 15 | 1–1,440 minutes without authoritative allocate/release traffic before the no-heartbeat feed horizon and open bindings fail closed as stale |
| `CGNAT_ATTRIBUTION_OPEN_BINDING_STALE_HOURS` | 24 | 1–8,760 hours before an unreleased single-port mapping fails readiness |
| `CGNAT_ATTRIBUTION_OPEN_PORT_BLOCK_STALE_DAYS` | 31 | 1–3,650 days before an unreleased deterministic port block fails readiness |
| `CGNAT_ATTRIBUTION_RETENTION_MONTHS` | 24 | Installation-wide 1–24 calendar-month ordinary-retention policy; values above 24 clamp to 24, locale cannot select it, and only scoped active holds extend preservation |

Collector endpoints are rate-limited before JSON parsing and have a 2 MiB body
ceiling; ordinary API routes retain the general 10 MiB JSON limit. These are
safety ceilings, not capacity promises. IP-attribution lookup and export must
use the one exact case-authorized address/tuple and instant. There is no routine
binding-list or bulk-binding-export route. The separate RADIUS session export
must fail explicitly above its documented row ceiling instead of returning a
silently truncated file.

## Readiness interpretation

The connection-logging readiness endpoint should be treated as an operational
check, not a legal certification. Verify each source independently:

- **Subscriber accounting:** configuration, newest event, recent event count,
  active/closed sessions, and unattributed events.
- **Accounting evidence:** application-level event records are arriving and their hashes and
  idempotency keys are populated.
- **CGNAT attribution:** whether the binding feed is configured, last receipt,
  corrected-minus-uncertainty certain horizon, recent record count, canonical
  session-link rate, clock/loss state, and declared gateway/pool coverage. A
  green status is operational telemetry, not proof of complete coverage or a
  legal conclusion.
- **Retention:** effective configured periods and last successful purge across
  shared and isolated databases.

A genuinely quiet source may have no recent records. General readiness should
say "waiting" or "no recent records," not claim a router or collector is
reachable unless it actually tested that path. For CGNAT attribution, however,
the quiet interval also stops advancement of the certain coverage horizon:
because v1 has no heartbeat/checkpoint, legal lookup and CGNAT readiness must
fail closed once the configured feed-staleness threshold is crossed.

A demo can establish that known RADIUS packets produce an organization-scoped
session projection, selected evidence, and usage deltas. Dummy/quiet NAS entries
and a green application deployment do not establish live accounting coverage.
Likewise, no CGNAT lookup can succeed until an approved external collector sends
authoritative bindings. The feature must never claim that subscriber
destinations or actions are logged. Global and MX organizations use the same
technical controls, while each controller remains responsible for its own
purpose, notice, access, retention, and live-source acceptance.

## Acceptance test

### Deployment preflight

Migration 457 alters the partitioned `connection_logs` table, attributes legacy
rows where ownership is unambiguous, and creates ownership/evidence triggers,
the partitioned RADIUS lifecycle-evidence table, and indexed CGNAT tables. On
an installation with a large accounting history, take a
verified backup, measure the table, schedule a maintenance window, and monitor
metadata-lock/replication impact. Before applying migration 457, pause or drain
every accounting writer (embedded UDP accounting, FreeRADIUS REST/direct-SQL,
and external collectors) and verify that upstream retry/queue behavior will
preserve packets during the pause. Keep those writers stopped while migration
457 is applied to the primary and every active isolated database. Resume them
only after the ownership/evidence triggers and new tables have been confirmed
in every database. MySQL cannot make the projection `ALTER TABLE` and trigger
installation one atomic operation, so treating this as a zero-downtime
migration can leave an unowned, unevidenced row in the handoff window. Deploy with
`MIGRATE_ISOLATED_TENANTS=true` when any active organization uses an isolated
database; otherwise that tenant will not have the required columns, tables, or
triggers. An isolated tenant must already have a complete schema and a reviewed
copy of its tenant-owned data before the routing switch; an empty isolated
schema is not a cutover. See [Per-tenant database isolation](tenant-database-isolation.md).

Run the forward migration and rollback against the deployment's real MySQL
version and representative data before production. Rollback drops the evidence,
CGNAT-attribution, and usage-rollup tables plus migration-added projection
fields, restoring
the legacy fixed-two-year partition-drop procedure that can delete a very
long-lived session based on its start partition. It intentionally does not undo
the security backfill that bound legacy NULL-organization API tokens to one
owner organization. Export/preserve required records, review/revoke affected
tokens, and run the rollback runner's dry-run/preflight first. It also
intentionally retains the nullable `report_access_logs.api_token_id` column and
index so rollback cannot erase historical collector-credential provenance.
The exact-tuple/legal-review columns on `gov_data_requests`, the nullable
API-token/government-request provenance columns on `report_access_logs`, and the
new permission definitions and grants remain as compatibility and historical
provenance state. Dropping those columns would erase case and access history,
while the idempotent forward migration cannot prove whether a same-named
permission or grant predated migration 457. Older application code ignores or
exposes no corresponding feature routes. Normally prefer a forward repair.

If rollback 457 is unavoidable, target its boundary explicitly across the
primary and every isolated database; do not use `--step 1` on histories that
may have drifted:

```bash
MIGRATE_ISOLATED_TENANTS=true pnpm rollback -- --to 456 --dry-run
MIGRATE_ISOLATED_TENANTS=true pnpm rollback -- --to 456
```

The runner rejects step-based multi-database rollback when preflight resolves
different filenames, before executing any destructive SQL.

Migration 457 begins application-level lifecycle evidence at deployment. It
tenant-attributes legacy session projections where possible, but it does not
manufacture historical `radius_accounting_events` rows for packets the
application did not observe. Readiness and evidence exports must therefore
show that provenance boundary honestly.

For each production organization, including Global and MX organizations:

1. Start one known test subscriber session through a real NAS.
2. Confirm a RADIUS Start event and an active subscriber-session projection.
3. Send an Interim-Update; confirm counters and last-seen advance while the
   session remains active.
4. Stop the session; confirm end time, duration, counters, and termination cause.
5. Confirm the Start, first-Interim, and Stop lifecycle-evidence records exist;
   later routine Interim heartbeats do not add evidence rows, and duplicate
   delivery does not create duplicate evidence.
6. Confirm monotonic traffic increments appear once in the UTC usage rollup;
   replay an Interim, simulate a reset/cross-midnight interval, and verify the
   expected completeness/anomaly markers. Do not accept a direct-SQL writer as
   a passing usage source.
7. Search by subscriber, contract, username, session ID, assigned IP, NAS, MAC,
   and time range; confirm another organization cannot see any row.
8. Export the scoped session history and verify a `report_access_logs` entry.
9. Assign a known public IPv4 address directly to a test RADIUS session. Look it
   up by address and a UTC instant after both the first exact-IP lifecycle event
   and its receipt, and before both the closure/latest event and its receipt,
   without a port/protocol; verify a unique account/session result. Exercise
   each event/receipt boundary independently, stale active evidence, an instant
   outside the certain interval, and an intentionally overlapping fixture;
   return `unavailable` or `ambiguous` without guessing.
10. If CGNAT attribution is approved, create known TCP and UDP bindings on every
   translator/allocation mode. First drain/reconcile each covered pool, retain
   the empty-baseline evidence reference, enable a new exporter/boot epoch, and
   begin its sequence at 0 or 1; prove that a pre-baseline allocation is
   rejected and that no nonempty historical snapshot/import is implied. Capture
   the canonical `session_instance_id` returned by tenant RADIUS ingest and
   require it unchanged on every allocate/release; reject a guessed, missing,
   cross-tenant or non-covering session. Verify the private tuple, translated public
   address/port or range, protocol, exact allocation interval, gateway/source
   identity, subscriber-session correlation, allocate/release lifecycle and
   idempotent replay. A release must close the same allocation rather than create
   a second overlapping owner. Inspect the stored/API shape and prove that no
   destination or content field exists. Drop one release event and verify the
   stale open binding/sequence gap is alerted and lookup fails closed. Reconcile
   against the authoritative translator, retire the affected exporter identity,
   start a newly versioned epoch, and leave old-epoch evidence unavailable; do
   not synthesize a release timestamp or reset incident counters. Repeat with a
   new and a returning `exporter_boot_id`; neither may resume the prior epoch.
   Drain/reconcile/rebaseline and register a new versioned exporter declaration.
   Verify `clock_offset_ms` uses raw-device-minus-UTC, and that only corrected
   device time minus uncertainty advances the certain coverage horizon. Because
   v1 has no heartbeat/checkpoint, stop all authoritative allocate/release
   traffic and prove that an otherwise open mapping/port block becomes stale,
   lookup returns `unavailable`, and readiness fails closed.
11. With a validated same-organization legal-response case, look up the known
    public IP, public port, protocol and UTC instant. Verify the unique result
    identifies the expected account and access session. Then test zero matches,
    overlapping bindings, an uncorrelated binding, clock uncertainty, collector
    gaps, wrong organization, wrong case status and out-of-scope tuple/time; all
    must fail closed or return an explicit non-unique outcome.
12. Export only the case-authorized evidence and verify the access audit contains
    the case, actor, exact filters, outcome/count, and export checksum.
13. Verify readiness before and after binding events, then disable one collector
    and show that freshness/coverage degrades without claiming legal compliance.
14. Test retrieval near the ordinary retention boundary and prove that an
    approved preservation hold retains only its scoped records, that an ordinary
    case does not create indefinite retention, and that hold release resumes the
    approved deletion process across primary/isolated databases and backups.

Synthetic API fixtures exercise validation and tenant-isolation paths and
provide evidence for those tests; they do not prove a production NAS,
FreeRADIUS instance, border exporter, NAT device, or collector is configured.
Keep the real-device acceptance check in the launch record.
