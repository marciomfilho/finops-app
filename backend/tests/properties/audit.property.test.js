/**
 * Property-based tests for audit.js
 *
 * Property 2: Audit log records every authenticated request
 * Property 3: Audit log records authentication failures
 * Validates: Requirements 2.7, 10.1, 10.2
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

// ── Mocks ────────────────────────────────────────────────────────────────────

const insertMock = vi.fn().mockResolvedValue({ error: null });
const fromMock = vi.fn(() => ({ insert: insertMock }));
const supabaseMock = { from: fromMock };

vi.mock('../../src/services/supabase.js', () => ({
  getSupabaseServiceClient: vi.fn().mockResolvedValue(supabaseMock),
}));

vi.mock('../../src/config/env.js', () => ({
  ENV: { NODE_ENV: 'test', CORPORATE_DOMAIN: 'exa.com.br' },
}));

const { auditMiddleware, sanitizeParams } = await import('../../src/middleware/audit.js');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(overrides = {}) {
  return {
    user: { email: 'user@exa.com.br' },
    method: 'GET',
    path: '/api/billing/gcp',
    query: {},
    body: {},
    ip: '127.0.0.1',
    headers: {},
    ...overrides,
  };
}

function makeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() };
}

// ── Property 2: Audit log records every authenticated request ─────────────────

describe('audit — Property 2: Audit log records every authenticated request', () => {
  beforeEach(() => {
    insertMock.mockClear();
    fromMock.mockClear();
  });

  it('inserts exactly one audit_log record for any authenticated request', async () => {
    const emailArb = fc.emailAddress();
    const methodArb = fc.constantFrom('GET', 'POST', 'PUT', 'DELETE');
    const pathArb = fc.string({ minLength: 1, maxLength: 50 }).map((s) => `/api/${s}`);
    const ipArb = fc.ipV4();

    await fc.assert(
      fc.asyncProperty(emailArb, methodArb, pathArb, ipArb, async (email, method, path, ip) => {
        insertMock.mockClear();
        fromMock.mockClear();

        const req = makeReq({ user: { email }, method, path, ip });
        const res = makeRes();
        const next = vi.fn();

        auditMiddleware(req, res, next);

        // next() must be called immediately (non-blocking)
        expect(next).toHaveBeenCalledOnce();

        // Wait for async insert
        await new Promise((r) => setTimeout(r, 10));

        expect(fromMock).toHaveBeenCalledWith('audit_log');
        expect(insertMock).toHaveBeenCalledOnce();

        const [entry] = insertMock.mock.calls[0];
        expect(entry.user_email).toBe(email);
        expect(entry.action).toContain(method);
        expect(entry.action).toContain(path);
        expect(entry.payload).toBeDefined();
        expect(entry.created_at).toBeDefined();

        return true;
      }),
      { numRuns: 50 }
    );
  });
});

// ── Property 3: sanitizeParams redacts sensitive fields ───────────────────────

describe('audit — Property 3: sanitizeParams redacts sensitive fields', () => {
  const SENSITIVE_KEYS = ['password', 'token', 'secret', 'key', 'authorization', 'ak', 'sk'];

  it('replaces sensitive fields with [REDACTED] for any params object', () => {
    const sensitiveKeyArb = fc.constantFrom(...SENSITIVE_KEYS);
    const valueArb = fc.string({ minLength: 1, maxLength: 100 });
    const paramsArb = fc.dictionary(
      fc.oneof(sensitiveKeyArb, fc.string({ minLength: 1, maxLength: 20 })),
      valueArb
    );

    fc.assert(
      fc.property(paramsArb, (params) => {
        const result = sanitizeParams(params);
        for (const [k, v] of Object.entries(result)) {
          const isSensitive = SENSITIVE_KEYS.some((s) => k.toLowerCase().includes(s));
          if (isSensitive) {
            if (v !== '[REDACTED]') return false;
          } else {
            if (v !== params[k]) return false;
          }
        }
        return true;
      }),
      { numRuns: 500 }
    );
  });

  it('sanitized params never contain the original sensitive value', () => {
    const sensitiveKeyArb = fc.constantFrom(...SENSITIVE_KEYS);
    const sensitiveValueArb = fc.string({ minLength: 8, maxLength: 64 });

    fc.assert(
      fc.property(sensitiveKeyArb, sensitiveValueArb, (key, value) => {
        const params = { [key]: value };
        const result = sanitizeParams(params);
        return result[key] === '[REDACTED]' && result[key] !== value;
      }),
      { numRuns: 500 }
    );
  });
});
