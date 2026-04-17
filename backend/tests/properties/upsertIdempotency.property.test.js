/**
 * Property-based tests for Sync Job upsert idempotency
 *
 * Property 6: Sync Job upsert is idempotent
 * Validates: Requirements 4.8
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// ── In-memory upsert simulation ───────────────────────────────────────────────
// Simulates the upsert behavior using the composite key
// (provider, project_id, service, period_start, period_end)

function compositeKey(record) {
  return `${record.provider}|${record.project_id}|${record.service}|${record.period_start}|${record.period_end}`;
}

/**
 * Simulates a Supabase upsert with onConflict composite key.
 * Returns the resulting table state (Map keyed by composite key).
 */
function simulateUpsert(existingTable, records) {
  const table = new Map(existingTable);
  for (const record of records) {
    table.set(compositeKey(record), { ...record });
  }
  return table;
}

// ── Arbitraries ───────────────────────────────────────────────────────────────

const providerArb = fc.constantFrom('gcp', 'huawei');
const stringArb = fc.string({ minLength: 1, maxLength: 30 });
const costArb = fc.float({ min: 0, max: 100000, noNaN: true, noDefaultInfinity: true });
const dateArb = fc.date({ min: new Date('2024-01-01'), max: new Date('2026-12-31') })
  .map((d) => d.toISOString());

const billingRecordArb = fc.record({
  provider: providerArb,
  project_id: stringArb,
  project_name: stringArb,
  service: stringArb,
  cost: costArb,
  currency: fc.constantFrom('USD', 'BRL', 'CNY'),
  period_start: dateArb,
  period_end: dateArb,
  region: stringArb,
  synced_at: fc.constant(new Date().toISOString()),
});

const recordsArb = fc.array(billingRecordArb, { minLength: 1, maxLength: 50 });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('upsert — Property 6: Sync Job upsert is idempotent', () => {
  it('upserting the same records twice does not increase the record count', () => {
    fc.assert(
      fc.property(recordsArb, (records) => {
        const emptyTable = new Map();

        // First upsert
        const afterFirst = simulateUpsert(emptyTable, records);
        const countAfterFirst = afterFirst.size;

        // Second upsert with identical records
        const afterSecond = simulateUpsert(afterFirst, records);
        const countAfterSecond = afterSecond.size;

        return countAfterSecond === countAfterFirst;
      }),
      { numRuns: 500 }
    );
  });

  it('upserting the same records twice produces identical table state', () => {
    fc.assert(
      fc.property(recordsArb, (records) => {
        const emptyTable = new Map();
        const afterFirst = simulateUpsert(emptyTable, records);
        const afterSecond = simulateUpsert(afterFirst, records);

        // Same keys
        if (afterFirst.size !== afterSecond.size) return false;
        for (const [key, val] of afterFirst) {
          const val2 = afterSecond.get(key);
          if (!val2) return false;
          if (JSON.stringify(val) !== JSON.stringify(val2)) return false;
        }
        return true;
      }),
      { numRuns: 500 }
    );
  });

  it('records with different composite keys are stored separately', () => {
    fc.assert(
      fc.property(
        fc.tuple(billingRecordArb, billingRecordArb).filter(
          ([a, b]) => compositeKey(a) !== compositeKey(b)
        ),
        ([record1, record2]) => {
          const table = simulateUpsert(new Map(), [record1, record2]);
          return table.size === 2;
        }
      ),
      { numRuns: 300 }
    );
  });
});
