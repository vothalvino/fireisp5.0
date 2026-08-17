# SNMP trap forwarding

Trap forwarding lets FireISP notify another system when a network device sends
an unsolicited SNMP trap. Typical examples are a link going down, a device
restarting, or an authentication failure. This is separate from SNMP polling:
polling asks a device for information on a schedule, while a trap is sent by
the device as soon as an event occurs.

## How it works

```text
Network device --UDP trap--> FireISP --durable delivery--> one destination
                                      |                   email, HTTPS URL,
                                      +-- status/retries   or saved webhook
```

FireISP stores the received trap and every matching delivery record in one
database transaction. Only after that transaction commits are delivery jobs
queued. Delivery happens asynchronously, so an unavailable email server or
webhook cannot roll back the received trap, and the retry sweep can recover a
committed delivery if the process stops before it reaches the queue.

One rule sends to exactly one destination. To notify two destinations, create
two rules. This keeps each destination's retry history and status independent.

## Before creating a rule

1. Confirm this FireISP installation contains exactly one retained organization
   in the shared database and no retained isolated-database configuration.
   Multi-organization and isolated-database installations remain fail-closed in
   this release because tenant-editable device IPs are not an install-wide trust
   registry.
2. Add the sending network device to FireISP with its real management/source IP.
   That IPv4 address must identify exactly one non-deleted device.
3. Allow the device-management network to reach the FireISP UDP trap port.
4. Configure the device to send SNMP traps to the FireISP host and port.
5. If email will be used, have the install operator configure the trusted
   install-wide SMTP relay. Tenant-configured SMTP hosts are deliberately not
   used for trap forwarding. If a saved webhook will be used, create and enable
   it first.

This release receives traps over IPv4 UDP and rule source matching accepts an
IPv4 address. Native IPv6 trap intake is not claimed: the installed `net-snmp`
listener defaults to `udp4`, and silently presenting an IPv6 matcher would make
a rule that can never fire. Device IPv6 fields are still canonicalized when
checking address ambiguity so an IPv4-mapped spelling cannot bypass tenant
ownership checks.

For a single-organization shared-database installation, FireISP verifies the
one current device and active organization in the same primary-database
transaction that stores the trap and delivery rows. If the source IP is
unknown, duplicated, or cannot be verified, FireISP stores nothing and
forwards nothing. Only bounded in-process counters record the drop; raw tenant
payload is never copied into a fallback database.

Trap source attribution is not currently enabled when the installation retains
more than one organization. A tenant operator can edit that tenant's device IP
records, so those rows cannot safely prove ownership of another organization's
unauthenticated UDP traffic. FireISP therefore pauses activation, tests,
intake, retries, and egress installation-wide instead of letting one tenant
create an address collision that blinds another. Supporting multiple
organizations requires a future install-operator-controlled source-binding
registry.

Trap source attribution is not currently enabled when any retained tenant
database configuration uses physically isolated storage. A suspended tenant's
devices can still emit traps, and independent databases cannot offer one atomic
uniqueness decision for a source IP. In that installation mode FireISP stores
nothing and sends nothing. Isolated-database
support requires a future primary source-binding registry; repeated scans or a
short-lived cache are not treated as proof of ownership.

### Docker Compose

The development and production Compose files publish the port configured by
`SNMP_TRAP_PORT`; its default is UDP 1620. The application itself uses
`SNMP_TRAP_BIND_IP`; a bare-node process defaults to loopback. Compose binds
inside the container and separately publishes only on
`SNMP_TRAP_PUBLISH_IP`, which defaults to host loopback. After the firewall is
restricted, set the publish address to the server's device-management IPv4
address and point devices at that address:

```dotenv
SNMP_TRAP_PORT=1620
SNMP_TRAP_PUBLISH_IP=192.0.2.10 # replace with the real management-interface IP
```

Production containers may use the standard UDP port 162 by setting
`SNMP_TRAP_PORT=162`. Non-root source/development processes should keep a port
of 1024 or higher. An alternative is to redirect host UDP 162 to 1620.

Only permit trusted device-management networks through the host firewall.
Avoid publishing on `0.0.0.0` unless that firewall has been verified. The
receiver is an ingest listener, not an Internet-facing API. It attributes
senders by source IP and does not authenticate inbound traps with an SNMP
community, so a non-loopback deployment must enforce that network ACL.

The listener also has a fixed-memory overload boundary. It accepts at most 16
in-flight traps and permits a short burst of 100 at up to 50 tokens per second.
A separate installation bucket refills at 600 tokens per minute with a 120
token burst, while each canonical source is limited to 10 per minute with a 20
token burst across a fixed set of 256 buckets. This keeps one noisy device from
consuming every organization's intake budget without allocating an unbounded
source map. Excess UDP datagrams are dropped and counted rather than queued.
Tune these only after measuring the management network, using
`SNMP_TRAP_MAX_IN_FLIGHT`, `SNMP_TRAP_RATE_PER_SECOND`,
`SNMP_TRAP_RATE_BURST`, `SNMP_TRAP_RATE_PER_MINUTE`,
`SNMP_TRAP_RATE_MINUTE_BURST`, `SNMP_TRAP_SOURCE_RATE_PER_MINUTE`, and
`SNMP_TRAP_SOURCE_RATE_BURST`. `SNMP_TRAP_DRAIN_TIMEOUT_MS` controls the
bounded graceful-shutdown drain and defaults to 10000 milliseconds.

Persistence is bounded separately so a sustained device fault cannot fill the
database after a process restart. Each organization may store at most 10,000
trap rows, 16 MiB of raw varbind JSON, and 10,000 delivery rows per UTC day by
default. Higher installation-wide safety ceilings are 100,000 trap rows, 128
MiB, and 100,000 delivery rows. One organization therefore cannot consume the
whole installation allowance. Once a byte budget is reached, otherwise valid
traps retain only safe metadata; once a row or delivery budget is reached,
additional corresponding work is not stored. Individual traps are also capped
at 64 varbinds, 512 UTF-8 bytes per value, and 8 KiB of serialized varbind JSON.
The explicit `SNMP_TRAP_ORG_DAILY_*` and `SNMP_TRAP_GLOBAL_DAILY_*` variables
configure these durable ceilings.

These are safety ceilings, not a storage forecast. At the global defaults,
raw varbind JSON alone can reach about 22.5 GiB across the 180-day trap
retention window; row and index overhead plus the 90-day delivery history can
be materially larger. Before production exposure, size the database for the
chosen limits and retention, alert on quota/volume growth, and lower the global
limits for a small installation. The Trap Forwarding page shows the active
organization's daily usage and any metadata-only, dropped, or skipped work.

When Redis is unavailable, FireISP admits at most 100 immediate trap delivery
jobs to the local process (`SNMP_TRAP_LOCAL_QUEUE_CAPACITY`). Overflow remains
durable in SQL and is recovered by the scheduled retry sweep; it does not
create one timer per waiting delivery.

### Kubernetes / Helm

The chart declares the internal UDP 1620 container port. Its external trap
Service is opt-in so installing FireISP does not expose an unauthenticated UDP
listener accidentally. A production values file can enable it and restrict
source ranges:

```yaml
snmpTrap:
  enabled: true
  type: LoadBalancer
  port: 162
  externalTrafficPolicy: Local
  loadBalancerSourceRanges:
    - 198.51.100.0/24 # replace with the real device-management range
```

The load balancer must support UDP. For an on-premises cluster, a restricted
`NodePort` or an external UDP load balancer can be used instead. The chart
refuses to render an externally reachable Service without a nonempty
`loadBalancerSourceRanges` list. If Kubernetes cannot express the real ACL
(for example, a separately firewalled `NodePort`), set
`allowUnrestrictedSources: true` only after verifying that external ACL. The
name is intentionally explicit: without the external ACL, this override would
expose an unauthenticated UDP listener.

When the Service is disabled, the chart binds the receiver to pod loopback.
Enabling the guarded Service changes the pod listener to `0.0.0.0`; treat the
cluster network as part of the trusted boundary and apply a NetworkPolicy when
untrusted workloads share the cluster.

If you deploy with the plain manifests under `k8s/` instead of Helm, the stock
HTTP Service intentionally does not expose UDP. Copy
`k8s/examples/snmp-trap-service.yaml` into your deployment manifests, replace
its documentation-only source range with the trusted device-management CIDR,
set `SNMP_TRAP_BIND_IP: "0.0.0.0"` in `k8s/configmap.yaml`, and then apply it.
The example uses `externalTrafficPolicy: Local` so a
compatible load balancer preserves the sender address FireISP needs for safe
device attribution. Do not expose the listener through the HTTP Ingress.

## Create a rule

Open **Network → Trap Forwarding Rules**, then select **Add rule**.

### 1. Give it a clear name

Examples: `Core router linkDown → NOC` or `OLT restarts → monitoring webhook`.

### 2. Choose which traps match

All match fields are optional:

- Blank means “any.” Do not enter `*`.
- If more than one field is filled, every condition must match (logical AND).
- Trap type and IPv4 source are exact matches.
- An OID prefix follows dotted-component boundaries. For example, `1.2.3`
  matches `1.2.3` and `1.2.3.4`, but not `1.2.30`.

Start with one specific device or trap type. A completely blank filter matches
every attributed trap in the organization.

### 3. Choose one destination

- **Email:** sent only through the install operator's trusted global SMTP
  relay. An organization's custom SMTP host is not used for trap forwarding,
  so tenant configuration cannot turn delivery into an internal-network probe.
- **Secure HTTPS URL:** must resolve to a public address. HTTP, credentials in
  the URL, fragments, loopback, private, link-local, CGNAT, and metadata
  addresses are rejected. FireISP checks and pins DNS again for every attempt
  and does not follow redirects.
- **Saved webhook:** choose an active webhook belonging to the same
  organization. FireISP applies the same public-HTTPS checks at delivery time.

Destination URLs are operational configuration and are stored in the tenant
database, including the immutable destination snapshot needed to retry a
delivery safely. FireISP hides them from view-only responses and audit values,
but the URL column itself is not application-encrypted. Treat the database,
replicas, and backups as sensitive encrypted infrastructure; prefer the
separate encrypted HMAC signing secret instead of placing reusable credentials
in a URL path or query string.

Forwarded data is deliberately limited to trap/device metadata. It does not
include the SNMP community, device credentials, or varbind values. FireISP does
not persist the inbound community. Raw varbind values are omitted from ordinary
trap lists and require the separate `snmp_traps.payload.view` permission to open
from an individual trap record. Migration 459 assigns that permission only to
the default admin and super-admin roles.

### 4. Send a test

Save the rule, then choose **Send test**. The confirmation explains that the
test is synthetic: it verifies the destination only and does not insert a fake
SNMP trap. Testing also works while a rule is paused. Test sends are limited to
10 per operator and organization per normal rate-limit window by default;
`RATE_LIMIT_TRAP_FORWARDING_TEST` changes that ceiling.

### 5. Check the result

The rule list shows its latest outcome:

| Status | Meaning |
|---|---|
| Pending | Safely stored and waiting for a worker |
| Sending | A worker has claimed the delivery |
| Retrying | The last attempt failed and another is scheduled |
| Delivered | The destination accepted it |
| Dead letter | Attempts were exhausted or the failure is not retryable |
| Cancelled | The rule or saved webhook became unavailable |

Delivery uses at-least-once semantics when a worker can eventually complete. A
stale final claim gets one bounded crash recovery so a process failure before
network I/O does not create a zero-attempt delivery; a second crash in that
ambiguous window is dead-lettered instead of allowing unbounded calls. A
request that reached the destination before the first crash may therefore be
repeated. Destinations should deduplicate with `X-FireISP-Delivery-Id`.

Pausing, deleting, or changing a rule cancels work that has not been claimed.
It cannot recall a network request already in progress: that one claimed
attempt may finish against its immutable destination snapshot, but it is not
retried after the revocation. The delivery history records the outcome.
Likewise, a source-IP ownership or database-isolation change applies to new and
unclaimed work. An attempt whose ownership was authoritative when received and
again at its final preflight may finish once; the later configuration change
does not retroactively reassign that historical trap.

Direct URL and email rules use four attempts by default. Saved webhooks use
their configured retry count plus the first attempt, capped at 11 attempts. The
existing `webhook_retry` scheduled task recovers due or stranded deliveries
every five minutes. Delivery history is retained for 90 days by default; set
`RETENTION_SNMP_TRAP_FORWARDING_DELIVERIES_DAYS` to an approved positive number
of days when a different operational policy is required. Raw received traps
default to 180 days through `RETENTION_SNMP_TRAPS_DAYS`.

## Upgrade behavior

Migration 459 requires a short maintenance window. Stop and drain every old
application pod, background worker, and UDP trap listener before applying it;
then migrate the primary and every retained isolated tenant database before
starting only the new image. Do not perform this upgrade as a rolling overlap.
An old process can write the legacy community, audit, destination, or plaintext
webhook-secret formats after the migration has scrubbed them. The supplied
Compose redeploy and Kubernetes/Helm manifests enforce this stop–migrate–start
order. Custom deployments must provide the same fencing, and devices should be
expected to retry or lose UDP traps during the brief maintenance window.
Migration 459 is also a one-way application compatibility boundary. The
standard redeploy command refuses an older image that predates it; roll forward
with a corrected post-459 image instead. A pre-459 application can neither use
the encrypted saved-webhook secret format correctly nor preserve the new trap
and audit privacy guarantees.

Migration 459 pauses every pre-existing trap-forwarding rule. Older releases
stored those rules but never executed them, and their destinations were not
checked by the new outbound-request safeguards. Review each legacy rule, choose
one destination, save it, send a test, and then enable it deliberately.

Older releases also stored saved-webhook HMAC secrets as plaintext despite the
column name. Migration 459 irreversibly clears those legacy values and pauses
the affected saved webhooks. Rotate the secret at the receiving system, enter
the new secret through the upgraded FireISP webhook editor, test it, and then
enable the webhook deliberately. This affects saved webhooks even when they
were not used by a Trap Forwarding Rule; include that rotation in the upgrade
maintenance window. Do not recover or reuse the old plaintext from a database
backup.

Migration 459 also makes Trap Forwarding Rules the single supported external
delivery path for `device.trap` events. A generic saved webhook that previously
subscribed to `device.trap` or `*` no longer receives traps automatically.
Create an explicit Trap Forwarding Rule that selects that saved webhook. Trap
metadata is also no longer broadcast on the generic staff real-time stream,
which has no per-event device permission check; authorized operators use the
permission-scoped SNMP Traps page instead.

## Troubleshooting

- **No trap appears:** confirm UDP reachability and the device's destination
  host/port. SNMP polling success does not prove trap delivery works.
- **Trap appears but is not forwarded:** confirm the device source IP maps to
  one active FireISP device, the rule is enabled, and all filled match fields
  match the stored type/source/OID.
- **Installation uses an isolated tenant database:** forwarding deliberately
  remains unavailable until FireISP has an explicit primary source-binding
  registry. Do not work around this boundary by duplicating device rows in the
  shared database.
- **Installation contains more than one organization:** forwarding is paused
  deliberately. Do not remove or rewrite organization/device records to bypass
  the boundary; wait for the install-operator-controlled source-binding design.
- **Needs attention:** the legacy rule has no destination or more than one.
  Edit it and select exactly one.
- **Destination rejected while saving:** use a public HTTPS hostname. Private
  network webhooks must be exposed through a deliberately secured public HTTPS
  endpoint or handled by a future trusted-egress design.
- **Retrying/dead letter:** check SMTP/webhook availability and the non-sensitive
  last-error summary. A rule limit of 100 active rules per organization prevents
  accidental unbounded fan-out.

API details are available in the generated OpenAPI documentation under
`/api/docs`. All endpoints require normal organization authentication and the
appropriate `trap_forwarding.*` permission.
