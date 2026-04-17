/**
 * Property-based tests for auth middleware
 *
 * Property 8: Requests without valid JWT are always rejected with 401/403
 * Validates: Requirements 6.1, 6.4
 */

import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../src/config/env.js', () => ({
  ENV: {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key',
    CORPORATE_DOMAIN: 'exa.com.br',
    NODE_ENV: 'test',
  },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'Invalid token' } }),
    },
  })),
}));

const { requireAuth } = await import('../../src/middleware/auth.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRes() {
  const res = {
    _status: null,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; },
  };
  return res;
}

// ── Arbitraries ───────────────────────────────────────────────────────────────

// Invalid/missing authorization headers
const missingHeaderArb = fc.constant(undefined);
const malformedHeaderArb = fc.oneof(
  fc.constant(''),
  fc.constant('Basic dXNlcjpwYXNz'),
  fc.constant('Bearer'),
  fc.constant('bearer token'),
  fc.string({ minLength: 1, maxLength: 50 }).filter((s) => !s.startsWith('Bearer '))
);
const invalidTokenArb = fc.string({ minLength: 1, maxLength: 200 })
  .map((t) => `Bearer ${t}`);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('auth — Property 8: Requests without valid JWT are always rejected', () => {
  it('returns 401 when Authorization header is missing', async () => {
    await fc.assert(
      fc.asyncProperty(missingHeaderArb, async () => {
        const req = { headers: {} };
        const res = makeRes();
        const next = vi.fn();

        await requireAuth(req, res, next);

        return res._status === 401 && next.mock.calls.length === 0;
      }),
      { numRuns: 10 }
    );
  });

  it('returns 401 when Authorization header is malformed (not Bearer)', async () => {
    await fc.assert(
      fc.asyncProperty(malformedHeaderArb, async (header) => {
        const req = { headers: { authorization: header } };
        const res = makeRes();
        const next = vi.fn();

        await requireAuth(req, res, next);

        return res._status === 401 && next.mock.calls.length === 0;
      }),
      { numRuns: 100 }
    );
  });

  it('returns 401 when token is invalid (Supabase rejects it)', async () => {
    await fc.assert(
      fc.asyncProperty(invalidTokenArb, async (header) => {
        const req = { headers: { authorization: header } };
        const res = makeRes();
        const next = vi.fn();

        await requireAuth(req, res, next);

        // Must be 401 (invalid token) or 403 (wrong domain) — never 200 or next()
        return (res._status === 401 || res._status === 403) && next.mock.calls.length === 0;
      }),
      { numRuns: 100 }
    );
  });

  it('never calls next() for any invalid authorization header', async () => {
    const anyInvalidHeaderArb = fc.oneof(
      missingHeaderArb.map(() => undefined),
      malformedHeaderArb,
      invalidTokenArb
    );

    await fc.assert(
      fc.asyncProperty(anyInvalidHeaderArb, async (header) => {
        const req = { headers: header !== undefined ? { authorization: header } : {} };
        const res = makeRes();
        const next = vi.fn();

        await requireAuth(req, res, next);

        return next.mock.calls.length === 0;
      }),
      { numRuns: 200 }
    );
  });
});
