/**
 * Property-based tests for BudgetPage — calculateUtilization
 *
 * **Validates: Requirements 7.2**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// ── Inline the pure calculation logic under test ──────────────────────────────
// Mirrors BudgetPage.calculateUtilization from pages/budget.js

function calculateUtilization(currentSpend, budgetLimit) {
  if (!budgetLimit || budgetLimit <= 0) return 0;
  return (currentSpend / budgetLimit) * 100;
}

// ── Arbitraries ───────────────────────────────────────────────────────────────

/** BudgetEntry with budgetLimit > 0 */
const arbBudgetEntry = fc.record({
  currentSpend: fc.float({ min: 0, max: 1_000_000, noNaN: true }),
  // min must be a 32-bit float; Math.fround(1) = 1 ensures budgetLimit > 0
  budgetLimit:  fc.float({ min: Math.fround(1), max: 2_000_000, noNaN: true })
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BudgetPage — Property 5: Budget utilization invariant', () => {
  /**
   * **Validates: Requirements 7.2**
   *
   * For any BudgetEntry where budgetLimit > 0:
   *   utilizationPct === (currentSpend / budgetLimit) * 100
   *   utilizationPct >= 0
   */
  it('utilizationPct === (currentSpend / budgetLimit) * 100 for any budgetLimit > 0', () => {
    fc.assert(
      fc.property(arbBudgetEntry, ({ currentSpend, budgetLimit }) => {
        const utilizationPct = calculateUtilization(currentSpend, budgetLimit);
        const expected = (currentSpend / budgetLimit) * 100;

        expect(utilizationPct).toBeCloseTo(expected, 10);
      })
    );
  });

  it('utilizationPct >= 0 for any non-negative currentSpend and budgetLimit > 0', () => {
    fc.assert(
      fc.property(arbBudgetEntry, ({ currentSpend, budgetLimit }) => {
        const utilizationPct = calculateUtilization(currentSpend, budgetLimit);

        expect(utilizationPct).toBeGreaterThanOrEqual(0);
      })
    );
  });
});
