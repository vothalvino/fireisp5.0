# Mexican Telecommunications Regulatory Compliance Reference

> **Operator and counsel review required.** This is an engineering reference,
> not legal advice and not a certification of compliance. The obligations attach
> to the concessionaire or authorized provider and the services and numbering it
> operates; selecting an `MX` organization in FireISP does not, by itself, make a
> deployment compliant.

## 1. Current governing law

The current federal telecommunications statute is the **Ley en Materia de
Telecomunicaciones y Radiodifusión (LMTR)**, published on 16 July 2025. The
former *Ley Federal de Telecomunicaciones y Radiodifusión* (LFTR) was abrogated
after the CRT-plenary transition was completed in October 2025.

Primary sources:

- [LMTR — current text, Cámara de Diputados](https://www.diputados.gob.mx/LeyesBiblio/pdf/LMTR.pdf)
- [LMTR decree — Diario Oficial de la Federación, 16 July 2025](https://dof.gob.mx/nota_detalle.php?codigo=5763167&fecha=16/07/2025)
- [IFT collaboration-with-justice lineamientos, consolidated 7 February 2025](https://www.ift.org.mx/sites/default/files/lcmsj_07-02-2025.pdf)
- [CRT confirmation of the 2025 transition](https://www.gob.mx/crt/prensa/comunicados-de-prensa-411100?idiom=es)
- [Código Nacional de Procedimientos Penales — current text](https://www.diputados.gob.mx/LeyesBiblio/pdf/CNPP.pdf)
- [LFPDPPP — current text](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf)

The LMTR's Twenty-Eighth Transitory provision preserves prior IFT rules to the
extent they do not conflict with the new law. Operators should have Mexican
telecommunications counsel confirm which lineamientos apply to their exact
concession, authorization, numbering resources, and services.

FireISP supports concession-title management (`concession_titles`), regulatory
filings (`regulatory_filings`), and statistical reports
(`ift_statistical_reports`). These tools support an operator's process; they do
not replace regulatory registration, technical facilities, trained personnel,
or counsel review.

## 2. Communications metadata and authority requests

### Written authority is required

LMTR Article 182 requires a written, legally grounded and reasoned command from
a competent authority. That is not blanket authority: the underlying law still
controls. CNPP Article 303 generally provides for control-judge authorization
for covered retained mobile-line data, with a limited emergency prosecutor path
and judicial review within 48 hours. Article 183(III) limits delivery to
designated security and justice authorities acting within their powers and
prohibits use of the retained statutory data for purposes outside that chapter.

Consequently, retained communications metadata must not become a general
customer-support or marketing analytics dataset. Access should be limited to
specifically authorized legal-response personnel, tied to a validated request,
and recorded in an access/export audit.

### Express retention scope

Article 183(II) requires covered concessionaires and authorized providers to
retain a record of communications made from terminal equipment or a line using
owned or leased numbering. The enumerated fields include subscriber identity
and address, communication type, origin/destination information for mobile
communications (including the destination number), date, time and duration,
activation/cell data, device/subscriber identifiers when applicable, and
telephone-line geolocation.

The IFT adopting agreement identifies the records with national-numbering and
ITU-T E.164 resources, while Lineamiento Décimo Cuarto describes fixed-service
origin and destination **numbers**. The current official texts do **not expressly enumerate**
fixed-broadband destination IP addresses, source/destination ports, NAT/CGNAT
tuples, URL/domain history, packet contents, or a record of every Internet flow.

FireISP therefore distinguishes the statutory question from two operational
controls:

1. **Subscriber accounting sessions and normalized RADIUS lifecycle evidence.** These associate
   a subscriber, assigned IP, NAS, current session state, duration and traffic
   counters. Separate evidence rows preserve selected lifecycle milestones
   (Start, first Interim transition, Stop, and a corrected final Stop), rather
   than every heartbeat. They support network operations and evidence of address
   assignment.
2. **Privacy-minimal CGNAT attribution bindings.** When an operator shares a
   public address between subscribers, a binding can associate a public source
   address, translated source port or allocated port range, transport protocol,
   and exact UTC interval with the private subscriber tuple and RADIUS access
   session. The current official texts do not expressly enumerate CGNAT fields,
   so FireISP does not label this control a universal Article 183 requirement.
   It is enabled only when the operator and counsel document that it is needed
   for the operator's services and lawful-response duties.

For a directly assigned public IPv4 address, attribution uses a certain RADIUS
evidence interval: the first exact-IP lifecycle event and its server receipt
bound the start, and both the Stop/latest accounting event and its receipt bound
the end. Public address plus an exact UTC instant is enough within those bounds,
and the request omits source port and transport protocol because they are not
discriminators. For a public address shared by
CGNAT, the lookup also requires the translated source port and transport
protocol so concurrent subscribers are not conflated.

CGNAT bindings deliberately omit destination addresses and ports, URLs,
domains, DNS data, packet payload, and application content. FireISP does not
derive the bindings from RADIUS or decode RouterOS/NetFlow/IPFIX/syslog on the
web server. An operator-controlled collector must receive authoritative
translation or port-allocation events from every CGNAT path, normalize only the
minimum binding fields, and submit them through the tenant-bound ingest API.

These operational datasets are not the statutory Article 183 response vault by
default. A direct-public-IP or CGNAT lookup establishes which subscriber account
and access session held the queried source address/tuple at the supplied time
only when exactly one covered session/binding matches. It does not prove which
human used the connection, what that person did, or which destination they
contacted. Zero or overlapping matches must be reported as unavailable or
ambiguous, never guessed.

When an operator determines that a subset is a covered Article 183 record,
access to that retained copy must occur through the designated legal-response
process, linked to a validated same-organization `gov_data_requests` case and
limited to authorized legal-response personnel. Routine operational access
needs its own documented purpose and must not be represented as Article 183 use.

### Retention and delivery

For the Article 183(II) records, the LMTR establishes:

- first 12 months in systems that allow electronic real-time consultation and
  delivery to competent authorities;
- a further 12 months in electronic storage, deliverable within 48 hours of a
  notified request; and
- technical protection against unauthorized manipulation, access, destruction,
  alteration, or cancellation, with specifically authorized personnel.

Article 183(III) otherwise states a 24-hour maximum response unless a different
express rule or order applies. Article 183 also requires a responsible function
available 24/7/365.

FireISP's default RADIUS-accounting policy is 24 months, but that product policy
does not prove that every RADIUS session is a covered numbered communication.
Operators must separately document the operational/privacy basis and approved
retention for CGNAT attribution records; they must not be treated as mandatory
merely because an organization is marked `MX`. Valid preservation orders or
legal holds can require a specifically identified record set to remain beyond
its ordinary deletion date. A `gov_data_requests` case does not itself suspend
rolling deletion: the approved hold must be activated before responsive records
expire and released or reviewed when its authority ends.

The product retention variable is installation-wide, not an organization-level
setting. One shared FireISP installation may enable collection only when that
same period is approved for every enabled tenant. Operators that require
different tenant schedules need separate deployments until per-organization
retention is implemented. Ordinary CGNAT retention is capped at 24 calendar
months as a product minimization control; only evidence under an active,
case-scoped preservation hold may remain longer.

### Data location

Lineamiento Décimo Cuarto requires processing and storage systems for the
covered Chapter IV database to be located in Mexico. Cloud backups, replicas,
support access, and exports of that database are part of the boundary.
Operational CGNAT attribution systems are not automatically brought into that
telecom rule, but still require a separate LFPDPPP residency/transfer
assessment.

## 3. Privacy and security

The **Ley Federal de Protección de Datos Personales en Posesión de los
Particulares (LFPDPPP)** applies to private-sector personal-data processing.
Operators remain responsible for an adequate privacy notice, applicable legal
basis, data minimization, safeguards, confidentiality, processor agreements,
data-subject rights, breach handling, blocking/suppression, and lawful transfers.

FireISP provides supporting controls including:

- `subscriber_consents` and versioned privacy-notice records;
- `dsar_requests` and client data export workflows;
- `data_residency_config` for documented localization decisions;
- `gov_data_requests` for legal-request case management;
- `audit_logs` and `report_access_logs` for operator access/export evidence; and
- organization-scoped permissions for session and CGNAT-attribution records.

These controls are not a substitute for operational safeguards. In particular,
operators should require strong authentication, least privilege, encrypted
transport and storage, key rotation, monitored exports, tested restoration, and
separation between normal network operations and legal-response access.

## 4. Criminal-law constraints

The *Código Penal Federal* addresses intervention without competent judicial
authority (Article 177), disclosure of secrets or private-intervention material
(Articles 210–211 Bis), and unauthorized access/copying in protected systems
(Article 211 bis 1). Lawful-interception or retained-data delivery must occur
only on valid authority and through the operator's approved legal-response
procedure. See the [current Código Penal Federal](https://www.diputados.gob.mx/LeyesBiblio/pdf/CPF.pdf).

FireISP's `gov_data_requests` records and row hash help document that procedure.
The hash is a consistency marker, not an immutable chain or protection against
a privileged database administrator. These records also do not decide whether
a request is legally valid; the operator's authorized legal team must do so.

## 5. Regulatory institutions

- **IFT:** extinct former autonomous regulator. Its non-conflicting instruments
  continue under Transitory 28 until replaced; this is no longer an institutional
  transition period.
- **ATDT:** federal digital-transformation and telecommunications-policy body.
- **CRT:** telecommunications regulatory commission established in the 2025
  framework.

The `concession_titles.regulatory_body` field supports legacy IFT and current
CRT records. `gov_data_requests.authority_name` records the actual requesting
authority rather than inferring authority from the organization locale.

## 6. CFDI 4.0

SAT fiscal obligations are separate from communications-data retention. FireISP
supports CFDI workflows through `cfdi_documents`, `cfdi_conceptos`,
`cfdi_payment_complements`, `csd_certificates`, `/cfdi/*`, MX client fiscal
profiles, public invoices, and SAT catalogs. Operators remain responsible for
valid CSDs, PAC configuration, tax treatment, and statutory fiscal retention.

## Deployment checklist

- Confirm the legal entity's concession/authorization, covered services, and
  numbering resources with Mexican telecom counsel.
- Confirm which Article 183 data applies to the operator's numbered services and
  whether privacy-minimal CGNAT attribution is separately justified; document
  each purpose, field set, access group, and retention rule.
- Keep covered Article 183 processing and storage in Mexico.
- Configure real RADIUS Start/Interim/Stop accounting and verify freshness,
  subscriber attribution, duration, assigned IP, and stop handling.
- If CGNAT attribution is approved, configure every translator or port-block
  allocator to send authoritative binding/allocation events to an external
  normalizer. Include public address, translated port or range, protocol, exact
  UTC allocation/release times, private tuple, gateway/exporter identity, a
  stable source event identifier, and the canonical `session_instance_id`
  returned by the tenant RADIUS ingest; never submit a destination or content
  field or guess a session from a reused private address.
- Establish the v1 collector baseline by draining/reconciling each covered pool
  to a provably empty starting point, retaining the external change/snapshot
  evidence reference, and starting a fresh boot/sequence epoch at 0 or 1.
  FireISP does not import a nonempty historical snapshot; pre-baseline
  allocations are unavailable and rejected rather than backfilled.
- Verify that each translator assigns a public IP + source port + protocol to at
  most one subscriber at an instant, independently of destination. If it reuses
  that tuple across subscribers and only the remote destination disambiguates
  them, mark the mode unsupported; configure exclusive ports/blocks or obtain a
  separate privacy/legal design instead of collecting destinations.
- Keep CGNAT and RADIUS clocks synchronized, monitor source sequence gaps,
  rejected batches and collector lag, and document every public pool/egress path
  covered. Record clock offset as raw device time minus UTC; FireISP's certain
  feed horizon is corrected device time minus declared uncertainty. V1 has no
  heartbeat/checkpoint, so even an open long-lived port block becomes
  unavailable when authoritative allocate/release traffic no longer advances a
  fresh certain horizon. Prefer deterministic exclusive port blocks. Load-test
  the actual binding-event rate and queue retries safely; high-rate
  per-connection mappings require a durable queue and dedicated append/search
  store rather than the synchronous application database.
- Treat a sequence/loss/metadata incident as unresolved for that exporter epoch.
  Reconcile against the authoritative translator, retire the affected identity,
  and begin a newly versioned exporter identity/epoch; do not clear cumulative
  counters or present old-epoch evidence as healthy.
- Treat every device/normalizer boot transition as a continuity break. A new or
  returning boot identifier never silently resumes the declaration: drain and
  reconcile the pool, establish a new provably empty baseline, and begin a
  newly versioned exporter identity/configuration epoch.
- If a device emits destinations in its raw format, discard them in memory at
  the normalizer boundary; do not put raw lines/bodies in queues, dead letters,
  logs, crash reports or backups.
- Test direct-public attribution by public IP plus UTC instant against RADIUS
  session evidence. The lower boundary is the later of the first exact-IP
  lifecycle event and its server receipt; the upper boundary is the earlier of
  the Stop event and receipt, or the latest fresh active-session event and
  receipt. Separately test shared-CGNAT attribution by public IP, translated
  source port, protocol, and UTC instant. Accept only a unique result linked to
  a subscriber access session; surface no match, overlap, clock uncertainty,
  source gaps, stale horizons, and incomplete coverage explicitly.
- Restrict legal records and exports to designated personnel and audit access.
- Verify the configured RADIUS and CGNAT-attribution retention jobs,
  isolated-database coverage, backups, legal holds, and deletion/suppression
  procedure against the operator's approved data schedule.
- Perform a documented retrieval exercise for both the first and second
  12-month periods.
- Do not claim compliance until counsel and the operator's responsible area
  approve the end-to-end process.
