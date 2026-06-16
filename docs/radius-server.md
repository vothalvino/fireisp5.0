# Embedded RADIUS Server

FireISP ships a **native RADIUS server** (authentication + accounting) so you do
**not** need to run a separate FreeRADIUS daemon. A NAS (e.g. MikroTik RouterOS)
points its `/radius` at the FireISP host, and FireISP authenticates PPPoE
subscribers from its own `radius` table and records sessions via the existing
accounting pipeline (`connection_logs`).

> The external-FreeRADIUS path (`radcheck`/`radreply` sync + the accounting REST
> ingest) still works unchanged. The embedded server is an alternative that keeps
> everything inside FireISP.

## Enabling

Opt-in via environment variables (disabled by default):

| Variable | Default | Meaning |
|---|---|---|
| `RADIUS_SERVER_ENABLED` | `false` | Start the embedded auth+accounting server |
| `RADIUS_AUTH_PORT` | `1812` | UDP port for Access-Request |
| `RADIUS_ACCT_PORT` | `1813` | UDP port for Accounting-Request |
| `RADIUS_SERVER_SECRET` | _(empty)_ | Fallback shared secret for NAS clients with no per-NAS secret |

The **per-NAS shared secret** is the `secret` column on the `nas` row whose
`ip_address` matches the request's source IP; `RADIUS_SERVER_SECRET` is only a
fallback. Requests from an unknown source IP with no secret are silently dropped
(RFC 2865).

## Point a MikroTik at FireISP

```
/radius add service=ppp address=<FIREISP_IP> secret=<nas.secret> \
        authentication-port=1812 accounting-port=1813
/ppp aaa set use-radius=yes accounting=yes interim-update=5m
```

> `service=ppp` (RouterOS only accepts the subsystem tokens
> `hotspot,login,ppp,dhcp,wireless,ipsec,dot1x` here — there is no `accounting`
> token). PPP **accounting** is turned on by `/ppp aaa accounting=yes` above and
> sent to this same server on its `accounting-port`. The **Seed** button in
> *NAS Devices* applies exactly this configuration over the RouterOS API.

## What FireISP returns

- **Access-Accept** with `Service-Type=Framed`, `Framed-Protocol=PPP`, an optional
  `Framed-IP-Address` (when the subscriber has a static IP), and the plan's policy
  attributes from `radiusAttributeService` — e.g. `Mikrotik-Rate-Limit` for a
  MikroTik plan (`radius_vendor='mikrotik'`).
- **Access-Reject** when the user is unknown/inactive or the password fails.
- **Accounting-Response** for Start/Interim/Stop, with the session persisted to
  `connection_logs` (bytes, session time, MAC, framed IP, terminate cause).

Auth methods supported: **PAP** (`User-Password`) and **CHAP** (`CHAP-Password` +
`CHAP-Challenge`). If the NAS sends a **Message-Authenticator** (attr 80), it is
verified and echoed (Blast-RADIUS / CVE-2024-3596 hardening).

## Operational status

`GET /api/v1/radius/server-status` returns `{ data: { enabled, running, authPort,
acctPort, counters } }`. Counters: `authRequests`, `accepts`, `rejects`,
`authDropped`, `acctRequests`, `acctIngested`, `acctDropped`.

## Security & hardening

- **Firewall the listener to known NAS source IPs.** The sockets bind all
  interfaces; restrict UDP 1812/1813 to your NAS devices. A request from a source
  IP with **no matching `nas` row is dropped** (RFC 2865).
- **Per-NAS shared secret.** Each request is keyed to the `nas` row whose
  `ip_address` matches the source. `RADIUS_SERVER_SECRET` is only a fallback for a
  *matched* NAS that has no `secret` set — it never makes an unknown IP a valid
  client.
- **Constant-time PAP/CHAP/Message-Authenticator checks.** A NAS that sends a
  Message-Authenticator (RFC 9579 / Blast-RADIUS hardening) is verified, and blank
  stored passwords never authenticate.

## Current limitations (embedded server)

- Reply policy is **bandwidth-only** (Mikrotik-Rate-Limit / WISPr bandwidth).
  Session-Timeout / Idle-Timeout / VLAN attributes are emitted by the external
  FreeRADIUS sync path but not yet by the embedded server.
- Vendor reply-attribute support: **MikroTik**, **Cisco**, **generic (WISPr)**. A
  plan with `radius_vendor='juniper'` is logged (no policy emitted) rather than
  silently uncapped.
- **IPv6 accounting** (delegated prefix, v6 octet counters) is not yet captured by
  the embedded accounting listener; IPv4 accounting is.
- No built-in per-source rate limiting — rely on the firewall guidance above.

## Testing without a PPPoE client

The server answers standard RADIUS, so you can test it with `radtest`/`radclient`
or any RADIUS test tool (no router or CPE required):

```
radtest <username> <password> <fireisp-host>:1812 0 <shared-secret>
```

Expect `Access-Accept` with the policy attributes for a valid subscriber, or
`Access-Reject` otherwise. FireISP's own test suite exercises this end-to-end with
an in-process UDP round-trip.
