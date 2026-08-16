# Mexico SNII Infrastructure Reporting

> **Preparation and evidence workflow only.** This document is an engineering
> and operating reference, not legal advice, a filing service, or a statement
> that an operator complies with Mexican law. The operator and its authorized
> counsel must decide whether the SNII duties apply to a particular legal
> entity, title, service, network, asset, and reporting period.

## Purpose and legal boundary

The *Sistema Nacional de Información de Infraestructura* (SNII) is the
restricted, georeferenced national infrastructure inventory addressed by
Articles 174–181 of the current *Ley en Materia de Telecomunicaciones y
Radiodifusión* (LMTR). Articles 175–176 concern applicable active
infrastructure and transmission media; Articles 177–178 concern applicable
passive infrastructure and rights of way. Articles 179–181 address public and
private sites. The LMTR's Twenty-Eighth Transitory provision preserves prior
rules only to the extent they do not conflict with the current law.

FireISP's SNII module is designed to:

- maintain an organization-specific applicability decision and reporting
  profile;
- discover possible records from the MX organization's operational inventory
  without automatically declaring them reportable;
- require an explicit, evidenced classification and approval for every
  candidate;
- structurally validate approved records through the bundled historical
  adapter only after an operator records a dated, hashed reconciliation of that
  adapter against the pinned current Ventanilla package;
- freeze a full-load reporting snapshot and deterministically generate
  versioned CSV or KML preparation files for operator validation;
- preserve file hashes, review provenance, filing events, prevention/correction
  events, and acceptance evidence; and
- fail closed when the data, tenant boundary, source version, or approval is
  incomplete.

FireISP does **not** log into the CRT Ventanilla Electrónica, submit a package,
decide legal applicability, or infer authority acceptance. Generating or
downloading a preparation artifact never changes a report to `submitted` or
`accepted`. Those states require a separate operator-recorded event and its
external evidence reference.

## Governing sources and historical reference adapter

The public 2024 IFT template and dictionary bundle is now a historical archive,
not a guarantee of the current upload contract. The current CRT procedure
directs operators to obtain the live object templates through the authenticated
Ventanilla. FireISP therefore treats the bundled 2024 adapter as a
bootstrap/reference only and blocks a ready package until the operator records
the independently reviewed current Ventanilla template, dictionary, and Annex
versions, HTTPS source references, and SHA-256 values, plus a dated adapter
reconciliation reference and SHA-256. The current Ventanilla bytes are not
parsed into a generator automatically. Before every filing
window, the operator must check whether the CRT has changed any template,
dictionary, catalogue, instruction, or filing channel.

- [Current LMTR, Articles 174–181](https://www.diputados.gob.mx/LeyesBiblio/pdf/LMTR.pdf)
- [Original SNII lineamientos (DOF, 28 October 2019)](https://dof.gob.mx/nota_detalle_popup.php?codigo=5576710)
- [2024 SNII modification (DOF, 14 February 2024)](https://dof.gob.mx/nota_detalle_popup.php?codigo=5718337)
- [SNII calendar and procedure modification (DOF, 18 September 2024)](https://dof.gob.mx/nota_detalle_popup.php?codigo=5739174)
- [Current CRT SNII initial-delivery instructions](https://portal.crt.gob.mx/docs-bin/informes-difusion/entrega-inicial-de-informacion-al-sistema-nacional-de-informacion-de-infraestructura.pdf)
- [Current CRT SNII update instructions](https://portal.crt.gob.mx/docs-bin/informes-difusion/actualizacion-de-la-informacion-al-sistema-nacional-de-informacion-de-infraestructura.pdf)
- [Historical public object-template archive](https://www.ift.org.mx/industria/plantillas-de-descarga-disponibles-para-snii)
- [Historical public data-dictionary archive](https://www.ift.org.mx/industria/diccionarios-de-datos)
- [Official loader notes](https://www.ift.org.mx/sites/default/files/contenidogeneral/industria/notascargasniiv2.pdf)

The archived templates still carry former IFT branding. FireISP records the
authority code, separate source URLs and hashes, dictionary/template/Annex
versions, review actor/date, and external applicability decision instead of
treating the archive or its embedded agency name as proof of the current upload
contract, institutional position, or legal applicability.

## What is and is not an infrastructure candidate

Operational inventory is not a government filing. A site, device, link, or
fiber record first becomes an **unreviewed candidate**. It enters a frozen SNII
snapshot only after a reviewer maps it to an exact official object type,
completes all required fields, and a separate authorized approver confirms the
decision.

Likely candidates, subject to the operator's real topology and applicability
decision, include towers, transmission sites, central/aggregation facilities,
OLTs, microwave antennas and links, access or transport fiber, poles, ducts,
manholes, and rights of way. Ownership can be owned, leased, or third-party;
third-party use is not an automatic exclusion.

The following are never auto-included:

- subscriber or contract-linked equipment;
- indoor or outdoor CPE, ONUs, customer drops, and networks beyond the terminal
  connection;
- generic routers or Ethernet switches guessed to be an official `Central`,
  `Switch ATM`, or `Switch OTN` object;
- organization-null legacy records;
- demo, synthetic, documentation, or test assets; and
- arbitrary operational notes, SNMP secrets, credentials, management
  addresses, client data, or unapproved JSON properties.

An inactive, maintenance, decommissioned, leased, or soft-deleted asset is not
automatically outside scope. Its reporting treatment requires a documented
decision because full-load and update duties can depend on the reporting
period and the operator's possession or use of the infrastructure.

## Review and full-load workflow

1. **Record applicability.** Set the profile to `applicable` or
   `not_applicable` only with an external counsel/compliance decision reference,
   reviewer, date, current title/authorization context (including its status),
   electronic folio, and pinned official source version. FireISP preserves a
   whitelisted snapshot and SHA-256 of a linked concession title; a later title
   edit or deletion forces a fresh review. Locale `MX` alone is never enough.
2. **Discover candidates.** Refresh strictly from the active organization's
   tenant database. Discovery does not approve or file anything.
3. **Classify every candidate.** Leave it `unreviewed`, map and classify it as
   `included`, or explicitly exclude it with a controlled reason and evidence
   reference. Source changes invalidate the prior review.
4. **Approve the classification.** Approval records a separate actor and time
   and is bound to both the operational-source SHA-256 and the complete
   classification SHA-256 (decision, type, overrides, evidence reference, and
   reviewed payload).
   Unreviewed, stale, cross-tenant, incomplete, duplicate, or unsupported
   records block the reporting snapshot.
5. **Create a full-load snapshot.** Each reporting batch contains the complete
   applicable object population for that period, not a delta from the previous
   batch. Its immutable hash covers the filing period, title/folio snapshot,
   legal basis, all 39 per-object applicability and zero-population decisions,
   pinned template/dictionary/Annex sources, frozen payloads, source hashes,
   reviewers, and approvals.
6. **Generate preparation artifacts.** The reconciled versioned adapter preserves
   its pinned filename and field order. Point objects use CSV and linear/area
   objects use KML. Artifacts are generated deterministically and stored with
   SHA-256, byte size, MIME type, generator version, and source snapshot hash.
   Generation does not establish that the current Ventanilla will accept them;
   reconcile the adapter against the pinned live package first.
7. **Download and verify.** Sensitive downloads require an interactive,
   authorized session and a successful access-audit append. Responses are
   private/no-store attachments and include `X-Evidence-SHA256`. The browser
   verifies the received bytes before saving.
8. **File outside FireISP.** An authorized representative uses the official CRT
   channel. Record the external folio, exact local time with its matching IANA
   time zone, representative, and original response/submission evidence as one
   atomic immutable event. FireISP computes the evidence SHA-256 server-side;
   callers never supply or substitute that hash. Each evidence upload is
   limited to 10 MiB and must be PDF, XML, plain text, CSV, JPEG, or PNG; the
   server verifies the filename, media type, and file signature before storing
   the original bytes.
9. **Record prevention, correction, and acceptance separately.** Preserve every
   attempt. A correction is a new version/full load; it never overwrites the
   rejected or prevented package. An operator-entered acceptance record remains
   labelled operator-recorded unless the original acceptance evidence is also
   preserved and verified.

## Timing

The 2024 update establishes complete loads rather than deltas. Current filing
windows are determined by the final digit of the operator's electronic folio:

| Final digit | First window | Second window |
|---|---|---|
| 0 or 9 | January–February | July–August |
| 1 or 8 | February–March | August–September |
| 2 or 7 | March–April | September–October |
| 3 or 6 | April–May | October–November |
| 4 or 5 | May–June | November–December |

The current CRT initial-delivery guidance lists three timing branches: the
electronic-folio calendar for an ordinary initial load; 120 business days from
the effective act when an entity acquires concessionaire or authorized status;
and 180 business days from effectiveness for new concessions, authorizations,
or modifications. The operator must determine which branch applies to its
facts. The update procedure separately describes automated validation, an
error/prevention notice within two business days, a five-business-day
correction reload, and an acceptance notice within five business days after a
valid load. These periods are operational prompts, not FireISP legal
calculations; the operator must revalidate the current source and its own facts.

## Security and tenant isolation

SNII data contains exact infrastructure location and is treated as restricted.
The module therefore uses the following boundary:

- all profile, registry, snapshot, artifact, and filing records have a non-null
  organization and are read from the selected tenant database;
- source ownership is checked with an exact organization predicate; global or
  organization-null legacy inventory is excluded;
- an MX locale check is resolved from the authoritative control-plane record;
- a missing isolated-tenant migration or tenant database is an explicit
  readiness failure, never a fallback to another database;
- classification, approval, generation, export, filing, and acceptance use
  separate permissions;
- generic view access returns metadata rather than reviewed coordinate payloads;
  exact classification detail requires review or approval authority, artifact
  bytes require export authority, and original filing-evidence bytes require
  the dedicated evidence permission;
- sensitive actions reject API-token sessions and exact-coordinate downloads
  do not rely on an install-wide implicit bypass;
- application logs and primary audit records contain object IDs, hashes, actor,
  outcome, and timestamps—not artifact bytes or exact coordinates; and
- approved snapshots, artifacts, filing events, and access events are
  application- and database-protected against update or deletion.

Deployment controls still matter. Use TLS, MFA/step-up for authorized
reviewers, encryption at rest and in backups, restricted administrative access,
malware scanning for uploaded evidence, tested restore procedures, and an
approved records schedule. FireISP does not infer Mexico residency from locale
or claim that a self-entered storage-country field proves the storage,
replication, backup, processor, support, and export boundary.

## Release and filing checklist

- [ ] The organization's legal entity, title/authorization, services, and SNII
      applicability have a dated external decision reference; the current
      concession snapshot still matches its recorded SHA-256.
- [ ] The electronic folio is distinct from the concession title number and its
      last digit produces the expected filing windows.
- [ ] The current authenticated Ventanilla template, dictionary, and Annex
      package was independently reviewed; its versions, references, and hashes
      were recorded after the source-review date. The public 2024 archive was
      not mistaken for the current upload contract.
- [ ] The historical/bootstrap adapter was explicitly reconciled to that live
      package; the dated reconciliation reference and SHA-256 are recorded and
      frozen into the batch and each generated artifact.
- [ ] The SNII migration is present in the shared or selected isolated tenant
      database; no tenant fallback occurred.
- [ ] Every candidate is reviewed; exclusions have reasons/evidence; included
      records have a separate approval; no source hash is stale.
- [ ] Customer CPE/ONU/drop records, organization-null records, and dummy/test
      records are absent from the snapshot.
- [ ] Required official fields, catalog spellings, units, identifiers, and
      geometries validate for every included object type.
- [ ] The batch is a full load for the applicable period and records any
      unsupported required object type as a blocking gap. Its approval hash
      binds the title/folio, filing context, legal decisions, source contracts,
      and frozen population.
- [ ] Generated artifact names and fields were reconciled against the pinned
      Ventanilla contract; SHA-256 values, byte sizes, and snapshot hashes were
      independently verified.
- [ ] Download/access audit succeeded before any bytes were released.
- [ ] The representative filed through the current official channel and
      recorded the external evidence separately from generation.
- [ ] Every prevention, correction, rejection, or acceptance event and original
      evidence is uploaded atomically, server-hashed, retained without
      overwriting an earlier attempt, and independently checksum-verified on
      download.
- [ ] Backup/restore, legal hold, approved retention, and evidence-integrity
      verification were rehearsed for both the tenant database and artifact
      storage.

## Change-management rule

Any change to the LMTR, SNII lineamientos, CRT instructions, template download,
data dictionary, catalogue value, filing channel, reporting window, operator
title, network technology, or supported source mapping reopens the requirement.
Update the source catalogue and requirement record in
[`legal-regulatory-register.md`](legal-regulatory-register.md), add a new
versioned adapter instead of mutating an accepted snapshot, and obtain fresh
operator approval before the next production package.
