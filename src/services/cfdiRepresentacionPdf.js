// =============================================================================
// FireISP 5.0 — CFDI 4.0 "representación impresa" (the legal PDF of a CFDI)
// =============================================================================
// A stamped CFDI's PDF is a legally defined document (CFF 29-A / RMF 2.7.1.7 /
// Anexo 20), not a courtesy invoice: it must carry the UUID, both timestamps
// (emission + SAT certification), the certificate numbers (emisor CSD, SAT,
// and the certifying PAC's RFC), full fiscal identities, conceptos with their
// SAT product/unit codes and tax desglose, the three cryptographic strings
// (SelloCFD, SelloSAT, and the cadena original del complemento de
// certificación del SAT), the SAT verification QR, and the total in words.
//
// Everything here is parsed from signed_xml — the PAC-returned sealed document
// IS the fiscal truth; database columns can drift (and historically did).
//
// MX-locale organizations only. Global orgs never reach this module — their
// invoice PDFs are untouched (user constraint, pinned by tests).
// =============================================================================

const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { XMLParser } = require('fast-xml-parser');

const PAGE_MARGIN = 36;
const COLORS = {
  primary: '#1a5276', text: '#2c3e50', muted: '#7f8c8d',
  border: '#bdc3c7', danger: '#c0392b', background: '#ecf0f1',
};

// ---------------------------------------------------------------------------
// Small SAT catalogs — descriptions for the codes an ISP actually emits.
// Unknown codes fall back to the bare code (never wrong, just terser).
// ---------------------------------------------------------------------------
const USO_CFDI = {
  G01: 'Adquisición de mercancías', G02: 'Devoluciones o bonificaciones', G03: 'Gastos en general',
  I01: 'Construcciones', I04: 'Equipo de cómputo', S01: 'Sin efectos fiscales',
  D01: 'Honorarios médicos', D10: 'Servicios educativos', CP01: 'Pagos', P01: 'Por definir',
};
const FORMA_PAGO = {
  '01': 'Efectivo', '02': 'Cheque nominativo', '03': 'Transferencia electrónica',
  '04': 'Tarjeta de crédito', '05': 'Monedero electrónico', '06': 'Dinero electrónico',
  '28': 'Tarjeta de débito', '30': 'Aplicación de anticipos', '99': 'Por definir',
};
const METODO_PAGO = { PUE: 'Pago en una sola exhibición', PPD: 'Pago en parcialidades o diferido' };
const REGIMEN_FISCAL = {
  601: 'General de Ley Personas Morales', 603: 'Personas Morales con Fines no Lucrativos',
  605: 'Sueldos y Salarios', 606: 'Arrendamiento', 612: 'Personas Físicas con Actividades Empresariales',
  616: 'Sin obligaciones fiscales', 621: 'Incorporación Fiscal', 626: 'Régimen Simplificado de Confianza',
};
const TIPO_COMPROBANTE = { I: 'FACTURA', E: 'NOTA DE CRÉDITO', P: 'COMPLEMENTO DE PAGO', T: 'TRASLADO', N: 'NÓMINA' };

function withDesc(code, catalog) {
  if (code === undefined || code === null || code === '') return '';
  const desc = catalog[String(code)];
  return desc ? `${code} — ${desc}` : String(code);
}

// ---------------------------------------------------------------------------
// signed_xml → model
// ---------------------------------------------------------------------------
// Namespace prefixes are PAC-controlled serialization detail (cfdi:, tfd:, …
// could legally be anything), so lookups match on the LOCAL element name.
function localName(key) {
  const i = key.indexOf(':');
  return i === -1 ? key : key.slice(i + 1);
}

function childrenByLocalName(node, name) {
  if (!node || typeof node !== 'object') return [];
  const out = [];
  for (const [key, value] of Object.entries(node)) {
    if (localName(key) !== name) continue;
    for (const v of Array.isArray(value) ? value : [value]) out.push(v);
  }
  return out;
}

function firstByLocalName(node, name) {
  return childrenByLocalName(node, name)[0];
}

/**
 * Parse a (sealed or unsealed) CFDI 4.0 XML into a render model.
 */
function parseCfdiXml(xml) {
  const parser = new XMLParser({
    ignoreAttributes: false, attributeNamePrefix: '',
    parseAttributeValue: false, parseTagValue: false,
  });
  const root = parser.parse(xml);
  const comp = firstByLocalName(root, 'Comprobante');
  if (!comp) throw new Error('Not a CFDI Comprobante XML');

  const emisor = firstByLocalName(comp, 'Emisor') || {};
  const receptor = firstByLocalName(comp, 'Receptor') || {};

  const conceptos = childrenByLocalName(firstByLocalName(comp, 'Conceptos') || {}, 'Concepto')
    .map(c => ({
      clave_prod_serv: c.ClaveProdServ, no_identificacion: c.NoIdentificacion,
      cantidad: c.Cantidad, clave_unidad: c.ClaveUnidad, descripcion: c.Descripcion,
      valor_unitario: c.ValorUnitario, importe: c.Importe, descuento: c.Descuento,
      objeto_imp: c.ObjetoImp,
    }));

  const impuestosNode = firstByLocalName(comp, 'Impuestos') || {};
  const traslados = childrenByLocalName(firstByLocalName(impuestosNode, 'Traslados') || {}, 'Traslado')
    .map(t => ({ base: t.Base, impuesto: t.Impuesto, tipo_factor: t.TipoFactor, tasa: t.TasaOCuota, importe: t.Importe }));

  const complemento = firstByLocalName(comp, 'Complemento') || {};
  const tfdNode = firstByLocalName(complemento, 'TimbreFiscalDigital');
  const tfd = tfdNode ? {
    version: tfdNode.Version, uuid: tfdNode.UUID, fecha_timbrado: tfdNode.FechaTimbrado,
    rfc_prov_certif: tfdNode.RfcProvCertif, sello_cfd: tfdNode.SelloCFD,
    no_certificado_sat: tfdNode.NoCertificadoSAT, sello_sat: tfdNode.SelloSAT,
  } : null;

  // Pagos 2.0 complement (tipo P)
  const pagosNode = firstByLocalName(complemento, 'Pagos');
  let pagos = null;
  if (pagosNode) {
    const totales = firstByLocalName(pagosNode, 'Totales') || {};
    pagos = {
      monto_total_pagos: totales.MontoTotalPagos,
      pagos: childrenByLocalName(pagosNode, 'Pago').map(p => ({
        fecha_pago: p.FechaPago, forma_de_pago: p.FormaDePagoP, moneda: p.MonedaP,
        monto: p.Monto, num_operacion: p.NumOperacion,
        doctos: childrenByLocalName(p, 'DoctoRelacionado').map(d => ({
          id_documento: d.IdDocumento, serie: d.Serie, folio: d.Folio,
          num_parcialidad: d.NumParcialidad, imp_saldo_ant: d.ImpSaldoAnt,
          imp_pagado: d.ImpPagado, imp_saldo_insoluto: d.ImpSaldoInsoluto,
        })),
      })),
    };
  }

  return {
    version: comp.Version, serie: comp.Serie, folio: comp.Folio, fecha: comp.Fecha,
    forma_pago: comp.FormaPago, metodo_pago: comp.MetodoPago,
    condiciones_pago: comp.CondicionesDePago,
    moneda: comp.Moneda, tipo_cambio: comp.TipoCambio,
    subtotal: comp.SubTotal, descuento: comp.Descuento, total: comp.Total,
    tipo_comprobante: comp.TipoDeComprobante, exportacion: comp.Exportacion,
    lugar_expedicion: comp.LugarExpedicion,
    no_certificado: comp.NoCertificado, sello_cfd: comp.Sello,
    emisor: { rfc: emisor.Rfc, nombre: emisor.Nombre, regimen: emisor.RegimenFiscal },
    receptor: {
      rfc: receptor.Rfc, nombre: receptor.Nombre, cp: receptor.DomicilioFiscalReceptor,
      regimen: receptor.RegimenFiscalReceptor, uso_cfdi: receptor.UsoCFDI,
    },
    conceptos, traslados,
    total_impuestos_trasladados: impuestosNode.TotalImpuestosTrasladados,
    tfd, pagos,
  };
}

// Cadena original del complemento de certificación digital del SAT — a
// REQUIRED element of the representación impresa (Anexo 20).
function tfdCadena(tfd) {
  return `||${tfd.version || '1.1'}|${tfd.uuid}|${tfd.fecha_timbrado}|${tfd.rfc_prov_certif}|${tfd.sello_cfd}|${tfd.no_certificado_sat}||`;
}

// SAT verification URL (the QR target): anyone can scan and confirm the CFDI
// against SAT. fe = last 8 characters of the SelloCFD.
function satVerificationUrl(model) {
  const sello = model.tfd?.sello_cfd || model.sello_cfd || '';
  return 'https://verificacfdi.facturacion.sat.gob.mx/default.aspx'
    + `?id=${model.tfd?.uuid || ''}&re=${model.emisor.rfc || ''}&rr=${model.receptor.rfc || ''}`
    + `&tt=${model.total || ''}&fe=${sello.slice(-8)}`;
}

// ---------------------------------------------------------------------------
// Total con letra — Spanish amount-in-words ("CIENTO DIECISÉIS PESOS 00/100 M.N.")
// ---------------------------------------------------------------------------
const UNIDADES = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
const DECENAS_ESPECIALES = {
  10: 'DIEZ', 11: 'ONCE', 12: 'DOCE', 13: 'TRECE', 14: 'CATORCE', 15: 'QUINCE',
  16: 'DIECISÉIS', 17: 'DIECISIETE', 18: 'DIECIOCHO', 19: 'DIECINUEVE',
  20: 'VEINTE', 21: 'VEINTIÚN', 22: 'VEINTIDÓS', 23: 'VEINTITRÉS', 24: 'VEINTICUATRO',
  25: 'VEINTICINCO', 26: 'VEINTISÉIS', 27: 'VEINTISIETE', 28: 'VEINTIOCHO', 29: 'VEINTINUEVE',
};
const DECENAS = ['', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

function centenasALetras(n) {
  if (n === 0) return '';
  if (n === 100) return 'CIEN';
  const c = Math.floor(n / 100);
  const resto = n % 100;
  let restoTxt = '';
  if (resto > 0) {
    if (DECENAS_ESPECIALES[resto]) restoTxt = DECENAS_ESPECIALES[resto];
    else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      restoTxt = d >= 3 ? (u ? `${DECENAS[d]} Y ${UNIDADES[u]}` : DECENAS[d]) : UNIDADES[u];
    }
  }
  return [CENTENAS[c], restoTxt].filter(Boolean).join(' ');
}

function enterosALetras(n) {
  if (n === 0) return 'CERO';
  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const cientos = n % 1000;
  const parts = [];
  if (millones) parts.push(millones === 1 ? 'UN MILLÓN' : `${enterosALetras(millones)} MILLONES`);
  if (miles) parts.push(miles === 1 ? 'MIL' : `${centenasALetras(miles)} MIL`);
  if (cientos) parts.push(centenasALetras(cientos));
  return parts.join(' ');
}

function totalConLetra(amount, moneda = 'MXN') {
  const num = Number(amount) || 0;
  const enteros = Math.floor(num);
  const centavos = Math.round((num - enteros) * 100);
  const unit = moneda === 'MXN' ? 'PESOS' : moneda === 'USD' ? 'DÓLARES' : moneda;
  const suffix = moneda === 'MXN' ? ' M.N.' : '';
  return `${enterosALetras(enteros)} ${unit} ${String(centavos).padStart(2, '0')}/100${suffix}`;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function hr(doc, y, color = COLORS.border) {
  doc.strokeColor(color).lineWidth(0.5)
    .moveTo(PAGE_MARGIN, y).lineTo(doc.page.width - PAGE_MARGIN, y).stroke();
  return y + 6;
}

function kv(doc, x, y, label, value, opts = {}) {
  doc.font('Helvetica-Bold').fontSize(6).fillColor(COLORS.muted).text(label.toUpperCase(), x, y, { width: opts.width });
  doc.font('Helvetica').fontSize(opts.valueSize || 7.5).fillColor(COLORS.text)
    .text(value === undefined || value === null || value === '' ? '—' : String(value), x, y + 7, { width: opts.width });
  return y + (opts.height || 20);
}

function money(v, moneda) {
  const n = Number(v);
  return Number.isFinite(n) ? `${moneda ? `${moneda} ` : ''}${n.toFixed(2)}` : (v ?? '');
}

/**
 * Render the representación impresa of a stamped CFDI.
 * @param {object} args
 * @param {string} args.xml       signed_xml (must carry the TFD) — fiscal truth
 * @param {string} [args.satStatus]  'vigente' | 'cancelado' (cancelado gets a watermark)
 * @param {string} [args.headerColor] org branding color
 * @returns {Promise<Buffer>}
 */
async function renderRepresentacionImpresa({ xml, satStatus = 'vigente', headerColor = COLORS.primary }) {
  const model = parseCfdiXml(xml);
  if (!model.tfd) {
    throw new Error('The XML carries no TimbreFiscalDigital — a representación impresa requires a stamped CFDI');
  }
  const qrPng = await QRCode.toBuffer(satVerificationUrl(model), { margin: 0, width: 256 });
  const isPago = model.tipo_comprobante === 'P';

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: PAGE_MARGIN });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const W = doc.page.width - PAGE_MARGIN * 2;

    // ---- Header ----
    doc.rect(PAGE_MARGIN, PAGE_MARGIN, W, 54).fill(COLORS.background);
    doc.fillColor(headerColor).font('Helvetica-Bold').fontSize(13)
      .text(model.emisor.nombre || '', PAGE_MARGIN + 8, PAGE_MARGIN + 7, { width: W * 0.55 });
    doc.fillColor(COLORS.text).font('Helvetica').fontSize(7)
      .text(`RFC: ${model.emisor.rfc || ''}   ·   Régimen: ${withDesc(model.emisor.regimen, REGIMEN_FISCAL)}`, PAGE_MARGIN + 8, PAGE_MARGIN + 26, { width: W * 0.55 })
      .text(`Lugar de expedición (C.P.): ${model.lugar_expedicion || ''}`, PAGE_MARGIN + 8, PAGE_MARGIN + 37, { width: W * 0.55 });
    doc.fillColor(headerColor).font('Helvetica-Bold').fontSize(12)
      .text(TIPO_COMPROBANTE[model.tipo_comprobante] || `CFDI ${model.tipo_comprobante || ''}`, PAGE_MARGIN, PAGE_MARGIN + 7, { width: W - 8, align: 'right' });
    doc.fillColor(COLORS.text).font('Helvetica').fontSize(8)
      .text(`Serie ${model.serie || '—'}  Folio ${model.folio || '—'}`, PAGE_MARGIN, PAGE_MARGIN + 24, { width: W - 8, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(7.5)
      .text(`CFDI ${model.version}`, PAGE_MARGIN, PAGE_MARGIN + 36, { width: W - 8, align: 'right' });

    let y = PAGE_MARGIN + 60;

    // ---- Fiscal identifiers ----
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(COLORS.muted).text('FOLIO FISCAL (UUID)', PAGE_MARGIN, y);
    doc.font('Courier-Bold').fontSize(9).fillColor(COLORS.text).text(model.tfd.uuid || '', PAGE_MARGIN, y + 8);
    y += 24;
    const col = W / 4;
    let yy = y;
    kv(doc, PAGE_MARGIN, yy, 'Fecha de emisión', model.fecha, { width: col });
    kv(doc, PAGE_MARGIN + col, yy, 'Fecha de timbrado', model.tfd.fecha_timbrado, { width: col });
    kv(doc, PAGE_MARGIN + col * 2, yy, 'No. certificado CSD', model.no_certificado, { width: col });
    y = kv(doc, PAGE_MARGIN + col * 3, yy, 'No. certificado SAT', model.tfd.no_certificado_sat, { width: col });
    yy = y;
    kv(doc, PAGE_MARGIN, yy, 'RFC proveedor de certificación', model.tfd.rfc_prov_certif, { width: col });
    kv(doc, PAGE_MARGIN + col, yy, 'Exportación', model.exportacion, { width: col });
    kv(doc, PAGE_MARGIN + col * 2, yy, 'Moneda', model.tipo_cambio ? `${model.moneda} (TC ${model.tipo_cambio})` : model.moneda, { width: col });
    y = kv(doc, PAGE_MARGIN + col * 3, yy, 'Estado SAT', (satStatus || '').toUpperCase(), { width: col });
    y = hr(doc, y + 2);

    // ---- Receptor ----
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(COLORS.muted).text('RECEPTOR', PAGE_MARGIN, y);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.text).text(model.receptor.nombre || '', PAGE_MARGIN, y + 8);
    y += 22;
    yy = y;
    kv(doc, PAGE_MARGIN, yy, 'RFC', model.receptor.rfc, { width: col });
    kv(doc, PAGE_MARGIN + col, yy, 'Régimen fiscal', withDesc(model.receptor.regimen, REGIMEN_FISCAL), { width: col });
    kv(doc, PAGE_MARGIN + col * 2, yy, 'Domicilio fiscal (C.P.)', model.receptor.cp, { width: col });
    y = kv(doc, PAGE_MARGIN + col * 3, yy, 'Uso CFDI', withDesc(model.receptor.uso_cfdi, USO_CFDI), { width: col });

    if (!isPago) {
      yy = y;
      kv(doc, PAGE_MARGIN, yy, 'Método de pago', withDesc(model.metodo_pago, METODO_PAGO), { width: col * 2 });
      y = kv(doc, PAGE_MARGIN + col * 2, yy, 'Forma de pago', withDesc(model.forma_pago, FORMA_PAGO), { width: col * 2 });
    }
    y = hr(doc, y + 2);

    // ---- Conceptos ----
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(headerColor);
    doc.text('CLAVE SAT', PAGE_MARGIN, y, { width: 55 });
    doc.text('CANT / UNIDAD', PAGE_MARGIN + 58, y, { width: 62 });
    doc.text('DESCRIPCIÓN', PAGE_MARGIN + 124, y, { width: 235 });
    doc.text('V. UNITARIO', PAGE_MARGIN + 362, y, { width: 80, align: 'right' });
    doc.text('IMPORTE', PAGE_MARGIN + 448, y, { width: W - 448, align: 'right' });
    y = hr(doc, y + 9);
    doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.text);
    for (const c of model.conceptos) {
      const descHeight = doc.heightOfString(c.descripcion || '', { width: 235 });
      doc.text(c.clave_prod_serv || '', PAGE_MARGIN, y, { width: 55 });
      doc.text(`${c.cantidad || ''} ${c.clave_unidad || ''}`.trim(), PAGE_MARGIN + 58, y, { width: 62 });
      doc.text(c.descripcion || '', PAGE_MARGIN + 124, y, { width: 235 });
      doc.text(money(c.valor_unitario), PAGE_MARGIN + 362, y, { width: 80, align: 'right' });
      doc.text(money(c.importe), PAGE_MARGIN + 448, y, { width: W - 448, align: 'right' });
      y += Math.max(11, descHeight + 3);
      if (y > 620) { doc.addPage(); y = PAGE_MARGIN; }
    }
    y = hr(doc, y + 2);

    // ---- Pagos section (tipo P) or totals ----
    if (isPago && model.pagos) {
      for (const p of model.pagos.pagos) {
        yy = y;
        kv(doc, PAGE_MARGIN, yy, 'Fecha de pago', p.fecha_pago, { width: col });
        kv(doc, PAGE_MARGIN + col, yy, 'Forma de pago', withDesc(p.forma_de_pago, FORMA_PAGO), { width: col });
        kv(doc, PAGE_MARGIN + col * 2, yy, 'Moneda', p.moneda, { width: col });
        y = kv(doc, PAGE_MARGIN + col * 3, yy, 'Monto', money(p.monto, p.moneda), { width: col });
        doc.font('Helvetica-Bold').fontSize(6.5).fillColor(headerColor);
        doc.text('DOCUMENTO RELACIONADO (UUID)', PAGE_MARGIN, y, { width: 220 });
        doc.text('SERIE-FOLIO', PAGE_MARGIN + 224, y, { width: 60 });
        doc.text('PARC.', PAGE_MARGIN + 288, y, { width: 34, align: 'center' });
        doc.text('SALDO ANT.', PAGE_MARGIN + 326, y, { width: 66, align: 'right' });
        doc.text('PAGADO', PAGE_MARGIN + 396, y, { width: 66, align: 'right' });
        doc.text('INSOLUTO', PAGE_MARGIN + 466, y, { width: W - 466, align: 'right' });
        y = hr(doc, y + 9);
        doc.font('Helvetica').fontSize(7).fillColor(COLORS.text);
        for (const d of p.doctos) {
          doc.font('Courier').fontSize(6.5).text(d.id_documento || '', PAGE_MARGIN, y, { width: 220 });
          doc.font('Helvetica').fontSize(7);
          doc.text(`${d.serie || ''}-${d.folio || ''}`, PAGE_MARGIN + 224, y, { width: 60 });
          doc.text(String(d.num_parcialidad || ''), PAGE_MARGIN + 288, y, { width: 34, align: 'center' });
          doc.text(money(d.imp_saldo_ant), PAGE_MARGIN + 326, y, { width: 66, align: 'right' });
          doc.text(money(d.imp_pagado), PAGE_MARGIN + 396, y, { width: 66, align: 'right' });
          doc.text(money(d.imp_saldo_insoluto), PAGE_MARGIN + 466, y, { width: W - 466, align: 'right' });
          y += 11;
        }
      }
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(headerColor)
        .text(`Monto total de pagos: ${money(model.pagos.monto_total_pagos, 'MXN')}`, PAGE_MARGIN, y + 4, { width: W, align: 'right' });
      y += 20;
    } else {
      const totX = PAGE_MARGIN + 340;
      const totW = W - 340;
      doc.font('Helvetica').fontSize(8).fillColor(COLORS.text);
      doc.text('Subtotal:', totX, y, { width: totW - 90, align: 'right' });
      doc.text(money(model.subtotal, model.moneda), totX + totW - 85, y, { width: 85, align: 'right' });
      y += 12;
      if (model.descuento) {
        doc.text('Descuento:', totX, y, { width: totW - 90, align: 'right' });
        doc.text(money(model.descuento, model.moneda), totX + totW - 85, y, { width: 85, align: 'right' });
        y += 12;
      }
      for (const t of model.traslados) {
        doc.text(`IVA ${(Number(t.tasa) * 100).toFixed(0)}% (base ${money(t.base)}):`, totX, y, { width: totW - 90, align: 'right' });
        doc.text(money(t.importe, model.moneda), totX + totW - 85, y, { width: 85, align: 'right' });
        y += 12;
      }
      doc.font('Helvetica-Bold').fontSize(10).fillColor(headerColor);
      doc.text('TOTAL:', totX, y, { width: totW - 90, align: 'right' });
      doc.text(money(model.total, model.moneda), totX + totW - 85, y, { width: 85, align: 'right' });
      // total con letra, bottom-left of the totals block
      doc.font('Helvetica-Oblique').fontSize(7).fillColor(COLORS.text)
        .text(`(${totalConLetra(model.total, model.moneda)})`, PAGE_MARGIN, y + 2, { width: 330 });
      y += 18;
    }
    y = hr(doc, y + 2);

    // ---- Seals + QR ----
    const qrSize = 88;
    if (y + qrSize > doc.page.height - PAGE_MARGIN - 10) { doc.addPage(); y = PAGE_MARGIN; }
    doc.image(qrPng, PAGE_MARGIN, y, { width: qrSize, height: qrSize });
    const sx = PAGE_MARGIN + qrSize + 10;
    const sw = W - qrSize - 10;
    let sy = y;
    const sealBlock = (label, value) => {
      doc.font('Helvetica-Bold').fontSize(5.5).fillColor(COLORS.muted).text(label, sx, sy, { width: sw });
      sy += 6;
      doc.font('Courier').fontSize(4.6).fillColor(COLORS.text).text(value || '', sx, sy, { width: sw, lineGap: -0.5 });
      sy = doc.y + 3;
    };
    sealBlock('SELLO DIGITAL DEL CFDI', model.tfd.sello_cfd);
    sealBlock('SELLO DEL SAT', model.tfd.sello_sat);
    sealBlock('CADENA ORIGINAL DEL COMPLEMENTO DE CERTIFICACIÓN DIGITAL DEL SAT', tfdCadena(model.tfd));
    y = Math.max(y + qrSize, sy) + 4;

    doc.font('Helvetica').fontSize(6).fillColor(COLORS.muted)
      .text('Este documento es una representación impresa de un CFDI · Verifique en https://verificacfdi.facturacion.sat.gob.mx', PAGE_MARGIN, y, { width: W, align: 'center' });

    // ---- CANCELADO watermark ----
    if (satStatus === 'cancelado') {
      doc.save();
      doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
      doc.font('Helvetica-Bold').fontSize(90).fillColor(COLORS.danger).opacity(0.16)
        .text('CANCELADO', 0, doc.page.height / 2 - 45, { width: doc.page.width, align: 'center' });
      doc.restore();
      doc.opacity(1);
    }

    doc.end();
  });
}

module.exports = {
  parseCfdiXml, tfdCadena, satVerificationUrl, totalConLetra,
  renderRepresentacionImpresa,
  // exported for the remisión marker on MX drafts (pdfService)
  SAT_CATALOGS: { USO_CFDI, FORMA_PAGO, METODO_PAGO, REGIMEN_FISCAL },
};
