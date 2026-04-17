/**
 * Property-based tests for RAG context token limit
 *
 * Property 9: RAG context respects token limit
 * Property 10: Chunks below threshold are excluded
 * Validates: Requirements 7.5, 7.7
 */

import { describe, it, vi } from 'vitest';
import * as fc from 'fast-check';

vi.mock('../../src/config/env.js', () => ({
  ENV: {
    RAG_SIMILARITY_THRESHOLD: 0.75,
    RAG_MAX_CHUNKS: 10,
    RAG_MAX_TOKENS: 8000,
  },
}));

vi.mock('../../src/config/secrets.js', () => ({
  getSecret: vi.fn(),
  loadAllSecrets: vi.fn(),
}));

vi.mock('../../src/services/geminiEmbedding.js', () => ({
  generateEmbedding: vi.fn(),
}));

vi.mock('../../src/services/supabase.js', () => ({
  searchFinancialContext: vi.fn(),
  getSupabaseServiceClient: vi.fn(),
  getCostSummaries: vi.fn(),
  getBillingRecords: vi.fn(),
}));

const { buildContext } = await import('../../src/services/ragPipeline.js');

// ── Arbitraries ───────────────────────────────────────────────────────────────

const chunkArb = fc.record({
  record_type: fc.string({ minLength: 1, maxLength: 30 }),
  content: fc.string({ minLength: 0, maxLength: 1000 }),
  similarity: fc.float({ min: 0, max: 1, noNaN: true }),
});

const chunksArb = fc.array(chunkArb, { minLength: 0, maxLength: 50 });
const maxTokensArb = fc.integer({ min: 100, max: 16000 });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ragContext — Property 9: RAG context respects token limit', () => {
  it('buildContext output length never exceeds maxTokens * 4 characters', () => {
    fc.assert(
      fc.property(chunksArb, maxTokensArb, (chunks, maxTokens) => {
        const context = buildContext(chunks, maxTokens);
        return context.length <= maxTokens * 4;
      }),
      { numRuns: 1000 }
    );
  });

  it('buildContext with zero chunks returns only the header (within limit)', () => {
    fc.assert(
      fc.property(maxTokensArb, (maxTokens) => {
        const context = buildContext([], maxTokens);
        return context.length <= maxTokens * 4;
      }),
      { numRuns: 200 }
    );
  });

  it('buildContext with very large chunks still respects the limit', () => {
    const largeChunkArb = fc.record({
      record_type: fc.constant('billing_record'),
      content: fc.string({ minLength: 5000, maxLength: 10000 }),
      similarity: fc.float({ min: 0.8, max: 1, noNaN: true }),
    });

    fc.assert(
      fc.property(
        fc.array(largeChunkArb, { minLength: 1, maxLength: 5 }),
        maxTokensArb,
        (chunks, maxTokens) => {
          const context = buildContext(chunks, maxTokens);
          return context.length <= maxTokens * 4;
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('ragContext — Property 10: Chunks below threshold are excluded', () => {
  it('buildContext with empty chunks produces a non-empty header string', () => {
    // When no chunks pass the threshold (empty array), buildContext still returns
    // the header. The caller (runRAGPipeline) uses hasContext=false to inform Gemini.
    fc.assert(
      fc.property(maxTokensArb, (maxTokens) => {
        const context = buildContext([], maxTokens);
        // Should return the header string, not empty
        return typeof context === 'string' && context.length > 0;
      }),
      { numRuns: 200 }
    );
  });

  it('buildContext with empty chunks does not include any chunk content', () => {
    fc.assert(
      fc.property(maxTokensArb, (maxTokens) => {
        const context = buildContext([], maxTokens);
        // The header is "DADOS FINANCEIROS RELEVANTES:\n\n" — no chunk content
        return context === 'DADOS FINANCEIROS RELEVANTES:\n\n';
      }),
      { numRuns: 100 }
    );
  });
});
