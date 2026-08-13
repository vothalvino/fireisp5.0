'use strict';

const fs = require('fs');
const path = require('path');
const legalDocumentService = require('../src/services/legalDocumentService');

describe('legal document placeholder UI parity', () => {
  it('keeps the shared frontend help list equal to the backend allowlist', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../frontend/src/legalDocumentPlaceholders.ts'),
      'utf8',
    );
    const arraySource = source.match(/LEGAL_DOCUMENT_PLACEHOLDERS\s*=\s*\[([\s\S]*?)\]\s*as const/);
    expect(arraySource).not.toBeNull();
    const frontendPaths = [...arraySource[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
    expect(frontendPaths).toEqual(legalDocumentService.SUPPORTED_PLACEHOLDERS);
  });
});
