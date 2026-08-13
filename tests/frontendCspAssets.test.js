'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

describe('frontend assets comply with the production CSP', () => {
  it('keeps service-worker registration in a same-origin external script', () => {
    const html = read('frontend/index.html');
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];

    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts.every(([, attributes, body]) => /\bsrc=/.test(attributes) && body.trim() === '')).toBe(true);
    expect(html).toContain('src="/register-service-worker.js"');
    expect(read('frontend/public/register-service-worker.js')).toContain("navigator.serviceWorker.register('/sw.js')");
  });

  it('prevents Vite from inlining fonts as CSP-blocked data URLs', () => {
    expect(read('frontend/vite.config.ts')).toMatch(/assetsInlineLimit:\s*0/);
  });
});
