// =============================================================================
// FireISP 5.0 — Sanitization Middleware Tests
// =============================================================================

const { sanitize, escapeHtml, sanitizeValue, sanitizeObject } = require('../src/middleware/sanitize');

describe('escapeHtml', () => {
  test('escapes HTML characters', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  test('escapes ampersands', () => {
    expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
  });

  test('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe('it&#x27;s');
  });

  test('leaves safe strings untouched', () => {
    expect(escapeHtml('hello world 123')).toBe('hello world 123');
  });

  test('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });
});

describe('sanitizeValue', () => {
  test('sanitizes strings', () => {
    expect(sanitizeValue('<b>bold</b>')).toBe('&lt;b&gt;bold&lt;/b&gt;');
  });

  test('passes through numbers', () => {
    expect(sanitizeValue(42)).toBe(42);
  });

  test('passes through booleans', () => {
    expect(sanitizeValue(true)).toBe(true);
  });

  test('passes through null', () => {
    expect(sanitizeValue(null)).toBe(null);
  });

  test('passes through undefined', () => {
    expect(sanitizeValue(undefined)).toBe(undefined);
  });

  test('sanitizes arrays of strings', () => {
    expect(sanitizeValue(['<a>', 'ok'])).toEqual(['&lt;a&gt;', 'ok']);
  });

  test('sanitizes nested objects', () => {
    const result = sanitizeValue({ name: '<script>x</script>', count: 5 });
    expect(result).toEqual({ name: '&lt;script&gt;x&lt;/script&gt;', count: 5 });
  });
});

describe('sanitizeObject', () => {
  test('sanitizes all string properties', () => {
    const obj = { name: 'test<script>', age: 30, active: true, notes: null };
    const result = sanitizeObject(obj);
    expect(result).toEqual({ name: 'test&lt;script&gt;', age: 30, active: true, notes: null });
  });

  test('handles deeply nested objects', () => {
    const obj = { data: { items: [{ name: '<b>hi</b>' }] } };
    const result = sanitizeObject(obj);
    expect(result.data.items[0].name).toBe('&lt;b&gt;hi&lt;/b&gt;');
  });
});

describe('sanitize middleware', () => {
  test('sanitizes req.body strings', () => {
    const req = { body: { name: '<script>alert(1)</script>', count: 42 } };
    const res = {};
    const next = jest.fn();

    sanitize(req, res, next);

    expect(req.body.name).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(req.body.count).toBe(42);
    expect(next).toHaveBeenCalled();
  });

  test('handles missing body gracefully', () => {
    const req = {};
    const res = {};
    const next = jest.fn();

    sanitize(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('handles null body', () => {
    const req = { body: null };
    const res = {};
    const next = jest.fn();

    sanitize(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('handles non-object body', () => {
    const req = { body: 'raw string' };
    const res = {};
    const next = jest.fn();

    sanitize(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
