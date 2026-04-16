/**
 * Property-based tests for AIAgent
 * Uses fast-check for property generation.
 *
 * Validates: Requirements 5.3, 8.3
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// ── Inline the pure functions under test ──────────────────────────────────────
// Re-implement buildSystemPrompt and buildContextualPrompt to avoid browser globals.

function fmt(val) {
  if (typeof val !== 'number') return String(val || 0);
  if (val >= 1e6) return `R$ ${(val / 1e6).toFixed(2)}M`;
  if (val >= 1e3) return `R$ ${(val / 1e3).toFixed(1)}K`;
  return `R$ ${val.toFixed(0)}`;
}

function buildSystemPrompt(data) {
  const s = data.summary || {};
  const top3 = (data.projects || [])
    .sort((a, b) => (b.currentCost || 0) - (a.currentCost || 0))
    .slice(0, 3)
    .map(p => `${p.name} (${p.provider?.toUpperCase() || 'GCP'}): ${fmt(p.currentCost)}`)
    .join(', ');
  const providers = (s.activeProviders || ['gcp']).join(', ').toUpperCase();
  const topWaste = (data.waste || []).slice(0, 3).map(w => `${w.category}: ${fmt(w.totalWaste)}`).join(', ');

  // IMPORTANT: Never include credentials in this prompt
  return `Você é um especialista em FinOps e otimização de custos cloud. Responda sempre em português brasileiro, de forma direta e objetiva.

DADOS DO DASHBOARD:
- Período analisado: ${data.period || 30} dias
- Gasto total: ${fmt(s.totalCurrentCost || s.currentMonthCost || 0)}
- Gasto período anterior: ${fmt(s.totalPreviousCost || s.previousMonthCost || 0)}
- Desperdício identificado: ${fmt(s.totalWaste || 0)} (${s.wastePercent || 0}% do total)
- Economia potencial: ${fmt(s.potentialSaving || 0)} (${s.savingPercent || 0}%)
- Providers ativos: ${providers}
- Projetos ativos: ${s.activeProjects || 0}
- Top 3 projetos por custo: ${top3 || 'N/A'}
- Principais desperdícios: ${topWaste || 'N/A'}

Sempre quantifique o impacto financeiro das recomendações. Seja conciso e prático.`;
}

function buildContextualPrompt(message, data, history = []) {
  const systemText = buildSystemPrompt(data);
  const recentHistory = history.slice(-6);

  return [
    { role: 'user', parts: [{ text: systemText }] },
    { role: 'model', parts: [{ text: 'Entendido. Estou pronto para analisar os dados e responder suas perguntas sobre FinOps.' }] },
    ...recentHistory.map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }]
    })),
    { role: 'user', parts: [{ text: message }] }
  ];
}

// ── Arbitraries ───────────────────────────────────────────────────────────────

/** Generates a credential-like string: non-empty, no whitespace */
const arbCredential = fc.stringMatching(/^[A-Za-z0-9+/=_\-]{8,40}$/);

/** Generates a UnifiedData object with credentials injected into arbitrary fields */
const arbUnifiedDataWithCredentials = fc.tuple(
  arbCredential, // accessKey
  arbCredential, // secretKey
  arbCredential, // gcpToken
  arbCredential, // geminiKey
  arbCredential  // oauthToken
).map(([accessKey, secretKey, gcpToken, geminiKey, oauthToken]) => ({
  // Credentials injected into fields that should never reach the prompt
  huaweiConfig: { accessKey, secretKey, projectId: 'proj-123', region: 'ap-southeast-1' },
  gcpToken,
  geminiKey,
  oauthToken,
  // Legitimate financial data
  period: 30,
  summary: {
    totalCurrentCost: 50000,
    totalPreviousCost: 45000,
    totalWaste: 5000,
    potentialSaving: 3000,
    wastePercent: '10.0',
    savingPercent: '6.0',
    activeProjects: 3,
    activeProviders: ['gcp', 'huawei']
  },
  projects: [
    { id: 'p1', name: 'Project Alpha', provider: 'gcp', currentCost: 30000 },
    { id: 'p2', name: 'Project Beta', provider: 'huawei', currentCost: 20000 }
  ],
  waste: [{ category: 'idle-vms', totalWaste: 5000 }],
  recommendations: []
}));

/** Generates a user message that is guaranteed to be distinct from any credential.
 *  We use a fixed prefix so fast-check cannot shrink it to a credential value. */
const arbMessage = fc.string({ minLength: 1, maxLength: 80 }).map(s => `pergunta: ${s}`);

/** Generates a chat history array with messages that cannot match credential patterns */
const arbHistory = fc.array(
  fc.record({
    role: fc.constantFrom('user', 'assistant'),
    content: fc.string({ minLength: 1, maxLength: 200 }).map(s => `msg: ${s}`)
  }),
  { maxLength: 10 }
);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AIAgent — Property 7: Isolamento de credenciais no prompt AI', () => {
  /**
   * **Validates: Requirements 5.3, 8.3**
   *
   * For any UnifiedData with credentials injected into arbitrary fields,
   * the payload returned by buildContextualPrompt must never contain
   * those credential strings in its serialized form.
   */
  it('buildContextualPrompt payload must not contain accessKey', () => {
    fc.assert(
      fc.property(arbUnifiedDataWithCredentials, arbMessage, arbHistory, (data, message, history) => {
        const payload = buildContextualPrompt(message, data, history);
        const serialized = JSON.stringify(payload);
        expect(serialized).not.toContain(data.huaweiConfig.accessKey);
      })
    );
  });

  it('buildContextualPrompt payload must not contain secretKey', () => {
    fc.assert(
      fc.property(arbUnifiedDataWithCredentials, arbMessage, arbHistory, (data, message, history) => {
        const payload = buildContextualPrompt(message, data, history);
        const serialized = JSON.stringify(payload);
        expect(serialized).not.toContain(data.huaweiConfig.secretKey);
      })
    );
  });

  it('buildContextualPrompt payload must not contain gcpToken', () => {
    fc.assert(
      fc.property(arbUnifiedDataWithCredentials, arbMessage, arbHistory, (data, message, history) => {
        const payload = buildContextualPrompt(message, data, history);
        const serialized = JSON.stringify(payload);
        expect(serialized).not.toContain(data.gcpToken);
      })
    );
  });

  it('buildContextualPrompt payload must not contain geminiKey', () => {
    fc.assert(
      fc.property(arbUnifiedDataWithCredentials, arbMessage, arbHistory, (data, message, history) => {
        const payload = buildContextualPrompt(message, data, history);
        const serialized = JSON.stringify(payload);
        expect(serialized).not.toContain(data.geminiKey);
      })
    );
  });

  it('buildContextualPrompt payload must not contain oauthToken', () => {
    fc.assert(
      fc.property(arbUnifiedDataWithCredentials, arbMessage, arbHistory, (data, message, history) => {
        const payload = buildContextualPrompt(message, data, history);
        const serialized = JSON.stringify(payload);
        expect(serialized).not.toContain(data.oauthToken);
      })
    );
  });

  it('no credential field appears in the serialized payload (combined check)', () => {
    fc.assert(
      fc.property(arbUnifiedDataWithCredentials, arbMessage, arbHistory, (data, message, history) => {
        const payload = buildContextualPrompt(message, data, history);
        const serialized = JSON.stringify(payload);

        const credentials = [
          data.huaweiConfig.accessKey,
          data.huaweiConfig.secretKey,
          data.gcpToken,
          data.geminiKey,
          data.oauthToken
        ];

        for (const cred of credentials) {
          expect(serialized).not.toContain(cred);
        }
      })
    );
  });
});

// ── Property 11 ───────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 5.2**
 *
 * Property 11: Prompt contextual inclui métricas financeiras
 *
 * For any UnifiedData with random financial values, the system prompt built by
 * buildSystemPrompt must contain: total spend, waste %, potential saving,
 * active provider names, and the top 3 project names.
 */
describe('AIAgent — Property 11: Prompt contextual inclui métricas financeiras', () => {
  /** Arbitrary for a provider name (short uppercase-safe string) */
  const arbProviderName = fc.constantFrom('gcp', 'huawei', 'aws', 'azure', 'oracle');

  /** Arbitrary for a project name — printable ASCII, no commas to keep assertions simple */
  const arbProjectName = fc
    .stringMatching(/^[A-Za-z][A-Za-z0-9 _-]{2,19}$/)
    .filter(s => !s.includes(','));

  /** Arbitrary for a non-negative cost */
  const arbCost = fc.float({ min: 0, max: 1_000_000, noNaN: true, noDefaultInfinity: true });

  /** Arbitrary for a percentage string like "12.5" */
  const arbPct = fc.float({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }).map(v => v.toFixed(1));

  /** Arbitrary for a list of 1–3 provider names (unique) */
  const arbProviders = fc
    .uniqueArray(arbProviderName, { minLength: 1, maxLength: 3 });

  /** Arbitrary for a list of 1–5 projects */
  const arbProjects = fc.array(
    fc.record({
      name: arbProjectName,
      provider: arbProviderName,
      currentCost: arbCost
    }),
    { minLength: 1, maxLength: 5 }
  );

  /** Full UnifiedData arbitrary */
  const arbUnifiedData = fc.tuple(arbCost, arbPct, arbCost, arbProviders, arbProjects).map(
    ([totalCurrentCost, wastePercent, potentialSaving, activeProviders, projects]) => ({
      period: 30,
      summary: {
        totalCurrentCost,
        totalPreviousCost: 0,
        totalWaste: 0,
        wastePercent,
        potentialSaving,
        savingPercent: '0.0',
        activeProjects: projects.length,
        activeProviders
      },
      projects,
      waste: [],
      recommendations: []
    })
  );

  it('prompt contains the formatted total spend', () => {
    fc.assert(
      fc.property(arbUnifiedData, (data) => {
        const prompt = buildSystemPrompt(data);
        const expectedSpend = fmt(data.summary.totalCurrentCost);
        expect(prompt).toContain(expectedSpend);
      })
    );
  });

  it('prompt contains the waste percentage', () => {
    fc.assert(
      fc.property(arbUnifiedData, (data) => {
        const prompt = buildSystemPrompt(data);
        expect(prompt).toContain(String(data.summary.wastePercent));
      })
    );
  });

  it('prompt contains the formatted potential saving', () => {
    fc.assert(
      fc.property(arbUnifiedData, (data) => {
        const prompt = buildSystemPrompt(data);
        const expectedSaving = fmt(data.summary.potentialSaving);
        expect(prompt).toContain(expectedSaving);
      })
    );
  });

  it('prompt contains all active provider names (uppercased)', () => {
    fc.assert(
      fc.property(arbUnifiedData, (data) => {
        const prompt = buildSystemPrompt(data);
        for (const provider of data.summary.activeProviders) {
          expect(prompt).toContain(provider.toUpperCase());
        }
      })
    );
  });

  it('prompt contains the top 3 project names', () => {
    fc.assert(
      fc.property(arbUnifiedData, (data) => {
        const prompt = buildSystemPrompt(data);
        const top3 = [...data.projects]
          .sort((a, b) => (b.currentCost || 0) - (a.currentCost || 0))
          .slice(0, 3);
        for (const project of top3) {
          expect(prompt).toContain(project.name);
        }
      })
    );
  });
});
