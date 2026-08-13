import { describe, expect, it } from 'vitest';
import {
  LEGAL_DOCUMENT_PLACEHOLDERS,
  LEGAL_DOCUMENT_PLACEHOLDER_HELP,
} from '@/legalDocumentPlaceholders';

describe('legal document placeholder help', () => {
  it('advertises every supported placeholder exactly once', () => {
    expect(new Set(LEGAL_DOCUMENT_PLACEHOLDERS).size).toBe(LEGAL_DOCUMENT_PLACEHOLDERS.length);
    expect(LEGAL_DOCUMENT_PLACEHOLDER_HELP).toBe(
      LEGAL_DOCUMENT_PLACEHOLDERS.map(path => `{{${path}}}`).join(' '),
    );
    expect(LEGAL_DOCUMENT_PLACEHOLDERS).toHaveLength(27);
  });
});
