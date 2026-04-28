// =============================================================================
// FireISP 5.0 — Changelog Route Tests (P3.8)
// =============================================================================

const request = require('supertest');
const app = require('../src/app');

describe('GET /api/v1/changelog', () => {
  it('returns 200 with an array', async () => {
    const res = await request(app).get('/api/v1/changelog');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('requires no authentication token', async () => {
    const res = await request(app).get('/api/v1/changelog');
    expect(res.status).toBe(200);
  });

  it('returns entries sorted newest-first', async () => {
    const res = await request(app).get('/api/v1/changelog');
    const dates = res.body.data.map((e) => new Date(e.date).getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i]);
    }
  });

  it('each entry has id, date, title, body, tags', async () => {
    const res = await request(app).get('/api/v1/changelog');
    for (const entry of res.body.data) {
      expect(typeof entry.id).toBe('string');
      expect(typeof entry.date).toBe('string');
      expect(typeof entry.title).toBe('string');
      expect(typeof entry.body).toBe('string');
      expect(Array.isArray(entry.tags)).toBe(true);
    }
  });

  it('returns at least one entry', async () => {
    const res = await request(app).get('/api/v1/changelog');
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('tags are arrays of strings', async () => {
    const res = await request(app).get('/api/v1/changelog');
    for (const entry of res.body.data) {
      for (const tag of entry.tags) {
        expect(typeof tag).toBe('string');
      }
    }
  });
});
