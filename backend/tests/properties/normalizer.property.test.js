/**
 * Property-based tests for normalizers
 *
 * Property 5: Normalization produces valid ProviderData
 * Validates: Requirements 2.3, 4.2, 4.3
 */

import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { normalizeGCP } from '../../src/normalizers/gcpNormalizer.js';
import { normalizeHuawei } from '../../src/normalizers/huaweiNormalizer.js';

// ── Arbitraries ───────────────────────────────────────────────────────────────

const costArb = fc.float({ min: 0, max: 1_000_000, noNaN: true, noDefaultInfinity: true });
const stringArb = fc.string({ minLength: 1, maxLength: 50 });
const periodArb = fc.date({ min: new Date('2020-01-01'), max: new Date('2026-12-31') })
  .map((d) => d.toISOString());

// GCP row arbitrary
const gcpRowArb = fc.record({
  dimensions: fc.array(
    fc.oneof(
      fc.record({ key: fc.constant('project.id'), value: stringArb }),
      fc.record({ key: fc.constant('project.name'), value: stringArb }),
      fc.record({ key: fc.constant('service.description'), value: stringArb }),
      fc.record({ key: fc.constant('location.region'), value: stringArb })
    ),
    { minLength: 0, maxLength: 4 }
  ),
  metrics: fc.array(
    fc.record({
      values: fc.array(
        fc.record({ moneyValue: fc.record({ units: costArb.map(String) }) }),
        { minLength: 1, maxLength: 1 }
      ),
    }),
    { minLength: 1, maxLength: 1 }
  ),
});

const gcpResponseArb = fc.record({
  rows: fc.array(gcpRowArb, { minLength: 0, maxLength: 20 }),
});

// Huawei bill_sum arbitrary
const huaweiBillSumArb = fc.record({
  enterprise_project_id: fc.option(stringArb, { nil: undefined }),
  enterprise_project_name: fc.option(stringArb, { nil: undefined }),
  cloud_service_type_name: fc.option(stringArb, { nil: undefined }),
  cloud_service_type: fc.option(stringArb, { nil: undefined }),
  consume_amount: costArb.map(String),
  region: fc.option(stringArb, { nil: undefined }),
});

const huaweiResponseArb = fc.record({
  bill_sums: fc.array(huaweiBillSumArb, { minLength: 0, maxLength: 20 }),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function isValidProviderData(data, expectedProvider) {
  if (data.provider !== expectedProvider) return false;
  if (typeof data.summary?.currentCost !== 'number') return false;
  if (!Array.isArray(data.projects)) return false;

  // summary.currentCost === Σ projects[i].currentCost
  const sumOfProjects = data.projects.reduce((s, p) => s + p.currentCost, 0);
  if (Math.abs(data.summary.currentCost - sumOfProjects) > 0.001) return false;

  // All projects have required fields and currentCost >= 0
  for (const p of data.projects) {
    if (!p.id || !p.name || !p.provider) return false;
    if (typeof p.currentCost !== 'number' || p.currentCost < 0) return false;
  }

  return true;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('normalizers — Property 5: Normalization produces valid ProviderData', () => {
  it('normalizeGCP always produces valid ProviderData for arbitrary GCP responses', () => {
    fc.assert(
      fc.property(gcpResponseArb, periodArb, periodArb, (response, start, end) => {
        const result = normalizeGCP(response, start, end);
        return isValidProviderData(result, 'gcp');
      }),
      { numRuns: 500 }
    );
  });

  it('normalizeHuawei always produces valid ProviderData for arbitrary Huawei responses', () => {
    fc.assert(
      fc.property(huaweiResponseArb, periodArb, periodArb, (response, start, end) => {
        const result = normalizeHuawei(response, start, end);
        return isValidProviderData(result, 'huawei');
      }),
      { numRuns: 500 }
    );
  });

  it('normalizeGCP summary.currentCost equals sum of all project costs', () => {
    fc.assert(
      fc.property(gcpResponseArb, periodArb, periodArb, (response, start, end) => {
        const result = normalizeGCP(response, start, end);
        const sumOfProjects = result.projects.reduce((s, p) => s + p.currentCost, 0);
        return Math.abs(result.summary.currentCost - sumOfProjects) < 0.001;
      }),
      { numRuns: 500 }
    );
  });

  it('normalizeHuawei summary.currentCost equals sum of all project costs', () => {
    fc.assert(
      fc.property(huaweiResponseArb, periodArb, periodArb, (response, start, end) => {
        const result = normalizeHuawei(response, start, end);
        const sumOfProjects = result.projects.reduce((s, p) => s + p.currentCost, 0);
        return Math.abs(result.summary.currentCost - sumOfProjects) < 0.001;
      }),
      { numRuns: 500 }
    );
  });
});
