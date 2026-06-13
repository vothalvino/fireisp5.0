# Mexican Telecommunications Regulatory Compliance Reference

This document captures the legal framework governing Mexican ISP operations and how FireISP 5.0 addresses each requirement. It satisfies the §16.1 Legal Framework reference items.

## 1. Governing Law: LFTR (Ley Federal de Telecomunicaciones y Radiodifusion)

The LFTR (published 2014, amended periodically) is the primary regulatory framework for telecommunications operators in Mexico. Key obligations for ISPs include:

- Mandatory concession or authorization before providing services
- IP log retention and lawful interception capability (Articulo 190)
- User registration with complete identity data
- Quality of service minimums set by the regulator
- Universal service contribution (Fondo de Cobertura Universal - FONAC)
- Consumer protection obligations and complaint handling

**FireISP implementation:** Concession title management (`concession_titles` table, `/concession-titles` routes), regulatory filings (`regulatory_filings`, `/regulatory-filings`), and statistical reporting (`ift_statistical_reports`, `/ift-statistical-reports`).

## 2. Regulatory Bodies (2025 Transition)

### IFT - Instituto Federal de Telecomunicaciones (pre-July 2025)
The IFT was the independent regulatory body created by the 2013 constitutional reform. It was responsible for spectrum management, concession titles, competition, and consumer protection in telecommunications.

### ATDT - Agencia de Transformacion Digital y Telecomunicaciones (from July 2025)
Created by the 2025 constitutional reform. Handles policy, licensing, spectrum assignment, and digital transformation strategy. Absorbed the policy functions of IFT.

### CRT - Comision Reguladora de Telecomunicaciones (from July 2025)
Created by the 2025 reform alongside ATDT. Handles regulatory enforcement, compliance monitoring, sanctions, interconnection, and tariff regulation. Absorbed the enforcement functions of IFT.

**FireISP implementation:** The `concession_titles.regulatory_body` ENUM includes both 'IFT' and 'CRT' to support the transition. The `gov_data_requests.authority_name` field captures requests from any authority. Compliance status in the `data_residency_config` table references ATDT/CRT rules.

## 3. LFPDPPP (Ley Federal de Proteccion de Datos Personales en Posesion de los Particulares)

Mexico's primary personal data protection law, enforced by the INAI (Instituto Nacional de Transparencia, Acceso a la Informacion y Proteccion de Datos Personales). Key requirements:

- **Aviso de Privacidad:** ISPs must publish and maintain a privacy notice explaining data processing purposes
- **Consent (Consentimiento):** Personal data processing requires consent, except for legal or contractual necessity
- **DSAR (Derechos ARCO):** Data subjects have rights of Access, Rectification, Cancellation, and Opposition
- **Data minimization:** Collect only data necessary for the stated purpose
- **Data security:** Implement technical and organizational security measures
- **Cross-border transfers:** Transfers to third countries require consent or contractual safeguards

**FireISP implementation:**
- `subscriber_consents` table — tracks Aviso de Privacidad consent with version, timestamp, purpose, and withdrawal
- `dsar_requests` table — full DSAR workflow (intake, review, fulfill/reject with 30-day deadline, legal hold)
- `identity_verification_records` — stores INE/IFE/CURP verification with CURP checksum validation
- `data_residency_config` — tracks data localization and cross-border transfer restrictions
- `GET /dsar/clients/:id` — exports all personal data held for a client (data subject access)
- `/regulatory-compliance/*` endpoints — complete consent, DSAR, and identity management workflows

## 4. Codigo Penal Federal (Telecommunications Crimes)

Articles 211 bis through 211 bis 7 criminalize unauthorized interception of telecommunications, unauthorized access to computer systems, and disclosure of private communications. ISPs must:

- Implement lawful interception only upon valid legal authority request
- Maintain audit logs of all government data requests
- Never voluntarily disclose subscriber data without legal basis

**FireISP implementation:** `gov_data_requests` table with integrity hash chain (`row_hash` SHA-256) provides a tamper-evident log of all government data requests. The `/regulatory-compliance/gov-data-requests` endpoints require admin-level permissions and create an immutable audit record.

## 5. CFDI 4.0 (Comprobante Fiscal Digital por Internet)

SAT (Servicio de Administracion Tributaria) requires all businesses to issue electronic invoices in CFDI 4.0 XML format since January 2022. Requirements for ISPs:

- All invoices must be digitally signed with a valid CSD (Certificado de Sello Digital)
- Invoices must include receptor RFC, regimen fiscal, uso de CFDI, and domicilio fiscal
- Monthly VAT (IVA) declarations based on issued CFDI documents
- Public-use invoices (Factura Publica) for clients without RFC

**FireISP implementation:** CFDI 4.0 is fully implemented in the existing platform:
- `cfdi_documents`, `cfdi_conceptos`, `cfdi_payment_complements` tables
- `csd_certificates` for digital signature management
- `/cfdi/*` routes for complete CFDI lifecycle management
- `client_mx_profiles` with RFC, CURP, regimen_fiscal, uso_cfdi
- `/factura-publica/*` for public invoices
- `/sat-catalogs/*` for SAT catalog data (products, units, regimens)

## Summary: §16.1 Compliance Coverage

| Legal Framework Item | FireISP Coverage |
|---------------------|-----------------|
| LFTR — governing law | concession_titles, regulatory_filings, ift_statistical_reports, ip_log_retention via connection_logs + gov_data_requests |
| IFT → ATDT/CRT 2025 transition | regulatory_body ENUM in concession_titles; authority field in gov_data_requests |
| LFPDPPP — data privacy | subscriber_consents, dsar_requests, identity_verification_records, data_residency_config |
| Codigo Penal Federal | gov_data_requests with row_hash integrity; audit_logs; report_access_logs |
| CFDI 4.0 | Existing: cfdi_documents, csd_certificates, client_mx_profiles (fully implemented) |
