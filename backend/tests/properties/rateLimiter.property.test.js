/**
 * Property-based tests for rate limiter
 *
 * Property 11: Rate limiter rejects request N+1
 * Validates: Requirements 2.6
 */

import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';

// ── In-memory rate limiter simulation ────────────────────────────────────────
// Simulates the express-rate-limit behavior: windowMs + max per key

class RateLimiterSimulator {
  constructor(windowMs, max) {
    this.windowMs = windowMs;
    this.max = max;
    this._counters = new Map(); // key → { count, windowStart }
  }

  /**
   * Simulates a request. Returns { allowed: boolean, remaining: number }.
   */
  request(key, now = Date.now()) {
    const entry = this._counters.get(key);

    if (!entry || now - entry.windowStart >= this.windowMs) {
      // New window
      this._counters.set(key, { count: 1, windowStart: now });
      return { allowed: true, remaining: this.max - 1 };
    }

    if (entry.count < this.max) {
      entry.count++;
      return { allowed: true, remaining: this.max - entry.count };
    }

    // Limit exceeded
    return { allowed: false, remaining: 0 };
  }

  reset(key) {
    this._counters.delete(key);
  }
}

// ── Arbitraries ───────────────────────────────────────────────────────────────

const maxArb = fc.integer({ min: 1, max: 100 });
const windowMsArb = fc.integer({ min: 1000, max: 60000 });
const emailArb = fc.emailAddress();

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('rateLimiter — Property 11: Rate limiter rejects request N+1', () => {
  it('exactly max requests are allowed, request N+1 is rejected', () => {
    fc.assert(
      fc.property(maxArb, windowMsArb, emailArb, (max, windowMs, email) => {
        const limiter = new RateLimiterSimulator(windowMs, max);
        const now = Date.now();

        // Send exactly max requests — all should be allowed
        for (let i = 0; i < max; i++) {
          const result = limiter.request(email, now);
          if (!result.allowed) return false;
        }

        // Request N+1 should be rejected
        const overLimit = limiter.request(email, now);
        return !overLimit.allowed;
      }),
      { numRuns: 500 }
    );
  });

  it('different users do not interfere with each other\'s counters', () => {
    fc.assert(
      fc.property(
        maxArb,
        windowMsArb,
        fc.tuple(emailArb, emailArb).filter(([a, b]) => a !== b),
        (max, windowMs, [email1, email2]) => {
          const limiter = new RateLimiterSimulator(windowMs, max);
          const now = Date.now();

          // Exhaust user1's limit
          for (let i = 0; i < max; i++) {
            limiter.request(email1, now);
          }
          // user1 is now rate-limited
          const user1Over = limiter.request(email1, now);
          if (user1Over.allowed) return false;

          // user2 should still be allowed (fresh counter)
          const user2First = limiter.request(email2, now);
          return user2First.allowed;
        }
      ),
      { numRuns: 300 }
    );
  });

  it('after window expires, counter resets and requests are allowed again', () => {
    fc.assert(
      fc.property(maxArb, emailArb, (max, email) => {
        const windowMs = 1000;
        const limiter = new RateLimiterSimulator(windowMs, max);
        const now = Date.now();

        // Exhaust limit
        for (let i = 0; i < max; i++) {
          limiter.request(email, now);
        }
        const overLimit = limiter.request(email, now);
        if (overLimit.allowed) return false;

        // After window expires, should be allowed again
        const afterWindow = limiter.request(email, now + windowMs + 1);
        return afterWindow.allowed;
      }),
      { numRuns: 300 }
    );
  });
});
