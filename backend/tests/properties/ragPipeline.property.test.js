/**
 * Property-based tests for ragPipeline.js — buildContext
 *
 * Property 1: RAG context never contains credentials
 * Validates: Requirements 7.4, 3.5
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

const CREDENTIAL_PATTERNS = [
  /^[A-Z0-9]{20,}$/m,
  /^[A-Za-z0-9+/]{40,}$/m,
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/m,
  /"private_key"/,
  /"client_email"/,
  /AIza[0-9A-Za-z_-]{35}/,
];

function containsCredential(text) {
  return CREDENTIAL_PATTERNS.some((p) => p.test(text));
}

const chunkArb = fc.record({
  record_type: fc.string({ minLength: 1, maxLength: 50 }),
  content: fc.string({ minLength: 0, maxLength: 500 }),
  similarity: fc.float({ min: 0, max: 1, noNaN: true }),
});

const chunksArb = fc.array(chunkArb, { minLength: 0, maxLength: 20 });
const maxTokensArb = fc.integer({ min: 100, max: 16000 });

describe('ragPipeline — Property 1: RAG context never contains credentials', () => {
  it('buildContext output never matches credential patterns for arbitrary chunks and maxTokens', () => {
    fc.assert(
      fc.property(chunksArb, maxTokensArb, (chunks, maxTokens) => {
        const context = buildContext(chunks, maxTokens);
        return !containsCredential(context);
      }),
      { numRuns: 1000 }
    );
  });
});
