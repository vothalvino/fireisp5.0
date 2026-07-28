// =============================================================================
// FireISP 5.0 — Privacy Notice Service (LFPDPPP §16)
// =============================================================================
// Builds the subscriber-facing privacy notice for an org. The org's own text
// (organizations.privacy_notice, migration 430) always wins; when it is NULL
// the service falls back to a bundled template interpolated with the org's
// identity fields, so the portal never renders an empty page.
//
// Template choice follows the org's compliance locale: MX orgs get an aviso
// de privacidad shaped by LFPDPPP (responsable, finalidades, ARCO); every
// other locale gets a generic notice with no Mexican terminology — the same
// rule the tax-rules work follows.
//
// The returned `version` is what gets written to
// subscriber_consents.consent_version on acceptance, and what an existing
// consent row is compared against to decide whether a subscriber must
// re-accept. `hash` is the SHA-256 of the exact content served, stored as
// document_hash so an acceptance can later be tied to the text it covered.
// =============================================================================

const crypto = require('crypto');
const db = require('../config/database');
const { NotFoundError } = require('../utils/errors');

// The default version deliberately identifies the BUNDLED template. An org
// that pastes its own notice should set its own version; until it does, its
// custom text is versioned 'custom-1' so it never compares equal to an
// acceptance of the bundled template.
const BUNDLED_VERSION = 'default-1';
const CUSTOM_FALLBACK_VERSION = 'custom-1';

const MX_TEMPLATE = `# Aviso de Privacidad

**{{legal_name}}** (el "Responsable"), con domicilio en {{address}}, es responsable del tratamiento de sus datos personales conforme a la Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP) y su Reglamento.

## Datos personales que recabamos

- **Identificación y contacto:** nombre, domicilio, teléfono, correo electrónico.
- **Facturación y fiscales:** RFC, código postal fiscal, uso de CFDI, datos de pago.
- **Técnicos del servicio:** dirección IP y MAC asignadas, registros de sesión y consumo, datos necesarios para operar y diagnosticar su conexión.

## Finalidades primarias (necesarias para el servicio)

1. Prestación del servicio de acceso a internet contratado.
2. Facturación, cobranza y emisión de comprobantes fiscales (CFDI).
3. Soporte técnico y atención a reportes.
4. Cumplimiento de obligaciones legales ante autoridades competentes (SAT, IFT, entre otras).

## Finalidades secundarias (no necesarias para el servicio)

- Envío de promociones y comunicaciones comerciales sobre nuestros servicios.

Usted puede negarse al tratamiento para finalidades secundarias sin que ello afecte la prestación del servicio, contactándonos por los medios indicados abajo.

## Transferencias

Sus datos pueden compartirse con: proveedores autorizados de certificación fiscal (PAC) para el timbrado de comprobantes, procesadores de pago para cobrar el servicio, y autoridades cuando una ley u orden fundada lo exija. No vendemos sus datos personales.

## Derechos ARCO y revocación del consentimiento

Usted tiene derecho a Acceder, Rectificar, Cancelar u Oponerse al tratamiento de sus datos (derechos ARCO), así como a revocar el consentimiento otorgado. Para ejercerlos, envíe una solicitud a **{{email}}**{{phone_clause_es}} indicando su nombre completo, el derecho que desea ejercer y los datos de contacto para responderle. Responderemos en los plazos que establece la LFPDPPP.

## Cambios a este aviso

Cualquier modificación a este aviso se publicará en este portal. Versión: **{{version}}**.
`;

const GLOBAL_TEMPLATE = `# Privacy Notice

**{{legal_name}}** ("we"), located at {{address}}, is responsible for the personal data collected to provide your internet service.

## Data we collect

- **Identity and contact:** name, address, phone number, email address.
- **Billing:** tax or fiscal identifiers where applicable, payment details.
- **Service and network:** assigned IP and MAC addresses, session and usage records, and data needed to operate and troubleshoot your connection.

## Why we process it

1. To deliver the internet service you contracted.
2. To bill and collect payment, and to issue any legally required receipts.
3. To provide technical support and handle your reports.
4. To comply with legal obligations before competent authorities.

## Marketing

We may send you promotions about our own services. You can opt out at any time by contacting us below, without affecting your service.

## Sharing

Your data may be shared with payment processors, with tax or invoicing providers where required, and with authorities when the law requires it. We do not sell your personal data.

## Your rights

You may request access to, correction of, or deletion of your personal data, and withdraw any consent you have given, by writing to **{{email}}**{{phone_clause_en}}. Include your full name, the right you wish to exercise, and how to reach you.

## Changes

Any change to this notice will be published on this portal. Version: **{{version}}**.
`;

function fill(template, org, version) {
  const addressParts = [org.address, org.city, org.state, org.zip_code, org.country]
    .filter(Boolean).join(', ');
  const vars = {
    legal_name: org.legal_name || org.name,
    address: addressParts || '—',
    email: org.email || '—',
    phone_clause_es: org.phone ? ` o al teléfono **${org.phone}**` : '',
    phone_clause_en: org.phone ? ` or by calling **${org.phone}**` : '',
    version,
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

/**
 * Build the privacy notice an org currently serves.
 * Returns { version, content, hash, source: 'org' | 'bundled' }.
 */
async function getNotice(orgId) {
  // orgId is NULL on single-tenant installs (parent org columns are
  // 'NULL = single-tenant' by design), where there is exactly one org row —
  // serve that one rather than 404ing every subscriber of the install.
  const [rows] = orgId !== null && orgId !== undefined
    ? await db.query(
      `SELECT name, legal_name, email, phone, address, city, state, zip_code,
              country, locale, privacy_notice, privacy_notice_version
       FROM organizations WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [orgId],
    )
    : await db.query(
      `SELECT name, legal_name, email, phone, address, city, state, zip_code,
              country, locale, privacy_notice, privacy_notice_version
       FROM organizations WHERE deleted_at IS NULL ORDER BY id ASC LIMIT 1`,
    );
  const org = rows[0];
  if (!org) throw new NotFoundError('Organization not found');

  let content;
  let version;
  let source;
  if (org.privacy_notice && org.privacy_notice.trim()) {
    content = org.privacy_notice;
    version = org.privacy_notice_version || CUSTOM_FALLBACK_VERSION;
    source = 'org';
  } else {
    version = org.privacy_notice_version || BUNDLED_VERSION;
    const template = org.locale === 'MX' ? MX_TEMPLATE : GLOBAL_TEMPLATE;
    content = fill(template, org, version);
    source = 'bundled';
  }

  const hash = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  return { version, content, hash, source };
}

module.exports = { getNotice, BUNDLED_VERSION };
