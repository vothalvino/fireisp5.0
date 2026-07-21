// =============================================================================
// FireISP 5.0 — invoice-PDF fiscal gating (MX vs global orgs)
// =============================================================================
// USER CONSTRAINT (pinned): the representación impresa work must NEVER touch
// non-MX org invoicing. Global orgs keep their exact plain-invoice path — no
// CFDI lookup, no fiscal renderer, no remisión wording.
// =============================================================================

jest.mock('../src/config/database');
jest.mock('../src/services/cfdiRepresentacionPdf', () => ({
  renderRepresentacionImpresa: jest.fn().mockResolvedValue(Buffer.from('%PDF-fiscal')),
}));

const db = require('../src/config/database');
const repr = require('../src/services/cfdiRepresentacionPdf');
const pdfService = require('../src/services/pdfService');

const BASE_INVOICE = {
  id: 605, organization_id: 5, client_id: 42, invoice_number: 'INV-1',
  status: 'issued', currency: 'MXN', subtotal: '100.00', tax_amount: '16.00', total: '116.00',
  created_at: '2026-07-20', due_date: '2026-08-01',
  name: 'Client', org_name: 'Org',
};

function wireDb({ orgLocale, cfdi = null } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (/FROM invoices i/.test(sql)) return [[{ ...BASE_INVOICE, org_locale: orgLocale }]];
    if (/FROM cfdi_documents/.test(sql)) return [cfdi ? [cfdi] : []];
    if (/organization_invoice_settings/.test(sql)) return [[]];
    if (/invoice_items/.test(sql)) return [[{ description: 'Internet', quantity: 1, unit_price: '100.00', amount: '100.00' }]];
    return [[]];
  });
}

describe('generateInvoicePdf — MX fiscal gate', () => {
  beforeEach(() => jest.clearAllMocks());

  test('GLOBAL org: plain path untouched — no CFDI lookup, fiscal renderer never called', async () => {
    wireDb({ orgLocale: null });
    const buf = await pdfService.generateInvoicePdf(605);
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
    expect(repr.renderRepresentacionImpresa).not.toHaveBeenCalled();
    expect(db.query.mock.calls.some(c => /cfdi_documents/.test(c[0]))).toBe(false);
  });

  test('GLOBAL org with any other locale string: same untouched path', async () => {
    wireDb({ orgLocale: 'US' });
    await pdfService.generateInvoicePdf(605);
    expect(repr.renderRepresentacionImpresa).not.toHaveBeenCalled();
    expect(db.query.mock.calls.some(c => /cfdi_documents/.test(c[0]))).toBe(false);
  });

  test('MX org with a vigente CFDI: representación impresa from signed_xml', async () => {
    wireDb({ orgLocale: 'MX', cfdi: { signed_xml: '<x><tfd:TimbreFiscalDigital/></x>', sat_status: 'vigente' } });
    const buf = await pdfService.generateInvoicePdf(605);
    expect(buf.toString()).toBe('%PDF-fiscal');
    expect(repr.renderRepresentacionImpresa).toHaveBeenCalledWith(
      expect.objectContaining({ xml: '<x><tfd:TimbreFiscalDigital/></x>', satStatus: 'vigente' }),
    );
  });

  test('MX org with a cancelado CFDI: representación with the cancelado watermark state', async () => {
    wireDb({ orgLocale: 'MX', cfdi: { signed_xml: '<x><tfd:TimbreFiscalDigital/></x>', sat_status: 'cancelado' } });
    await pdfService.generateInvoicePdf(605);
    expect(repr.renderRepresentacionImpresa).toHaveBeenCalledWith(
      expect.objectContaining({ satStatus: 'cancelado' }),
    );
  });

  test('MX org WITHOUT a stamped CFDI: plain layout (remisión path), fiscal renderer not called', async () => {
    wireDb({ orgLocale: 'MX' });
    const buf = await pdfService.generateInvoicePdf(605);
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
    expect(repr.renderRepresentacionImpresa).not.toHaveBeenCalled();
  });

  test('MX org with a TFD-LESS "stamped" doc (simulator/dev): remisión path, never the renderer (no 500)', async () => {
    // Simulator/dev stamps store the pre-stamp builder XML as signed_xml —
    // renderRepresentacionImpresa would throw on it (review-confirmed 500
    // on every PDF route incl. invoice emails).
    wireDb({ orgLocale: 'MX', cfdi: { signed_xml: '<cfdi:Comprobante Version="4.0"/>', sat_status: 'vigente' } });
    const buf = await pdfService.generateInvoicePdf(605);
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
    expect(repr.renderRepresentacionImpresa).not.toHaveBeenCalled();
  });

  test('MX org with a cancel_pending CFDI: still a valid representación (satStatus vigente), never remisión', async () => {
    wireDb({ orgLocale: 'MX', cfdi: { signed_xml: '<x><tfd:TimbreFiscalDigital/></x>', sat_status: 'cancel_pending' } });
    const buf = await pdfService.generateInvoicePdf(605);
    expect(buf.toString()).toBe('%PDF-fiscal');
    expect(repr.renderRepresentacionImpresa).toHaveBeenCalledWith(
      expect.objectContaining({ satStatus: 'vigente' }),
    );
  });
});
