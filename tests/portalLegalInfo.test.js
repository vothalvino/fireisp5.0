'use strict';
// =============================================================================
// FireISP 5.0 — GET /portal/legal-info (migration 449)
// =============================================================================
// The portal footer's Carta de Derechos link: MX clients get the org's
// configured URL or the official IFT document; the locale travels with it so
// the footer only renders the link for MX subscribers.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(), execute: jest.fn(), getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
}));
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn().mockReturnValue('mock.access.token'),
  verify: jest.fn(),
}));

const request = require('supertest');
const db = require('../src/config/database');
const jwt = require('jsonwebtoken');
const app = require('../src/app');

beforeEach(() => jest.clearAllMocks());

function wire({ client, cartaUrl }) {
  jwt.verify.mockReturnValue({ sub: 1, orgId: client.organization_id, type: 'portal' });
  db.query.mockImplementation((sql) => {
    // portalAuthenticate's identity lookup (no locale column — that omission
    // is exactly why the endpoint reads locale itself; this test caught it).
    if (/SELECT id, organization_id, name, email, status FROM clients/.test(sql)) {
      return Promise.resolve([[{ id: client.id, organization_id: client.organization_id, name: client.name, email: client.email, status: client.status }]]);
    }
    if (/LEFT JOIN organization_mx_profiles/.test(sql)) {
      return Promise.resolve([[{ locale: client.locale, carta_derechos_url: cartaUrl ?? null }]]);
    }
    return Promise.resolve([[]]);
  });
}

const MX_CLIENT = { id: 1, organization_id: 5, name: 'María', email: 'm@x.mx', status: 'active', locale: 'MX' };

it('returns the org-configured Carta URL for an MX client', async () => {
  wire({ client: MX_CLIENT, cartaUrl: 'https://mx-isp.example/carta.pdf' });
  const res = await request(app)
    .get('/api/v1/portal/legal-info')
    .set('Authorization', 'Bearer portal.valid');
  expect(res.status).toBe(200);
  expect(res.body.data).toEqual({ locale: 'MX', carta_derechos_url: 'https://mx-isp.example/carta.pdf' });
});

it('falls back to the official IFT document when the org has none configured', async () => {
  wire({ client: MX_CLIENT, cartaUrl: null });
  const res = await request(app)
    .get('/api/v1/portal/legal-info')
    .set('Authorization', 'Bearer portal.valid');
  expect(res.status).toBe(200);
  expect(res.body.data.carta_derechos_url).toMatch(/^https:\/\/www\.ift\.org\.mx\//);
});

it('a global client gets locale global — the footer link stays hidden', async () => {
  wire({ client: { ...MX_CLIENT, locale: 'global', organization_id: 1 }, cartaUrl: undefined });
  const res = await request(app)
    .get('/api/v1/portal/legal-info')
    .set('Authorization', 'Bearer portal.valid');
  expect(res.status).toBe(200);
  expect(res.body.data.locale).toBe('global');
});
