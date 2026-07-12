// =============================================================================
// FireISP 5.0 — TicketDetail AI helpers tests
// =============================================================================
// Covers the ai-summary response contract (backend returns { skipped } or
// { logId, draftText, action } — never `summary`) and kb_article_ids parsing
// (JSON column: array from mysql2, but tolerate JSON strings and legacy CSV).
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAuthedFetch = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: vi.fn(), POST: vi.fn() },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
  authedFetch: (...args: unknown[]) => mockAuthedFetch(...args),
}));

import { postAiSummary, parseKbArticleIds } from '../TicketDetail';

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: () => Promise.resolve(body) };
}

describe('postAiSummary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns draftText from a successful generation', async () => {
    mockAuthedFetch.mockResolvedValue(jsonResponse({
      data: { skipped: false, logId: 5, draftText: 'Resumen del ticket', action: 'proposed' },
    }));
    await expect(postAiSummary(1)).resolves.toBe('Resumen del ticket');
  });

  it('throws the policy reason when the pipeline is skipped', async () => {
    mockAuthedFetch.mockResolvedValue(jsonResponse({
      data: { skipped: true, reason: 'policy_disabled' },
    }));
    await expect(postAiSummary(1)).rejects.toThrow('policy_disabled');
  });

  it('throws when generation failed and no draft was produced', async () => {
    mockAuthedFetch.mockResolvedValue(jsonResponse({
      data: { skipped: false, logId: 5, draftText: null, action: 'failed' },
    }));
    await expect(postAiSummary(1)).rejects.toThrow(/failed/i);
  });

  it('throws on a non-OK HTTP response', async () => {
    mockAuthedFetch.mockResolvedValue(jsonResponse({}, false));
    await expect(postAiSummary(1)).rejects.toThrow('Failed to generate summary');
  });
});

describe('parseKbArticleIds', () => {
  it('accepts a parsed JSON array (mysql2 JSON column)', () => {
    expect(parseKbArticleIds([3, 8])).toEqual([3, 8]);
  });

  it('accepts a JSON string', () => {
    expect(parseKbArticleIds('[3,8]')).toEqual([3, 8]);
  });

  it('accepts legacy CSV', () => {
    expect(parseKbArticleIds('3,8')).toEqual([3, 8]);
  });

  it('returns [] for null or empty input', () => {
    expect(parseKbArticleIds(null)).toEqual([]);
    expect(parseKbArticleIds('')).toEqual([]);
  });
});
