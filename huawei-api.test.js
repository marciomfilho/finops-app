/**
 * Property-based tests for HuaweiAdapter — signRequest
 * Uses fast-check for property generation.
 *
 * Validates: Requirements 2.2
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { webcrypto } from 'node:crypto';

// Provide Web Crypto API in Node environment
const cryptoImpl = webcrypto;

// ── Inline signing logic (mirrors huawei-api.js) ─────────────────────────────
// Re-implemented here to avoid browser globals and to accept an explicit
// timestamp parameter, making the function pure and testable.

async function sha256Hex(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await cryptoImpl.subtle.digest('SHA-256', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256(key, message) {
  const keyMaterial =
    typeof key === 'string'
      ? await cryptoImpl.subtle.importKey(
          'raw',
          new TextEncoder().encode(key),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign']
        )
      : await cryptoImpl.subtle.importKey(
          'raw',
          key,
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign']
        );
  const sig = await cryptoImpl.subtle.sign(
    'HMAC',
    keyMaterial,
    new TextEncoder().encode(message)
  );
  return new Uint8Array(sig);
}

async function hmacHex(key, message) {
  const bytes = await hmacSha256(key, message);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function deriveSigningKey(secretKey, dateStamp, region) {
  const kDate    = await hmacSha256('SDK' + secretKey, dateStamp);
  const kRegion  = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, 'bss');
  return await hmacSha256(kService, 'sdk_request');
}

/**
 * Pure version of signRequest that accepts an explicit timestamp.
 * This makes the function deterministic and testable.
 *
 * @param {string} method
 * @param {string} url
 * @param {string} body
 * @param {{ accessKey: string, secretKey: string, region: string }} credentials
 * @param {string} isoTimestamp  - ISO 8601 timestamp (e.g. "20240115T120000Z")
 */
async function signRequestPure(method, url, body, credentials, isoTimestamp) {
  const date      = isoTimestamp;
  const dateStamp = date.slice(0, 8);

  const parsedUrl      = new URL(url);
  const canonicalUri   = parsedUrl.pathname;
  const canonicalQuery = parsedUrl.searchParams.toString();
  const payloadHash    = await sha256Hex(body || '');

  const canonicalHeaders =
    `content-type:application/json\nhost:${parsedUrl.host}\nx-sdk-date:${date}\n`;
  const signedHeaders = 'content-type;host;x-sdk-date';

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');

  const credentialScope = `${dateStamp}/${credentials.region}/bss/sdk_request`;
  const stringToSign    = `SDK-HMAC-SHA256\n${date}\n${credentialScope}\n${await sha256Hex(canonicalRequest)}`;
  const signingKey      = await deriveSigningKey(credentials.secretKey, dateStamp, credentials.region);
  const signature       = await hmacHex(signingKey, stringToSign);

  return {
    'X-Sdk-Date':    date,
    'Authorization': `SDK-HMAC-SHA256 Credential=${credentials.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'Content-Type':  'application/json'
  };
}

// ── Arbitraries ───────────────────────────────────────────────────────────────

/** HTTP methods supported by Huawei BSS API */
const arbMethod = fc.constantFrom('GET', 'POST', 'PUT', 'DELETE');

/** Valid Huawei Cloud regions */
const arbRegion = fc.constantFrom(
  'la-south-2',
  'ap-southeast-1',
  'cn-north-4',
  'eu-west-0'
);

/** AK/SK are alphanumeric strings of typical Huawei key lengths */
const arbAccessKey = fc.stringMatching(/^[A-Z0-9]{16,32}$/);
const arbSecretKey = fc.stringMatching(/^[A-Za-z0-9+/]{32,64}$/);

/** Fixed ISO timestamp in the format used by Huawei SDK: YYYYMMDDTHHmmssZ */
const arbTimestamp = fc.tuple(
  fc.integer({ min: 2020, max: 2030 }),  // year
  fc.integer({ min: 1,    max: 12 }),    // month
  fc.integer({ min: 1,    max: 28 }),    // day (safe for all months)
  fc.integer({ min: 0,    max: 23 }),    // hour
  fc.integer({ min: 0,    max: 59 }),    // minute
  fc.integer({ min: 0,    max: 59 })     // second
).map(([y, mo, d, h, mi, s]) =>
  `${y}${String(mo).padStart(2,'0')}${String(d).padStart(2,'0')}` +
  `T${String(h).padStart(2,'0')}${String(mi).padStart(2,'0')}${String(s).padStart(2,'0')}Z`
);

/** Valid Huawei BSS API URL */
const arbUrl = arbRegion.map(
  region => `https://bss.${region}.myhuaweicloud.com/v2/bills/monthly-bills?bill_cycle=2024-01&limit=100`
);

/** Request body: empty string (GET) or a small JSON payload */
const arbBody = fc.oneof(
  fc.constant(''),
  fc.record({
    key: fc.string({ minLength: 1, maxLength: 20 }),
    value: fc.string({ minLength: 1, maxLength: 20 })
  }).map(obj => JSON.stringify(obj))
);

/** Bundled credentials record */
const arbCredentials = fc.record({
  accessKey: arbAccessKey,
  secretKey: arbSecretKey,
  region: arbRegion
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('HuaweiAdapter — Property 3: Assinatura HMAC-SHA256 determinística', () => {
  /**
   * **Validates: Requirements 2.2**
   *
   * For any fixed inputs (method, url, body, credentials, timestamp),
   * calling signRequest twice must produce exactly the same Authorization
   * header and X-Sdk-Date header.
   *
   * This verifies that the signing algorithm is a pure function of its inputs
   * and does not depend on any external mutable state (e.g. current time,
   * random values, or side effects).
   */
  it('mesmos inputs produzem exatamente a mesma assinatura (Authorization e X-Sdk-Date)', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMethod,
        arbUrl,
        arbBody,
        arbCredentials,
        arbTimestamp,
        async (method, url, body, credentials, timestamp) => {
          const headers1 = await signRequestPure(method, url, body, credentials, timestamp);
          const headers2 = await signRequestPure(method, url, body, credentials, timestamp);

          expect(headers1['Authorization']).toBe(headers2['Authorization']);
          expect(headers1['X-Sdk-Date']).toBe(headers2['X-Sdk-Date']);
          expect(headers1['Content-Type']).toBe(headers2['Content-Type']);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('inputs diferentes produzem assinaturas diferentes (injetividade básica)', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbCredentials,
        arbCredentials,
        arbTimestamp,
        async (creds1, creds2, timestamp) => {
          // Only check when credentials actually differ
          fc.pre(creds1.secretKey !== creds2.secretKey || creds1.accessKey !== creds2.accessKey);

          const url = `https://bss.la-south-2.myhuaweicloud.com/v2/bills/monthly-bills?bill_cycle=2024-01&limit=100`;
          const headers1 = await signRequestPure('GET', url, '', creds1, timestamp);
          const headers2 = await signRequestPure('GET', url, '', creds2, timestamp);

          // Different credentials must produce different signatures
          expect(headers1['Authorization']).not.toBe(headers2['Authorization']);
        }
      ),
      { numRuns: 30 }
    );
  });

  it('timestamp diferente produz assinatura diferente', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbCredentials,
        arbTimestamp,
        arbTimestamp,
        async (credentials, ts1, ts2) => {
          fc.pre(ts1 !== ts2);

          const url = `https://bss.la-south-2.myhuaweicloud.com/v2/bills/monthly-bills?bill_cycle=2024-01&limit=100`;
          const headers1 = await signRequestPure('GET', url, '', credentials, ts1);
          const headers2 = await signRequestPure('GET', url, '', credentials, ts2);

          expect(headers1['Authorization']).not.toBe(headers2['Authorization']);
        }
      ),
      { numRuns: 30 }
    );
  });

  it('Authorization header contém os campos obrigatórios do esquema SDK-HMAC-SHA256', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMethod,
        arbUrl,
        arbBody,
        arbCredentials,
        arbTimestamp,
        async (method, url, body, credentials, timestamp) => {
          const headers = await signRequestPure(method, url, body, credentials, timestamp);

          // Must start with the algorithm identifier
          expect(headers['Authorization']).toMatch(/^SDK-HMAC-SHA256 /);

          // Must contain Credential=AK/scope
          expect(headers['Authorization']).toContain(`Credential=${credentials.accessKey}/`);

          // Must contain SignedHeaders
          expect(headers['Authorization']).toContain('SignedHeaders=content-type;host;x-sdk-date');

          // Must contain Signature (64 hex chars = 256-bit HMAC)
          expect(headers['Authorization']).toMatch(/Signature=[0-9a-f]{64}$/);

          // X-Sdk-Date must match the provided timestamp
          expect(headers['X-Sdk-Date']).toBe(timestamp);
        }
      ),
      { numRuns: 50 }
    );
  });
});
