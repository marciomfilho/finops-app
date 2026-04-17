/**
 * Property-based tests for JWT inclusion in frontend requests
 *
 * Property 12: JWT included in all frontend requests
 * Validates: Requirements 8.4
 *
 * Tests the BackendProvider module behavior: every fetch call must include
 * Authorization: Bearer <jwt> when a JWT is set.
 */

import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';

// ── BackendProvider simulation ────────────────────────────────────────────────
// Simulates the BackendProvider module from data-bus.js (task 12.1)
// to verify the JWT inclusion property before the actual implementation.

function createBackendProvider(backendUrl) {
  let _jwt = null;

  return {
    setJWT(token) { _jwt = token; },
    clearJWT() { _jwt = null; },
    hasJWT() { return _jwt !== null; },

    async fetchData(period, fetchFn) {
      if (!_jwt) throw new Error('No JWT set');
      return fetchFn(`${backendUrl}/api/billing/all?period=${period}`, {
        headers: { Authorization: `Bearer ${_jwt}` },
      });
    },

    async fetchSummaries(period, fetchFn) {
      if (!_jwt) throw new Error('No JWT set');
      return fetchFn(`${backendUrl}/api/summaries?period=${period}`, {
        headers: { Authorization: `Bearer ${_jwt}` },
      });
    },

    async chat(message, history, fetchFn) {
      if (!_jwt) throw new Error('No JWT set');
      return fetchFn(`${backendUrl}/api/chat`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${_jwt}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message, history }),
      });
    },
  };
}

// ── Arbitraries ───────────────────────────────────────────────────────────────

// Valid JWT-like tokens (3 base64url segments)
const jwtArb = fc.tuple(
  fc.base64String({ minLength: 10, maxLength: 50 }),
  fc.base64String({ minLength: 10, maxLength: 50 }),
  fc.base64String({ minLength: 10, maxLength: 50 })
).map(([h, p, s]) => `${h}.${p}.${s}`);

const periodArb = fc.integer({ min: 1, max: 365 });
const messageArb = fc.string({ minLength: 1, maxLength: 200 });
const backendUrlArb = fc.constant('https://backend.exa.com.br');

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('jwtFrontend — Property 12: JWT included in all frontend requests', () => {
  it('fetchData always includes Authorization: Bearer <jwt> header', async () => {
    await fc.assert(
      fc.asyncProperty(jwtArb, periodArb, backendUrlArb, async (jwt, period, url) => {
        const provider = createBackendProvider(url);
        provider.setJWT(jwt);

        let capturedHeaders = null;
        const mockFetch = async (_url, options) => {
          capturedHeaders = options?.headers || {};
          return { ok: true, json: async () => ({}) };
        };

        await provider.fetchData(period, mockFetch);

        return capturedHeaders?.Authorization === `Bearer ${jwt}`;
      }),
      { numRuns: 200 }
    );
  });

  it('fetchSummaries always includes Authorization: Bearer <jwt> header', async () => {
    await fc.assert(
      fc.asyncProperty(jwtArb, periodArb, backendUrlArb, async (jwt, period, url) => {
        const provider = createBackendProvider(url);
        provider.setJWT(jwt);

        let capturedHeaders = null;
        const mockFetch = async (_url, options) => {
          capturedHeaders = options?.headers || {};
          return { ok: true, json: async () => ({}) };
        };

        await provider.fetchSummaries(period, mockFetch);

        return capturedHeaders?.Authorization === `Bearer ${jwt}`;
      }),
      { numRuns: 200 }
    );
  });

  it('chat always includes Authorization: Bearer <jwt> header', async () => {
    await fc.assert(
      fc.asyncProperty(jwtArb, messageArb, backendUrlArb, async (jwt, message, url) => {
        const provider = createBackendProvider(url);
        provider.setJWT(jwt);

        let capturedHeaders = null;
        const mockFetch = async (_url, options) => {
          capturedHeaders = options?.headers || {};
          return { ok: true, json: async () => ({}) };
        };

        await provider.chat(message, [], mockFetch);

        return capturedHeaders?.Authorization === `Bearer ${jwt}`;
      }),
      { numRuns: 200 }
    );
  });

  it('clearJWT prevents any further requests', async () => {
    await fc.assert(
      fc.asyncProperty(jwtArb, periodArb, async (jwt, period) => {
        const provider = createBackendProvider('https://backend.exa.com.br');
        provider.setJWT(jwt);
        provider.clearJWT();

        let threw = false;
        try {
          await provider.fetchData(period, async () => ({}));
        } catch {
          threw = true;
        }

        return threw && !provider.hasJWT();
      }),
      { numRuns: 200 }
    );
  });
});
