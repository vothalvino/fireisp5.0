# FireISP Legal and Government Regulatory Touchpoint Register

> **Engineering and operational traceability reference only.** This register is
> not legal advice, not a legal opinion, not a certification, and not a conclusion that
> FireISP or any installation complies with law. Applicability and legal
> interpretation must be decided for each operator, service, jurisdiction, and
> deployment by authorized legal counsel. Selecting a locale, enabling a
> feature, or marking a product control as available neither creates nor
> satisfies a legal obligation.

This is the central index for legal and government-regulatory subjects known to
touch FireISP. It deliberately links to specialist documents instead of copying
all of their operational detail. Its job is to make changes traceable: when a
law, rule, service, data field, integration, or deployment changes, the affected
requirement IDs show what must be reassessed.

## Navigation

- [Document control](#document-control)
- [Scope and exclusions](#scope-and-exclusions)
- [Four layers of truth](#four-layers-of-truth)
- [Controlled statuses](#controlled-statuses)
- [Official source catalog](#official-source-catalog)
- [Requirement index](#requirement-index)
- [Detailed requirement records](#detailed-requirement-records)
- [Known gap and exception register](#known-gap-and-exception-register)
- [Acceptance-evidence minimums](#acceptance-evidence-minimums)
- [Legal change workflow](#legal-change-workflow)
- [Template for a new or revised record](#template-for-a-new-or-revised-record)
- [Related FireISP documents](#related-fireisp-documents)
- [Maintenance rules](#maintenance-rules)

## Document control

| Field | Value |
|---|---|
| Register ID | `FIREISP-LEGAL-REGISTER` |
| Register owner | Compliance engineering |
| Legal reviewer | Each deployment operator's authorized counsel |
| Operational approver | Each deployment operator's compliance owner |
| Status | Working reference; not approved legal advice |
| Version | 0.1 |
| Coverage cutoff | 2026-08-15 |
| Last full source review | 2026-08-15 |
| Next scheduled review | 2026-11-15 |
| Jurisdictions assessed | Mexico federal; EU/EEA privacy only where marked conditional |
| Product scope | FireISP repository and documented first-party deployment controls |
| Evidence scope | Product evidence only; tenant deployment evidence remains outside Git |

The owner must review this register at least quarterly even if no legal-change
alert is received. A review date is not proof that counsel approved an entry.

## Scope and exclusions

The initial register covers telecommunications, justice-authority requests,
subscriber session and IP attribution, privacy, tax invoicing, consumer
protection, electronic records, security evidence, AI data processing, and
conditional foreign privacy law.

It is **not an exhaustive catalog of every law** that can affect an ISP or
software operator. The following remain outside the assessed scope unless a
specific record below says otherwise:

- state and municipal law, permits, construction, rights of way, civil
  protection, environmental duties, and local taxes;
- operator-specific concession conditions, spectrum conditions, interconnection
  agreements, universal-service commitments, court judgments, and regulator
  orders not supplied to this project;
- corporate, competition, anti-corruption, anti-money-laundering, insurance,
  import/export, and public-procurement law;
- labor, payroll, social security, workplace safety, biometrics, and employee
  monitoring beyond the limited personal-data touchpoints recorded below;
- sector rules for banking, health, education, minors, government customers, or
  critical infrastructure when a particular operator enters those sectors;
- contractual and industry standards such as PCI DSS, ISO 27001, SOC 2, and
  customer security schedules, which are not government statutes merely because
  a contract requires them; and
- laws of countries other than Mexico, except the conditional EU/EEA entry.

Applicability is evaluated per legal entity and operator. It must not be
inferred from `organization.locale`, a customer's address, or a checked box in
[`isp-platform-features.md`](../isp-platform-features.md). A shared installation
can host organizations with different legal positions even when product
configuration is installation-wide.

## Four layers of truth

Every assessment must keep these layers separate:

1. **Official source:** what the legislature, official gazette, regulator, tax
   authority, or standards authority published.
2. **Applicability and interpretation:** a dated decision by the operator and
   its authorized counsel based on the operator's facts.
3. **Product behavior:** what FireISP code, schema, APIs, tests, and documentation
   do at a named commit or release.
4. **Deployment behavior:** how one installation is configured and operated,
   including contracts, processors, storage regions, backups, credentials,
   staffing, drills, exports, and retained evidence.

This register connects the four layers; it does not replace any of them.
Secondary articles and vendor summaries may identify a change, but only an
official primary source belongs in the source catalog. Legal opinions, request
documents, subscriber identities, credentials, case evidence, and privileged
material must never be committed to Git. Store only a restricted external
decision or evidence reference.

## Controlled statuses

### Applicability status vocabulary

| Status | Meaning |
|---|---|
| `UNASSESSED` | No operator-specific legal decision exists. Never treat as low risk. |
| `CONDITIONAL` | Likely depends on stated facts, service, title, data, or jurisdiction. |
| `APPLICABLE` | Operator/counsel determined it applies; an external decision reference is required. |
| `NOT_APPLICABLE` | Operator/counsel determined it does not apply; an external decision reference is required. |
| `SUPERSEDED` | Replaced or historical; preserve the record and point to its successor. |

### Product posture vocabulary

| Status | Meaning |
|---|---|
| `CAPABILITY_AVAILABLE` | An implemented and tested control exists; it may still be legally insufficient. |
| `PARTIAL` | Some required workflow or evidence is supported, with stated gaps. |
| `NOT_SUPPORTED` | FireISP does not provide the capability. |
| `OPERATOR_ONLY` | The duty is organizational, contractual, filing, or external-system work. |
| `NOT_ASSESSED` | Product support has not been mapped. |

### Deployment validation vocabulary

| Status | Meaning |
|---|---|
| `NOT_EVALUATED` | No deployment evidence has been reviewed. |
| `GAP` | A known product or deployment deficiency exists. |
| `IMPLEMENTING` | Remediation is underway but not validated. |
| `READY_FOR_VALIDATION` | Product/operator controls are ready for independent validation. |
| `VALIDATED` | Named evidence was reviewed for one deployment and period. |
| `ACCEPTED_RISK` | An authorized owner accepted a documented residual risk until an expiry date. |
| `NOT_APPLICABLE` | Operator/counsel decision says the deployment is outside scope. |

### Risk status vocabulary

Risk severity is `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `MONITOR`, or
`UNASSESSED`. “Resolved” means only that a specific recorded gap has evidence;
it never certifies the whole product or deployment. Risk acceptance requires an
authorized owner, rationale, expiry, and review date and cannot authorize
conduct known to be unlawful.

## Official source catalog

All sources below were last verified on **2026-08-15**. “Current” means the
official publisher presented the source as current on that date; it is not an
operator-specific applicability conclusion.

| Source ID | Instrument or monitor | Status at verification | Official source | Change trigger |
|---|---|---|---|---|
| `SRC-MX-LMTR` | Ley en Materia de Telecomunicaciones y Radiodifusión | Current new law, published 2025-07-16; no later reform listed | [Cámara de Diputados — LMTR](https://www.diputados.gob.mx/LeyesBiblio/pdf/LMTR.pdf) | Reform, court ruling, concession/service/numbering change |
| `SRC-MX-LCMSJ` | Lineamientos de Colaboración en Materia de Seguridad y Justicia | IFT instrument amended 2025-02-07; preserved only insofar as compatible under LMTR Transitory Twenty-Eighth | [official integrated text](https://www.ift.org.mx/sites/default/files/lcmsj_07-02-2025.pdf), [2025 DOF amendment](https://dof.gob.mx/abrirPDF.php?anio=2025&archivo=07022025-MAT.pdf&repo=repositorio%2F) | CRT replacement/amendment, authentication transition, telephony/numbering change |
| `SRC-MX-CNPP` | Código Nacional de Procedimientos Penales, including Article 303 | Current; latest reform shown 2025-11-28 | [Cámara de Diputados — CNPP](https://www.diputados.gob.mx/LeyesBiblio/pdf/CNPP.pdf) | Article 303 reform or controlling judgment |
| `SRC-MX-CPF` | Código Penal Federal | Current; latest reform shown 2026-03-13 | [Cámara de Diputados — CPF](https://www.diputados.gob.mx/LeyesBiblio/pdf/CPF.pdf) | Relevant criminal-law reform or judgment |
| `SRC-MX-LFPDPPP` | Ley Federal de Protección de Datos Personales en Posesión de los Particulares | Current new law, published 2025-03-20; latest reform shown 2025-11-14 | [Cámara de Diputados — LFPDPPP](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf) | Reform, authority guidance, new purpose/data/vendor/incident |
| `SRC-MX-RLFPDPPP` | Reglamento de la former privacy statute | Still listed as current, but retains old-law/INAI terms; compatibility with the 2025 law requires counsel review | [official regulation](https://www.diputados.gob.mx/LeyesBiblio/regley/Reg_LFPDPPP.pdf), [regulation catalog](https://www.diputados.gob.mx/LeyesBiblio/regla.htm) | Replacement, harmonization, authority guidance |
| `SRC-MX-CFF` | Código Fiscal de la Federación | Current; latest reform shown 2026-04-09 | [Cámara de Diputados — CFF](https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf) | CFF reform or fiscal-year rollover |
| `SRC-MX-RMF` | Resolución Miscelánea Fiscal and modifications | 2026 compilation changes during the year; anticipatory versions are not final DOF text | [SAT — RMF 2026 register](https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/normatividad_rmf_rgce2026.html), [effective compilation through the First Modification](https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/compiladas/Compilado_Primera_Modificacion_a_la-Resolucion_Miscelanea_Fiscal_para_2026.pdf) | Every modification, annex, anticipatory version, and annual rollover |
| `SRC-MX-CFDI` | CFDI 4.0, Anexo 20, complements, catalogs, and schemas | CFDI 4.0 is the valid version identified by SAT; technical artifacts are independently versioned | [SAT — Anexo 20](https://wwwmatnp.sat.gob.mx/consultas/35025/formato-de-factura-electronica-%28anexo-20%29), [SAT — cancellation](https://www.sat.gob.mx/minisitio/Factura/cancela_procesocancelacion.htm) | Catalog, XSD, complement, guide, cancellation, or PAC change |
| `SRC-MX-LFPC` | Ley Federal de Protección al Consumidor | Current; latest reform shown 2025-12-12; monetary update 2025-12-23 | [Cámara de Diputados — LFPC](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPC.pdf) | Reform, monetary update, consumer workflow change |
| `SRC-MX-NOM184` | NOM-184-SCFI-2018 for telecommunications providers | Officially vigente; published 2019-03-08, effective 2019-09-04, confirmed in 2024 review; modification is on the 2026 work program | [DOF publication](https://www.dof.gob.mx/nota_detalle.php?codigo=5552286&fecha=08/03/2019), [official status](https://platiica.economia.gob.mx/normalizacion/nom-184-scfi-2018/), [official NOM PDF](https://platiica.economia.gob.mx/wp-content/uploads/sites/2/PDF_Normas_Publicas/NOM-184-SCFI-2018.pdf) | Final modification, contract/price/cancellation/complaint change |
| `SRC-MX-RPCA` | PROFECO Registro Público de Contratos de Adhesión in telecommunications | Current public register | [PROFECO — telecom contracts](https://rpca.profeco.gob.mx/telecomunicaciones.html) | Contract adoption/change, registration-status change |
| `SRC-MX-CCOM` | Código de Comercio | Current; latest reform shown 2025-11-14; amounts updated 2026-02-18 | [Cámara de Diputados — Código de Comercio](https://www.diputados.gob.mx/LeyesBiblio/pdf/CCom.pdf) | Record/signature/archive or procedural reform |
| `SRC-MX-NOM151` | NOM-151-SCFI-2016 for conservation of data messages and digitization | Officially vigente; published 2017-03-30; modification recommended but no replacement verified | [official NOM text](https://www.dof.gob.mx/nota_detalle.php?codigo=5478024&fecha=30/03/2017) | Final replacement, PSC integration, archive/signature change |
| `SRC-MX-LFEA` | Ley de Firma Electrónica Avanzada | Current; latest reform shown 2025-11-14; applies to the acts in its own scope | [Cámara de Diputados — LFEA](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFEA.pdf) | Government e-filing/signature workflow change |
| `SRC-EU-GDPR` | Regulation (EU) 2016/679 | Conditional foreign-law source; applicability not inferred from locale | [EUR-Lex — GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj) | EU service/data-subject/establishment or adequacy/transfer change |
| `MON-MX-DOF` | Diario Oficial de la Federación | Primary publication monitor | [DOF](https://www.dof.gob.mx/) | Weekly monitor and alert-driven review |
| `MON-MX-CAMARA` | Federal current-law and reform index | Consolidated-law monitor | [current laws](https://www.diputados.gob.mx/LeyesBiblio/index.htm), [latest updates](https://www.diputados.gob.mx/LeyesBiblio/actual/ultima.htm) | Monthly monitor and before each full review |
| `MON-MX-CRT` | CRT consultations and Pleno decisions | Current telecommunications-regulator monitor | [consultations](https://portal.crt.gob.mx/consultapublica), [Pleno decisions](https://portal.crt.gob.mx/BuscadorSesionesPleno/Buscar) | Weekly monitor while proposals affect an operator |

The former *Ley Federal de Telecomunicaciones y Radiodifusión* and its Article
190 are historical sources only after the LMTR transition. A legacy reference
may remain relevant to conduct or proceedings from its operative period, but it
must not be presented as the current source of a new duty. The CNPP's compiled
cross-reference to former LFTR Article 190 does not by itself revive that law.

## Requirement index

The initial statuses below describe the repository-wide baseline. A tenant or
operator must maintain its own applicability decision and deployment status.

| ID | Domain | Applicability | Product posture | Baseline deployment status | Risk | Owner | Next review |
|---|---|---|---|---|---|---|---|
| `MX-ORG-001` | Operator legal status, concessions, authorizations | `CONDITIONAL` | `PARTIAL` | `NOT_EVALUATED` | `HIGH` | Operator legal | 2026-11-15 |
| `MX-TEL-001` | Current telecom framework and transition | `CONDITIONAL` | `OPERATOR_ONLY` | `NOT_EVALUATED` | `HIGH` | Telecom counsel | 2026-11-15 |
| `MX-TEL-002` | Competent-authority request validation | `CONDITIONAL` | `PARTIAL` | `READY_FOR_VALIDATION` | `CRITICAL` | Legal response | 2026-11-15 |
| `MX-TEL-003` | Numbered-communications record retention/delivery | `CONDITIONAL` | `PARTIAL` | `NOT_EVALUATED` | `CRITICAL` | Legal response | 2026-11-15 |
| `MX-TEL-004` | Covered database location and access controls | `CONDITIONAL` | `PARTIAL` | `GAP` | `HIGH` | Security/privacy | 2026-11-15 |
| `MX-TEL-005` | Direct-public-IP and CGNAT attribution | `CONDITIONAL` | `CAPABILITY_AVAILABLE` | `READY_FOR_VALIDATION` | `HIGH` | Network compliance | 2026-11-15 |
| `MX-TEL-006` | Lawful interception and content collection | `CONDITIONAL` | `NOT_SUPPORTED` | `NOT_EVALUATED` | `CRITICAL` | Operator legal | 2026-11-15 |
| `MX-TEL-007` | Statistics, QoS, coverage, and periodic filings | `UNASSESSED` | `PARTIAL` | `GAP` | `HIGH` | Regulatory reporting | 2026-09-15 |
| `MX-TEL-008` | Numbering, portability, mobile-line identity | `CONDITIONAL` | `PARTIAL` | `NOT_EVALUATED` | `HIGH` | Regulatory reporting | 2026-11-15 |
| `MX-PRIV-001` | Privacy notice, purpose, consent, and minimization | `CONDITIONAL` | `PARTIAL` | `NOT_EVALUATED` | `HIGH` | Privacy owner | 2026-11-15 |
| `MX-PRIV-002` | ARCO/DSAR intake, deadlines, and fulfillment | `CONDITIONAL` | `PARTIAL` | `GAP` | `HIGH` | Privacy owner | 2026-09-15 |
| `MX-PRIV-003` | Security program and breach response | `CONDITIONAL` | `PARTIAL` | `GAP` | `CRITICAL` | Incident commander | 2026-09-15 |
| `MX-PRIV-004` | Processors, transfers, and data residency | `CONDITIONAL` | `PARTIAL` | `GAP` | `HIGH` | Privacy/security | 2026-09-15 |
| `MX-PRIV-005` | Retention, blocking, suppression, and legal holds | `CONDITIONAL` | `PARTIAL` | `GAP` | `HIGH` | Records owner | 2026-09-15 |
| `MX-PRIV-006` | Marketing consent and do-not-contact preferences | `CONDITIONAL` | `PARTIAL` | `NOT_EVALUATED` | `MEDIUM` | Marketing/privacy | 2026-11-15 |
| `MX-PRIV-007` | Identity documents and high-risk identifiers | `CONDITIONAL` | `PARTIAL` | `GAP` | `CRITICAL` | Privacy/security | 2026-09-15 |
| `MX-TAX-001` | CFDI issue, stamping, XML, and CSD/PAC operation | `CONDITIONAL` | `CAPABILITY_AVAILABLE` | `NOT_EVALUATED` | `HIGH` | Fiscal owner | 2026-09-15 |
| `MX-TAX-002` | Cancellation, REP, global invoice, and SAT catalogs | `CONDITIONAL` | `CAPABILITY_AVAILABLE` | `NOT_EVALUATED` | `HIGH` | Fiscal owner | 2026-09-15 |
| `MX-TAX-003` | Fiscal and commercial record retention | `CONDITIONAL` | `PARTIAL` | `NOT_EVALUATED` | `HIGH` | Fiscal/records | 2026-11-15 |
| `MX-TAX-004` | IVA rates, exemptions, and border eligibility | `CONDITIONAL` | `PARTIAL` | `GAP` | `CRITICAL` | Fiscal owner | 2026-09-15 |
| `MX-CONS-001` | Registered telecom adhesion contracts | `CONDITIONAL` | `PARTIAL` | `NOT_EVALUATED` | `HIGH` | Consumer legal | 2026-09-15 |
| `MX-CONS-002` | Pricing, service changes, notices, cancellation | `CONDITIONAL` | `PARTIAL` | `GAP` | `HIGH` | Consumer operations | 2026-09-15 |
| `MX-CONS-003` | Complaints, bonuses, and PROFECO handling | `CONDITIONAL` | `PARTIAL` | `NOT_EVALUATED` | `MEDIUM` | Consumer operations | 2026-11-15 |
| `MX-CONS-004` | Accessibility and nondiscrimination claims | `CONDITIONAL` | `PARTIAL` | `GAP` | `MEDIUM` | Product/accessibility | 2026-11-15 |
| `MX-COMM-001` | Electronic contracts, messages, and signatures | `CONDITIONAL` | `PARTIAL` | `NOT_EVALUATED` | `HIGH` | Contracts owner | 2026-11-15 |
| `MX-COMM-002` | NOM-151 conservation/digitization evidence | `CONDITIONAL` | `NOT_SUPPORTED` | `NOT_EVALUATED` | `HIGH` | Records/counsel | 2026-11-15 |
| `MX-SEC-001` | Audit evidence, privileged access, and deletion | `CONDITIONAL` | `PARTIAL` | `GAP` | `HIGH` | Security | 2026-09-15 |
| `MX-SEC-002` | Backups, restoration, encryption, and deletion propagation | `CONDITIONAL` | `PARTIAL` | `GAP` | `HIGH` | Platform/security | 2026-09-15 |
| `MX-SEC-003` | Tenant isolation and separation of duties | `CONDITIONAL` | `CAPABILITY_AVAILABLE` | `NOT_EVALUATED` | `CRITICAL` | Security | 2026-11-15 |
| `MX-AI-001` | AI purposes, providers, prompts, and automated actions | `CONDITIONAL` | `PARTIAL` | `GAP` | `HIGH` | AI/privacy | 2026-09-15 |
| `MX-LAB-001` | Staff accounts, technician location, labor/payroll | `UNASSESSED` | `NOT_SUPPORTED` | `NOT_EVALUATED` | `HIGH` | Operator HR/legal | 2026-11-15 |
| `INTL-PRIV-001` | GDPR and other foreign privacy law | `CONDITIONAL` | `PARTIAL` | `NOT_EVALUATED` | `HIGH` | Operator privacy | 2026-11-15 |

## Detailed requirement records

The entries below are the initial engineering assessment. `Decision ref: none`
means counsel has not made an operator-specific decision.

### `MX-ORG-001` — Operator legal status, concessions, and authorizations

- **Sources:** `SRC-MX-LMTR`; operator title, authorization, registration, and
  service-specific orders.
- **Trigger:** offering a regulated telecommunications service, operating a
  public network, using spectrum/numbering, or acting as a commercializer.
- **FireISP support:** `concession_titles` and `regulatory_filings` are internal
  registers.
- **Limit:** FireISP does not decide the required title, obtain it, submit it, or
  prove that an entry is current or accepted.
- **Operator evidence:** current title/order, authorized services/territory,
  renewal calendar, named owner, and restricted counsel decision reference.
- **Decision ref:** none. Reassess on any entity, ownership, network, service,
  territory, spectrum, or numbering change.

### `MX-TEL-001` — Current framework and legacy transition

- **Sources:** `SRC-MX-LMTR`, `SRC-MX-LCMSJ`, `MON-MX-CRT`.
- **Rule:** use the LMTR as the current statute; preserve former LFTR references
  only for historical periods. Pre-LMTR instruments continue only to the extent
  the transition rule preserves them and they do not conflict.
- **FireISP support:** current overview in
  [`compliance-mexico.md`](compliance-mexico.md).
- **Operator action:** counsel must map the title and services to current CRT
  instruments; software cannot infer this from an `MX` locale.
- **Decision ref:** none. Review every CRT replacement or LMTR reform.

### `MX-TEL-002` — Government and justice-authority requests

- **Sources/provisions:** LMTR Articles 182–183, LCMSJ, CNPP Article 303, and
  relevant CPF provisions; `SRC-MX-LMTR`, `SRC-MX-LCMSJ`, `SRC-MX-CNPP`,
  `SRC-MX-CPF`.
- **FireISP support:** `gov_data_requests`, pending legal review, exact scoped
  tuple/time, case-gated attribution, evidence holds, access/export audit, and
  status transitions.
- **Limits:** authority and legal basis are operator-entered. FireISP does not
  authenticate an order, decide competence, require a judge in every fact
  pattern, attach the original restricted order, or replace legal review.
- **Operator evidence:** original order outside Git, validation checklist,
  reviewer identity, authority/deadline, scoped preservation, export checksum,
  delivery proof, and hold release.
- **Decision ref:** none. Access must remain purpose-limited and tenant scoped.

### `MX-TEL-003` — Numbered-communications retention and delivery

- **Sources/provisions:** LMTR Article 183 and the compatible parts of LCMSJ.
- **Trigger:** depends on the operator, service, terminal/line, and owned or
  leased numbering. The official texts do not expressly turn every fixed
  broadband RADIUS or CGNAT record into the statutory retained copy.
- **FireISP support:** RADIUS lifecycle projection/evidence, configurable
  retention, case register, holds, and restricted exports.
- **Limits:** product defaults are policies, not an applicability decision or
  proof of the two-stage 12+12-month operational availability requirements.
- **Operator evidence:** counsel-scoped field set, retention test, 12-month
  online retrieval test, additional-storage retrieval test, 24/7 response
  roster, and delivery drill.
- **Decision ref:** none.

### `MX-TEL-004` — Covered database location and authorized access

- **Sources:** LCMSJ Décimo Cuarto and LFPDPPP; exact telecom scope requires
  counsel review.
- **FireISP support:** `data_residency_config`, RBAC, tenant isolation, audit,
  deployment documentation, and backup configuration.
- **Gap:** residency status is currently a self-declared register; it does not
  verify primary storage, isolated databases, replicas, backups, queues,
  processors, support access, exports, or physical infrastructure.
- **Operator evidence:** current data-flow/processor map and technical evidence
  for every store and access path, including restoration locations.
- **Decision ref:** none.

### `MX-TEL-005` — Direct-public-IP and CGNAT attribution

- **Sources:** operator/counsel decision under `SRC-MX-LMTR`, `SRC-MX-LCMSJ`,
  `SRC-MX-LFPDPPP`; the statutes reviewed do not expressly enumerate a universal
  fixed-broadband CGNAT source-port retention duty.
- **FireISP support:** privacy-minimal public IP/source port or block/protocol,
  exact UTC allocation interval, subscriber/access-session correlation,
  exporter health, exact one/none/ambiguous lookup, case-gated export, and hold.
- **Limits:** no destination IP/port, URL, DNS, SNI, payload, DPI, or browsing
  history; no native RouterOS/NetFlow/IPFIX listener; no carrier-scale pipeline;
  no proof of a human or what the subscriber did. Quiet feeds fail closed.
- **Operator evidence:** approved purpose and retention, authoritative external
  collector on every CGNAT path, empty-baseline reconciliation, clock/sequence
  health, loss alarms, capacity test, recovery drill, and exact lookup drill.
- **Operational detail:**
  [`connection-logging-compliance.md`](connection-logging-compliance.md).

### `MX-TEL-006` — Lawful interception and content collection

- **Sources:** operator-specific law/order and `SRC-MX-LMTR`, `SRC-MX-CNPP`,
  `SRC-MX-CPF`.
- **Product posture:** `NOT_SUPPORTED`. FireISP is not an interception platform,
  traffic mirror, packet capture system, destination-flow logger, or authority
  delivery network.
- **Operator action:** obtain specialized counsel and independently approved
  systems/processes when a valid operator-specific duty exists.
- **Prohibition:** do not reinterpret CGNAT attribution or RADIUS accounting as
  content interception readiness.
- **Decision ref:** none.

### `MX-TEL-007` — Statistics, quality, coverage, and filings

- **Sources:** current LMTR/CRT rules, filing instructions, forms, title
  conditions, and `MON-MX-CRT`.
- **FireISP support:** `regulatory_filings`, `ift_statistical_reports`, QoS and
  coverage fields, and concession references are internal trackers.
- **Gap:** the field review in
  [`ift-statistical-report-schema-review.md`](ift-statistical-report-schema-review.md)
  cites repealed LFTR Article 175 and has not been revalidated against the
  current CRT instrument/form. No automatic filing or acceptance proof exists.
- **Operator evidence:** current official form/version, field mapping, source
  reconciliation, authorized submission, acuse, correction history, and filing
  calendar.
- **Decision ref:** none; regulatory-lead validation required before reliance.

### `MX-TEL-008` — Numbering, portability, and mobile-line identity

- **Sources:** `SRC-MX-LMTR` and current CRT plans/lineamientos.
- **Trigger:** operator use of national numbering, telephony/mobile service,
  portability, or a title/order that imposes the duty.
- **FireISP support:** numbering/portability/mobile-related schemas are internal
  workflow support only.
- **Limits:** no currentness validation, external registry submission, or proof
  that a fixed-Internet-only operator is in scope.
- **Decision ref:** none; reassess on service/numbering changes.

### `MX-PRIV-001` — Notice, purpose, consent, and minimization

- **Sources/provisions:** LFPDPPP Articles 5–17 and compatible regulation;
  `SRC-MX-LFPDPPP`, `SRC-MX-RLFPDPPP`.
- **FireISP support:** versioned privacy notices, portal presentation,
  `subscriber_consents`, purpose-related settings, and DND preferences.
- **Limits:** the operator is the controller; templates cannot identify every
  enabled field, free-text value, processor, AI path, transfer, or purpose.
- **Operator evidence:** deployed inventory, approved notice/version, collection
  points, purpose/basis decision, consent proof where required, and withdrawal
  path.
- **Decision ref:** none.

### `MX-PRIV-002` — ARCO/DSAR workflow and deadlines

- **Sources/provisions:** LFPDPPP Articles 21–36, including 20 business days for
  the determination and a following 15 business days to make it effective when
  granted, subject to the law's extension rules.
- **FireISP support:** request register, identity checks, subject-linked export,
  audit, and cancellation-review metadata.
- **Gaps:** the generic due date currently uses 30 calendar days. The export is
  a starting dataset, not proof of complete access, rectification, blocking,
  suppression, or deletion across files, messages, processors, replicas,
  backups, and external systems.
- **Operator evidence:** verified requester, business-day calculation, complete
  system search, decision, delivery, exception/denial basis, correction or
  blocking/suppression proof, and processor follow-through.
- **Decision ref:** none.

### `MX-PRIV-003` — Security safeguards and breach response

- **Sources/provisions:** LFPDPPP Articles 18–20 and compatible regulation.
- **FireISP support:** RBAC, encryption configuration, audit, incident runbook,
  monitoring, backups, and security tests.
- **Gap:** the runbook's former generic Mexican 72-hour/INAI statement has been
  corrected. A deployment-specific notification matrix still must identify any
  additional sector, title, contract, insurance, criminal, or foreign-law
  recipient and deadline. The reviewed current general private-sector law
  requires affected-person notice without delay when the breach significantly
  affects patrimonial or moral rights.
- **Operator evidence:** risk-based security program, incident record, affected
  data/people analysis, counsel decision, notices, containment, root cause, and
  prevention measures.
- **Decision ref:** none.

### `MX-PRIV-004` — Processors, transfers, and residency

- **Sources:** LFPDPPP transfer/processor provisions and compatible regulation;
  telecom-specific location only where independently applicable.
- **FireISP support:** processor inventory guidance and residency declaration.
- **Gaps:** self-declared `primary_storage_country` is not technical enforcement;
  AI, email/SMS/WhatsApp, PAC, storage, observability, support, backup, and
  custom HTTP endpoints require actual mapping and contracts.
- **Operator evidence:** processor/subprocessor register, instructions,
  contracts, transfer basis, regions, support paths, deletion return, and
  periodic verification.
- **Decision ref:** none.

### `MX-PRIV-005` — Retention, blocking, suppression, and holds

- **Sources/provisions:** LFPDPPP Articles 10, 12, 24–25; CFF/Código de Comercio
  where record-specific; valid preservation orders.
- **FireISP support:** configurable policies, batched deletion, isolation
  fan-out, case-scoped holds, and DSAR review.
- **Gaps:** several periods are installation policy, not universal law; the
  “data retention compliance” report is not a legal compliance determination;
  some external/backed-up copies require operator procedures. Audit-log purge
  conflicts with the current no-delete database trigger.
- **Operator evidence:** record-by-record schedule with trigger, purpose, owner,
  hold override, deletion/blocking path, backup propagation, and sampled tests.
- **Decision ref:** none.

### `MX-PRIV-006` — Marketing consent and contact preferences

- **Sources:** LFPDPPP purpose/consent/withdrawal rules and applicable LFPC
  electronic-commerce/advertising provisions.
- **FireISP support:** DND and campaign preference controls.
- **Limits:** channel/provider suppression, proof of consent, transactional
  versus marketing classification, and imported-list provenance remain
  operator responsibilities.
- **Operator evidence:** purpose and basis, consent/source evidence, channel
  suppression test, unsubscribe path, and campaign audit.
- **Decision ref:** none.

### `MX-PRIV-007` — Identity records and high-risk identifiers

- **Sources:** LFPDPPP necessity, proportionality, security, notice, and ARCO
  provisions; service-specific identity duty only where applicable.
- **FireISP support:** identity-verification records and permissions.
- **Gap:** raw INE/IFE/CURP/passport/RFC identifiers are stored as plaintext
  fields and returned broadly; creation needs strict tenant-client validation
  and access minimization. Collection must not be justified by a mobile-line
  rule when the operator/service is outside that rule.
- **Operator evidence:** necessity decision per field, reduced storage/token or
  image handling, encryption/access test, tenant check, retention, and deletion.
- **Decision ref:** none.

### `MX-TAX-001` — CFDI issue, stamping, XML, CSD, and PAC

- **Sources/provisions:** CFF Articles 28–30, current RMF, Anexo 20/CFDI 4.0;
  `SRC-MX-CFF`, `SRC-MX-RMF`, `SRC-MX-CFDI`.
- **FireISP support:** CFDI 4.0 construction, local seal, PAC integration, CSD
  management, XML/PDF storage, fiscal snapshots, and status checks.
- **Limits:** FireISP is not a tax engine. PAC acceptance does not validate the
  taxpayer's regime, transaction classification, rate, eligibility,
  deductibility, accounting, or retention.
- **Operator evidence:** current CSD/PAC, current schemas/catalogs, accountant
  approval, sandbox and production reconciliation, XML custody, and SAT status.
- **Review:** every RMF/catalog/schema/complement change, not merely quarterly.

### `MX-TAX-002` — Cancellation, REP, global invoices, and catalogs

- **Sources:** `SRC-MX-CFF`, `SRC-MX-RMF`, `SRC-MX-CFDI`.
- **FireISP support:** cancellation requests/evidence, replacement relation,
  payment complements, credit notes, global invoices, and SAT catalog tables.
- **Limits:** validity depends on the exact current rule, timing, taxpayer facts,
  and PAC/SAT response; software state is not the authority's final status.
- **Operator evidence:** source payment/invoice reconciliation, PAC acuse, SAT
  status, catalog version, accountant review, and exception handling.
- **Decision ref:** none.

### `MX-TAX-003` — Fiscal and commercial record retention

- **Sources:** CFF Article 30 and Código de Comercio Articles 38, 46, 46 Bis,
  and 49.
- **Rule boundary:** CFF generally uses five-year calculations tied to the
  related declaration/due-date and has record-specific exceptions. Commercial
  records can independently require ten years. Do not assign one period from a
  CFDI stamp date to every record.
- **FireISP support:** record storage and retention controls.
- **Operator evidence:** record class, triggering event, applicable exception,
  legal hold, accessible integrity-preserving archive, and deletion date.
- **Decision ref:** none.

### `MX-TAX-004` — IVA rates, exemptions, and border eligibility

- **Sources:** current fiscal statutes, decrees, RMF, and operator/accountant
  eligibility evidence; exact sources must be recorded per rule.
- **FireISP support:** configurable/default IVA, exemptions, and postal-code
  border-zone rules.
- **Critical gap:** seeded 8% border-zone matches can be active without proof of
  taxpayer enrollment and municipality-level eligibility. Automatic billing
  can therefore apply an unsupported reduced rate. Exemption flags likewise
  require authority, effective dates, review, and evidence.
- **Operator action:** disable unapproved rules; require fiscal-owner approval
  and eligibility evidence before activation; test every invoice path.
- **Decision ref:** none.

### `MX-CONS-001` — Registered telecom adhesion contracts

- **Sources:** LMTR Articles 185–190, `SRC-MX-LFPC`, `SRC-MX-NOM184`,
  `SRC-MX-RPCA`, and current telecom-user-rights instruments.
- **FireISP support:** versioned MX contract templates, registration references,
  customer contracts, acceptance and signed-document evidence.
- **Limits:** a template record does not prove PROFECO registration, that the
  production text matches the registered model, or that the operator/service is
  in scope.
- **Operator evidence:** current RPCA entry, exact text/hash/version match,
  Spanish cover sheet and required content, delivery/access proof, and change
  control.
- **Decision ref:** none.

### `MX-CONS-002` — Prices, service changes, notices, and cancellation

- **Sources:** LMTR Articles 185–190 and tariff Articles 196–197, LFPC,
  NOM-184, registered contract, and operator title/tariff rules.
- **FireISP support:** plans, prices, modifications, cancellation workflows, and
  notice records.
- **Gap:** marking a notice `sent` currently records status/time but does not
  transmit it or prove delivery. A generic 30-day minimum must not be treated as
  universal without an exact source and fact pattern.
- **Operator evidence:** approved price/contract, required lead time, actual
  channel transmission and delivery, customer options, cancellation parity,
  refund/bonus handling, and effective-date control.
- **Decision ref:** none.

### `MX-CONS-003` — Complaints and PROFECO handling

- **Sources:** LFPC complaint/remedy provisions, NOM-184, and current PROFECO
  process.
- **FireISP support:** internal `profeco_complaints` workflow and generic
  CSV/JSON export.
- **Limits:** the export is not an official filing or submission format. A
  quarterly-register claim needs an exact current source and counsel review.
- **Operator evidence:** protected complaint register, response/remedy, required
  bonus/refund, authority filing/acuse where applicable, and access review.
- **Decision ref:** none.

### `MX-CONS-004` — Accessibility and nondiscrimination

- **Sources:** applicable LMTR/LFPC consumer provisions, disability and equality
  law, and operator title/contract; exact assessment remains open.
- **FireISP support:** accessible UI practices and automated axe coverage for
  selected states.
- **Gap:** the README claim has been narrowed, but no complete accessibility
  conformance audit exists; automated tests with color-contrast disabled are not
  sufficient evidence.
- **Operator evidence:** scoped WCAG/manual audit, assistive-technology tests,
  color contrast, documents and support channels, issue remediation, and dated
  conformance statement if one is made.
- **Decision ref:** none.

### `MX-COMM-001` — Electronic contracts, messages, and signatures

- **Sources:** `SRC-MX-CCOM` and, for government acts in its scope,
  `SRC-MX-LFEA`.
- **FireISP support:** frozen document text/hash, acceptance/signature image,
  timestamp, actor, and signed-document storage.
- **Limits:** those are useful evidence but do not automatically establish an
  advanced electronic signature, signer identity, certified timestamp,
  evidentiary sufficiency, or a government e-filing requirement.
- **Operator evidence:** approved signature method, identity/authentication,
  intent, integrity, attribution, delivery, record access, and dispute process.
- **Decision ref:** none.

### `MX-COMM-002` — NOM-151 conservation and digitization

- **Sources:** `SRC-MX-CCOM`, `SRC-MX-NOM151`.
- **Product posture:** FireISP hashes and timestamps are not a NOM-151 constancia
  and no accredited Prestador de Servicios de Certificación workflow is
  implemented.
- **Operator action:** determine with counsel which record sets require this
  process and integrate an appropriate certified provider/archive when needed.
- **Decision ref:** none.

### `MX-SEC-001` — Audit evidence and privileged access

- **Sources:** LFPDPPP security/accountability duties and any applicable
  telecom/request security rules.
- **FireISP support:** `audit_logs`, `report_access_logs`, RBAC, selected DB
  triggers, hashes, and exports.
- **Gaps:** hashes are consistency markers, not privileged-admin-proof WORM.
  Some audit writes fail open. Ordinary retention deletion conflicts with the
  no-delete trigger, while organization cascade behavior also weakens an
  absolute immutability claim.
- **Operator evidence:** complete event inventory, fail-closed/outbox design for
  critical evidence, write/read/delete tests, privileged-access monitoring,
  export integrity, and retention/legal-hold procedure.
- **Decision ref:** none.

### `MX-SEC-002` — Backups, restoration, encryption, and deletion propagation

- **Sources:** LFPDPPP safeguards and record-specific retention duties.
- **FireISP support:** local/remote backup, restore and DR documentation.
- **Gaps:** documentation now distinguishes local file-count retention from
  provider-controlled remote lifecycle and no longer equates gzip with
  encryption. FireISP still does not verify each target's encryption, keys,
  lifecycle, geography, processors, support access, or custom endpoint.
- **Operator evidence:** encrypted transport/at-rest proof, keys, retention for
  every target, region/processor, restore drill, deletion propagation, and
  incident recovery test.
- **Decision ref:** none.

### `MX-SEC-003` — Tenant isolation and separation of duties

- **Sources:** privacy/security/confidentiality duties and operator contracts.
- **FireISP support:** organization predicates, tenant database contexts, RBAC,
  primary control-plane boundaries, audit, and isolation tests.
- **Limits:** one test suite or one validated tenant does not prove all paths or
  another deployment; shared installation-wide controls may not satisfy
  divergent tenant requirements.
- **Operator evidence:** data-flow inventory, permission review, same-value
  collision tests, isolated cutover/recovery, cross-tenant negative tests,
  privileged operator review, and periodic access recertification.
- **Decision ref:** none.

### `MX-AI-001` — AI processing, providers, prompts, and automation

- **Sources:** LFPDPPP purpose, notice, minimization, processor/transfer,
  security, ARCO, and automated-treatment provisions; consumer law where output
  affects customers.
- **FireISP support:** provider configuration, selected redaction, audit/logging,
  Reply Assistant documentation, and human-review options.
- **Gap:** the current inventory focuses on the Reply Assistant while chatbot,
  support, NOC, diagnostics, analytics, embeddings/RAG, and auto-send paths can
  also process personal data. Regex redaction is not anonymization, fallback
  providers can change recipients, and purpose-based retention is incomplete.
- **Operator evidence:** feature-by-feature data/purpose map, provider and
  subprocessor terms/regions, prompt/output retention, human review, notice,
  transfer basis, security testing, and DSAR/deletion coverage.
- **Decision ref:** none.

### `MX-LAB-001` — Staff data, technician location, labor, and payroll

- **Sources:** LFPDPPP for staff-user data; labor, IMSS, INFONAVIT, STPS,
  workplace, and payroll sources have not been assessed.
- **Product posture:** FireISP stores user identity, permissions, audit data, and
  can touch technician location, but it is not an HR/payroll/compliance product.
  A SAT catalog value or bundled XSLT does not establish nómina support.
- **Trigger:** employee files, attendance, biometrics, continuous location,
  payroll, nómina CFDI, social-security reporting, or workplace monitoring.
- **Operator action:** complete a separate labor/privacy assessment before any
  such feature or use; define notice, necessity, worker access, retention, and
  off-duty boundaries.
- **Decision ref:** none.

### `INTL-PRIV-001` — GDPR and other foreign privacy law

- **Sources:** `SRC-EU-GDPR` and the laws/guidance of each relevant country.
- **Trigger:** establishment, offering/monitoring, data subjects, processing,
  transfers, or contracts that bring a foreign regime into scope.
- **FireISP support:** privacy inventory, consent/DSAR/security/retention and
  processor configuration provide partial controls.
- **Limits:** `global` locale is not a jurisdiction and FireISP has not assessed
  member-state telecom/ePrivacy, representative, DPO, DPIA, transfer, breach,
  cookie, employment, or retention requirements.
- **Decision ref:** none.

## Known gap and exception register

These are confirmed product/documentation mismatches found during the
2026-08-15 review. They are not a complete vulnerability list and should be
converted to tracked issues with accountable owners. `TBD` is intentional: it
must not be confused with resolved work.

| Gap ID | Related IDs | Confirmed mismatch | Severity | Owner | Tracking | Review by |
|---|---|---|---|---|---|---|
| `LEGAL-GAP-001` | `MX-TAX-004` | Active seeded border-zone IVA rules can apply 8% without stored taxpayer/municipality eligibility approval. | `CRITICAL` | Fiscal engineering | TBD | 2026-09-15 |
| `LEGAL-GAP-002` | `MX-PRIV-004`, `MX-TEL-004` | Residency “compliant” status checks a self-entered country, not infrastructure, backups, processors, or access paths. | `HIGH` | Privacy/security | TBD | 2026-09-15 |
| `LEGAL-GAP-003` | `MX-SEC-001`, `MX-PRIV-005` | Ordinary audit-log retention deletion conflicts with the no-delete trigger; absolute immutability claims are inaccurate. | `HIGH` | Security engineering | TBD | 2026-09-15 |
| `LEGAL-GAP-004` | `MX-PRIV-002` | DSAR uses a generic 30-calendar-day due date instead of separately tracking the statutory business-day decision and execution phases. | `HIGH` | Privacy engineering | TBD | 2026-09-15 |
| `LEGAL-GAP-005` | `MX-PRIV-007`, `MX-SEC-003` | Identity records need tenant validation, encryption/minimization, and narrower access/response fields. | `CRITICAL` | Privacy/security | TBD | 2026-09-15 |
| `LEGAL-GAP-006` | `MX-PRIV-003` | Generic Mexico 72-hour/INAI wording was corrected; the operator-specific breach notification matrix and validation remain open. | `HIGH` | Incident/legal | This documentation change; operational issue TBD | 2026-09-15 |
| `LEGAL-GAP-007` | `MX-SEC-002`, `MX-PRIV-005` | Documentation was corrected, but actual backup encryption, lifecycle, geography, processor, and deletion evidence remain deployment-owned and unverified. | `HIGH` | Platform/security | This documentation change; validation issue TBD | 2026-09-15 |
| `LEGAL-GAP-008` | `MX-PRIV-005`, `MX-TAX-003` | “Data retention compliance” report labels age counts as compliance and assumes a blanket seven-year threshold. | `HIGH` | Reporting/legal | TBD | 2026-09-15 |
| `LEGAL-GAP-009` | `MX-TEL-007` | IFT statistical schema review cites repealed LFTR Article 175 and lacks current CRT/form validation. | `HIGH` | Regulatory reporting | TBD | 2026-09-15 |
| `LEGAL-GAP-010` | `MX-CONS-002` | Consumer notice “send” changes database state but does not transmit or prove delivery. | `HIGH` | Consumer operations | TBD | 2026-09-15 |
| `LEGAL-GAP-011` | `MX-AI-001` | Privacy/processor inventory does not yet cover every AI surface or provider fallback. | `HIGH` | AI/privacy | TBD | 2026-09-15 |
| `LEGAL-GAP-012` | `MX-CONS-004` | README wording was narrowed; full manual/assistive-technology/color-contrast conformance evidence remains absent. | `MEDIUM` | Accessibility | This documentation change; audit issue TBD | 2026-11-15 |
| `LEGAL-GAP-013` | `MX-COMM-001`, `MX-COMM-002` | Signature/hash records are useful evidence but comments and copy can imply unsupported certified/legal sufficiency. | `HIGH` | Contracts/legal | TBD | 2026-11-15 |

When a gap is fixed, preserve its row, add the issue/PR, tested commit, validation
evidence reference, closure date, and residual risk. Do not delete history.

## Acceptance-evidence minimums

Before a deployment is marked `VALIDATED`, its restricted evidence register
should identify, as applicable:

- legal entity, title/authorization, covered service, territory, and numbering;
- counsel applicability/interpretation decision and expiry/review trigger;
- exact product release/commit, migrations, config, and enabled modules;
- processor/subprocessor, region, transfer, support, backup, and deletion map;
- RBAC and separation-of-duties review with actual role assignments;
- source-to-output reconciliation and authority/PAC/PROFECO/CRT acuse;
- retention, blocking, deletion, hold, restore, and retrieval drills;
- request/incident/DSAR workflow samples with identities and evidence kept out of
  Git;
- test results, exceptions, accepted risks, expiry dates, and responsible owner;
  and
- proof that each tenant with different requirements was evaluated separately.

## Legal change workflow

1. **Log the publication append-only.** Record a change ID, official URL,
   publication date, effective date, proposal/final status, and affected source
   IDs. A proposal must never silently become an effective obligation.
2. **Verify the primary source.** Confirm issuer, consolidated text, exact
   provisions, transitories, repeal/savings language, and effective date.
3. **Map impact.** Identify affected requirement IDs, legal entities, services,
   data categories, tenants, shared installation settings, processors, forms,
   contracts, code, schema, migrations, defaults, and operator procedures.
4. **Obtain the legal decision.** Counsel records applicability and
   interpretation in a restricted system; Git stores only the external
   reference and date.
5. **Set an honest interim state.** Open linked issues and mark entries `GAP`,
   `IMPLEMENTING`, `NOT_SUPPORTED`, or `UNASSESSED` until evidence exists.
6. **Implement and test.** Name the commit/release, migration/rollback, test
   evidence, documentation, configuration change, and compatibility boundary.
7. **Validate each deployment.** Apply/operator-test the control, reconcile
   source data, retain restricted evidence, and confirm tenant-specific facts.
8. **Approve and record residual risk.** Legal and operational owners sign off;
   any acceptance has an owner, rationale, expiry, and next review.
9. **Recheck after the effective date.** Confirm the final publication and live
   behavior; close or revise the change record without deleting history.

### Calendar and event-driven monitoring

| Frequency/trigger | Owner | Required action |
|---|---|---|
| Weekly | Compliance engineering | Review DOF and relevant CRT consultations/decisions; triage SAT anticipatory publications separately from final text. |
| Monthly | Legal-source owner | Check Cámara consolidated texts, SAT RMF/catalogs, PROFECO/NOM status, and open gap deadlines. |
| Quarterly | Register owner + counsel | Full register/source/applicability review; next due 2026-11-15. |
| New release/migration | Feature owner | Re-map affected records, defaults, storage, RBAC, API, retention, and rollback evidence. |
| New service/jurisdiction/tenant type | Operator legal | Decide applicability before launch. |
| New data field/purpose/vendor/region/AI model | Privacy/security | Update inventory, notice/basis, contracts, transfers, retention, DSAR, and security. |
| Incident, authority request, or legal hold | Legal/incident owner | Apply the validated case procedure and trigger a post-event review. |
| Official publication or court decision | Legal-source owner | Run the full change workflow; do not wait for the quarterly date. |

### Append-only change log

| Change ID | Logged | Published/effective | Official source | Affected IDs | Assessment | Action/PR refs | Decision ref | State |
|---|---|---|---|---|---|---|---|---|
| `LEGAL-CHANGE-0001` | 2026-08-15 | Register baseline | Sources cataloged above | All initial IDs | Initial product/source inventory; operator applicability remains unassessed or conditional | This document | none | `IN_REVIEW` |

## Template for a new or revised record

Copy this template; do not invent an unlisted status.

```markdown
### `XX-DOMAIN-NNN` — Neutral requirement title

- **Scope layer:** product / installation / organization / operator
- **Jurisdiction and instrument status:**
- **Official source IDs and exact provisions:**
- **Neutral requirement summary:**
- **Applicability trigger and exclusions:**
- **Obligated party:**
- **Applicability status and restricted counsel decision ref:**
- **Data categories affected:**
- **Product posture and precise FireISP support:**
- **Explicit limitations / not supported:**
- **Operator actions and deployment dependencies:**
- **Acceptance evidence and tested release/commit:**
- **Related requirement/gap/issue/PR IDs:**
- **Risk severity and state:**
- **Owner:**
- **Source last verified / control last verified:**
- **Next calendar review and event triggers:**
```

## Related FireISP documents

- [Mexican telecommunications regulatory reference](compliance-mexico.md) —
  current telecom/security-justice overview and legal boundary.
- [Connection logging and evidence operations](connection-logging-compliance.md)
  — RADIUS, direct public IP, privacy-minimal CGNAT, case gating, readiness,
  retention, and deployment limitations.
- [Privacy and PII inventory](privacy.md) — data categories, purposes, ARCO/DSAR,
  processors, retention, AI, security, and deployment verification.
- [CFDI sandbox testing](cfdi-sandbox-testing.md) — fiscal integration test
  procedure, not tax advice.
- [IFT statistical-report schema review](ift-statistical-report-schema-review.md)
  — historical engineering mapping requiring current CRT/form revalidation.
- [RBAC permissions](rbac-permissions.md), [tenant database isolation](tenant-database-isolation.md),
  [secrets management](secrets-management.md), [backup and restore](backup-restore.md),
  [DR drill](dr-drill.md), [deployment](deployment.md), [security testing](pentest.md),
  and [runbook](runbook.md) — supporting technical and operational evidence, not
  legal certification.
- [`isp-platform-features.md`](../isp-platform-features.md) — product capability
  inventory. Checked boxes mean implemented capability only.

## Maintenance rules

- Keep stable requirement and source IDs even when laws, agencies, or article
  numbers change; add successor links and mark the old record `SUPERSEDED`.
- Prefer official URLs and neutral paraphrases. Do not copy long statutory text.
- Record proposal and effective-law states separately.
- Link to stable symbols, migrations, routes, tests, and documents rather than
  fragile line numbers.
- Never replace product posture with a binary compliance-certification field.
- Never infer an operator decision from product configuration or a passing test.
- Never commit privileged advice, subscriber/case evidence, credentials, or
  personal data.
- Keep known gaps visible until evidence-backed closure, and review accepted
  risks before their expiry.
