// =============================================================================
// FireISP 5.0 — CSD sealing engine (CFDI 4.0 "sello digital")
// =============================================================================
// Seals CFDI XML locally with the organization's CSD:
//
//   built XML (+ NoCertificado + Certificado)
//     → cadena original (SAT's OFFICIAL cadenaoriginal_4_0.xslt, vendored and
//       compiled to SEF under src/resources/sat, executed by saxon-js)
//     → RSA-SHA256 over the cadena with the CSD private key
//     → Sello attribute injected into the Comprobante
//
// Why the official stylesheet instead of hand-rolled concatenation: SAT
// revises the transform (new complements, rule changes), and a real
// installation keeps current by dropping in SAT's new .xslt and recompiling
// (see src/resources/sat/README.md) — not by re-deriving string logic. The
// failure mode is also safe by construction: a wrong cadena produces an
// invalid Sello, which every PAC REJECTS — it can never yield an
// accepted-but-wrong CFDI.
//
// SAT's *test* CSDs (Certificados_Pruebas.zip, the only CSDs allowed in this
// repo, as test fixtures) chain to a "pruebas" issuer CA. isTestCertificate()
// exposes that so callers can refuse pairing a test CSD with a production
// PAC — a self-hosted install must never ship legally-void invoices.
// =============================================================================

const crypto = require('crypto');
const SaxonJS = require('saxon-js');
const { Credential } = require('@nodecfdi/credentials/node');
const { AppError } = require('../utils/errors');

// require() caches the parsed SEF (~1 MB JSON) process-wide.
const CADENA_SEF = require('../resources/sat/cadenaoriginal_4_0.sef.json');

/**
 * Load a CSD from certificate + private key contents. Accepts PEM strings
 * (the database path) or DER Buffers (the upload path); passphrase is
 * required for SAT-issued .key files.
 *
 * Returns a handle { info, signingKey } that is SAFE TO LOG: `info` holds
 * only public certificate data and `signingKey` is an opaque Node
 * KeyObject (serializes as {}). The nodecfdi credential object is used
 * transiently and NEVER retained — it keeps the plaintext passphrase and
 * key PEM as enumerable properties, so a handle that carried it would
 * dump the org's CSD passphrase into logs on any logger.info({ csd })
 * (review-confirmed). Signing goes through Node crypto over UTF-8 bytes;
 * nodecfdi's own sign() digests latin1 and is never used.
 */
function loadCredential(cerContents, keyContents, passphrase) {
  const cer = Buffer.isBuffer(cerContents) ? cerContents.toString('binary') : cerContents;
  const key = Buffer.isBuffer(keyContents) ? keyContents.toString('binary') : keyContents;
  try {
    const credential = Credential.create(cer, key, passphrase || '');
    const signingKey = crypto.createPrivateKey({
      key: credential.privateKey().pem(),
      passphrase: passphrase || '',
    });
    return { info: extractCertificateInfo(credential), signingKey };
  } catch (err) {
    throw new AppError(
      `The CSD could not be loaded — check that the .cer/.key pair matches and the passphrase is correct (${err.message}).`,
      422, 'CSD_INVALID',
    );
  }
}

/**
 * True when the certificate chains to SAT's test CA. Two generations of test
 * issuers exist: the older "A.C. 2 de pruebas(4096)" and the current
 * "CN=AC UAT" (the Certificados_Pruebas.zip set) — production SAT CAs carry
 * neither marker.
 */
function isTestCertificate(certificate) {
  const issuer = certificate.issuerAsRfc4514();
  return /prueba/i.test(issuer) || /\bAC UAT\b/i.test(issuer);
}

// Everything the app needs to know about a CSD certificate — all PUBLIC data
// (the NoCertificado / Certificado attribute values, identity, validity, and
// whether it is a SAT test certificate). Extracted once at load time so the
// passphrase-bearing credential object can be dropped immediately.
function extractCertificateInfo(credential) {
  const cert = credential.certificate();
  return {
    rfc: cert.rfc(),
    legal_name: cert.legalName(),
    certificate_number: cert.serialNumber().bytes(),
    certificado_b64: cert.pemAsOneLine(),
    valid_from: cert.validFrom(),
    valid_to: cert.validTo(),
    issuer: cert.issuerAsRfc4514(),
    is_test_certificate: isTestCertificate(cert),
  };
}

/** Public certificate info for a loaded CSD handle. */
function certificateInfo(csd) {
  return csd.info;
}

/**
 * Cadena original per Anexo 20 — SAT's own XSLT over the XML. The transform
 * reads NoCertificado (not Certificado/Sello), so it must run on XML that
 * already carries the certificate attributes.
 */
function cadenaOriginal(xmlString) {
  const result = SaxonJS.transform({
    stylesheetInternal: CADENA_SEF,
    sourceText: xmlString,
    destination: 'serialized',
  });
  return result.principalResult;
}

// The builders emit Version="4.0" exactly once, on the cfdi:Comprobante root
// (the Pagos complement carries Version="2.0"), so it is a safe injection
// anchor that keeps the builders sealing-agnostic.
function injectComprobanteAttributes(xmlString, attrText) {
  if (!xmlString.includes('Version="4.0"')) {
    throw new AppError('Not a CFDI 4.0 Comprobante — cannot seal.', 422, 'CFDI_SEAL_UNSUPPORTED');
  }
  return xmlString.replace('Version="4.0"', `Version="4.0"\n  ${attrText}`);
}

/**
 * Seal a built (unsealed) CFDI 4.0 XML with the given credential.
 * Returns { xml, cadena, sello, certificate_number, rfc }.
 */
function sealXml(xmlString, csd) {
  if (/\bSello="/.test(xmlString)) {
    throw new AppError('This XML already carries a Sello — refusing to double-seal.', 422, 'CFDI_ALREADY_SEALED');
  }
  const info = csd.info;
  const withCert = injectComprobanteAttributes(
    xmlString,
    `NoCertificado="${info.certificate_number}"\n  Certificado="${info.certificado_b64}"`,
  );
  const cadena = cadenaOriginal(withCert);
  // Sign with Node's crypto over the EXPLICIT UTF-8 bytes of the cadena —
  // Anexo 20 signs UTF-8, and nodecfdi's own sign() digests latin1 (any
  // accent or dash in the cadena would yield a SAT-rejected Sello).
  const sello = crypto.sign('RSA-SHA256', Buffer.from(cadena, 'utf8'), csd.signingKey).toString('base64');
  const sealed = injectComprobanteAttributes(withCert, `Sello="${sello}"`);
  return { xml: sealed, cadena, sello, certificate_number: info.certificate_number, rfc: info.rfc };
}

/**
 * Verify a sealed XML's Sello against its own embedded Certificado.
 * The cadena excludes Sello/Certificado, so it can be recomputed directly
 * from the sealed document.
 */
function verifySeal(xmlString) {
  const selloMatch = xmlString.match(/\bSello="([^"]+)"/);
  const certMatch = xmlString.match(/\bCertificado="([^"]+)"/);
  if (!selloMatch || !certMatch) return false;
  const certPem = `-----BEGIN CERTIFICATE-----\n${certMatch[1].replace(/(.{64})/g, '$1\n').trim()}\n-----END CERTIFICATE-----\n`;
  const publicKey = new crypto.X509Certificate(certPem).publicKey;
  const cadena = cadenaOriginal(xmlString);
  return crypto.verify('RSA-SHA256', Buffer.from(cadena, 'utf8'), publicKey, Buffer.from(selloMatch[1], 'base64'));
}

/**
 * Storage material for a CSD upload: the PEM forms to persist plus the parsed
 * public info. UPLOAD-HANDLER ONLY — the returned key_pem is the (still
 * SAT-passphrase-encrypted) private key PEM and must be app-encrypted before
 * it touches the database; it must never ride on the log-safe seal handle.
 */
function csdStorageMaterial(cerContents, keyContents, passphrase) {
  const cer = Buffer.isBuffer(cerContents) ? cerContents.toString('binary') : cerContents;
  const key = Buffer.isBuffer(keyContents) ? keyContents.toString('binary') : keyContents;
  try {
    const credential = Credential.create(cer, key, passphrase || '');
    // Round-trip guard: prove the pair+passphrase can actually sign before
    // anything is stored (a stored-but-unusable CSD is a support nightmare).
    crypto.createPrivateKey({ key: credential.privateKey().pem(), passphrase: passphrase || '' });
    return {
      cer_pem: credential.certificate().pem(),
      key_pem: credential.privateKey().pem(),
      info: extractCertificateInfo(credential),
    };
  } catch (err) {
    throw new AppError(
      `The CSD could not be loaded — check that the .cer/.key pair matches and the passphrase is correct (${err.message}).`,
      422, 'CSD_INVALID',
    );
  }
}

/**
 * DER (base64) forms of a loaded CSD handle for PACs that take the raw
 * certificate + key inline (Finkok cancel): cerDerB64 is the certificate DER
 * (the Certificado attribute value already is that), keyDerB64 is the
 * DECRYPTED private key exported as unencrypted PKCS#8 DER.
 */
function csdDerMaterial(csd) {
  return {
    cerDerB64: csd.info.certificado_b64,
    keyDerB64: csd.signingKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  };
}

module.exports = {
  loadCredential, certificateInfo, cadenaOriginal, sealXml, verifySeal, isTestCertificate,
  csdStorageMaterial, csdDerMaterial,
};
