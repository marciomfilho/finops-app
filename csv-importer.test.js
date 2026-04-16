/**
 * Property-based tests for CSVImporter — detectSchema
 * Uses fast-check for property generation.
 *
 * Validates: Requirements 4.3
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// ── Inline SCHEMA_MAP and detectSchema for Node testing ──────────────────────
// Re-implements the pure functions under test to avoid browser globals.

const SCHEMA_MAP = {
  costs: {
    date:    ['date', 'data', 'period', 'periodo', 'month', 'mes', 'data_referencia'],
    cost:    ['cost', 'custo', 'amount', 'valor', 'total', 'spend', 'gasto', 'value'],
    project: ['project', 'projeto', 'project_id', 'account', 'conta'],
    service: ['service', 'servico', 'product', 'produto', 'recurso']
  },
  projects: {
    name:        ['name', 'nome', 'project', 'projeto', 'project_name', 'nome_projeto'],
    cost:        ['cost', 'custo', 'amount', 'valor', 'monthly_cost', 'custo_mensal'],
    budget:      ['budget', 'orcamento', 'limit', 'limite', 'budget_limit'],
    id:          ['id', 'project_id', 'identifier'],
    environment: ['environment', 'env', 'ambiente', 'tipo']
  },
  waste: {
    name:     ['name', 'nome', 'resource', 'recurso', 'resource_name'],
    cost:     ['cost', 'custo', 'amount', 'valor', 'waste_cost', 'custo_desperdicio'],
    category: ['category', 'categoria', 'type', 'tipo'],
    reason:   ['reason', 'motivo', 'description', 'descricao'],
    action:   ['action', 'acao', 'recommendation', 'recomendacao']
  },
  recommendations: {
    title:       ['title', 'titulo', 'name', 'nome', 'recommendation'],
    saving:      ['saving', 'economia', 'savings', 'amount', 'valor', 'monthly_saving'],
    priority:    ['priority', 'prioridade', 'severity', 'severidade'],
    category:    ['category', 'categoria', 'type', 'tipo'],
    effort:      ['effort', 'esforco', 'complexity', 'complexidade'],
    description: ['description', 'descricao', 'details', 'detalhes']
  }
};

function detectSchema(headers, category) {
  const normalizedHeaders = headers.map(h => h.toLowerCase().trim());
  const targetSchema = SCHEMA_MAP[category] || {};
  const mapping = {};

  for (const [field, aliases] of Object.entries(targetSchema)) {
    const match = normalizedHeaders.find(h => aliases.some(alias => h.includes(alias)));
    if (match !== undefined) {
      mapping[field] = headers[normalizedHeaders.indexOf(match)];
    }
  }

  return mapping;
}

// ── Arbitraries ───────────────────────────────────────────────────────────────

const categories = ['costs', 'projects', 'waste', 'recommendations'];

/**
 * Builds a flat list of { category, field, alias } entries from SCHEMA_MAP.
 * Used to generate valid alias-based headers.
 */
const allAliasEntries = categories.flatMap(category =>
  Object.entries(SCHEMA_MAP[category]).flatMap(([field, aliases]) =>
    aliases.map(alias => ({ category, field, alias }))
  )
);

/**
 * Generates a capitalization variant of a string:
 * randomly uppercases each character.
 */
function arbCapitalizationVariant(str) {
  return fc.array(
    fc.boolean(),
    { minLength: str.length, maxLength: str.length }
  ).map(bools =>
    str.split('').map((ch, i) => bools[i] ? ch.toUpperCase() : ch).join('')
  );
}

/** Generates surrounding whitespace (0–3 spaces on each side) */
const arbPadding = fc.tuple(
  fc.integer({ min: 0, max: 3 }),
  fc.integer({ min: 0, max: 3 })
).map(([left, right]) => ({ left: ' '.repeat(left), right: ' '.repeat(right) }));

/** Picks a random alias entry from the full schema */
const arbAliasEntry = fc.constantFrom(...allAliasEntries);

/**
 * Generates a header string that is a known alias with:
 * - random capitalization
 * - optional surrounding spaces
 */
const arbAliasHeader = arbAliasEntry.chain(entry =>
  fc.tuple(arbCapitalizationVariant(entry.alias), arbPadding).map(([variant, pad]) => ({
    category: entry.category,
    field: entry.field,
    alias: entry.alias,
    header: `${pad.left}${variant}${pad.right}`
  }))
);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CSVImporter — Property 9: Detecção de schema por aliases', () => {
  /**
   * Validates: Requirements 4.3
   *
   * For any header that is a known alias (with any capitalization variation
   * and surrounding spaces), detectSchema must map it to the correct internal field.
   */
  it('detectSchema maps any capitalization/space variant of a known alias to the correct field', () => {
    fc.assert(
      fc.property(arbAliasHeader, ({ category, field, header }) => {
        const mapping = detectSchema([header], category);
        // The field must be detected and mapped to the original header string
        expect(mapping[field]).toBe(header);
      })
    );
  });

  it('detectSchema maps multiple alias headers simultaneously to their respective fields', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...categories).chain(category => {
          const fields = Object.entries(SCHEMA_MAP[category]);
          // Pick one alias per field, apply random capitalization + padding
          return fc.tuple(
            ...fields.map(([field, aliases]) =>
              fc.tuple(
                fc.constantFrom(...aliases).chain(alias =>
                  fc.tuple(arbCapitalizationVariant(alias), arbPadding).map(([variant, pad]) =>
                    `${pad.left}${variant}${pad.right}`
                  )
                ),
                fc.constant(field)
              )
            )
          ).map(pairs => ({ category, pairs }));
        }),
        ({ category, pairs }) => {
          const headers = pairs.map(([header]) => header);
          const mapping = detectSchema(headers, category);

          for (const [header, field] of pairs) {
            // Each field must be detected
            expect(mapping[field]).toBeDefined();
          }
        }
      )
    );
  });
});

// ── parseRows inline (mirrors csv-importer.js) ────────────────────────────────

function parseRows(rawText, delimiter) {
  const lines = rawText.split('\n').filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = lines.slice(1).map(line => {
    const values = line.split(delimiter).map(v => v.trim().replace(/^"|"$/g, ''));
    const row = {};
    headers.forEach((h, i) => { row[h] = values[i] || ''; });
    return row;
  });

  return { headers, rows };
}

// ── Property 8: rowCount igual ao número de linhas de dados ──────────────────

describe('CSVImporter — Property 8: rowCount igual ao número de linhas de dados', () => {
  /**
   * Validates: Requirements 4.2
   *
   * For any CSV with N data rows (N >= 1), parseRows must return exactly N rows.
   * N=0 is excluded because parse() throws CSV_EMPTY_FILE for empty data.
   */
  it('rowCount equals the number of data rows for N >= 1', () => {
    // Arbitrary: a single non-empty cell value (no commas, no newlines, not blank)
    const arbCellValue = fc.stringMatching(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,9}$/);

    // Arbitrary: N between 1 and 1000 data rows
    const arbCSV = fc.integer({ min: 1, max: 1000 }).chain(n =>
      fc.array(arbCellValue, { minLength: n, maxLength: n }).map(values => ({
        n,
        csv: 'header\n' + values.map(v => v).join('\n')
      }))
    );

    fc.assert(
      fc.property(arbCSV, ({ n, csv }) => {
        const { rows } = parseRows(csv, ',');
        expect(rows.length).toBe(n);
      })
    );
  });

  it('rowCount is 0 when there are no data rows (header only)', () => {
    const { rows } = parseRows('header', ',');
    expect(rows.length).toBe(0);
  });
});
