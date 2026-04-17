/**
 * FinOps Dashboard V2 — AIAgent
 * Lógica do agente FinOps: construção de prompts, análise automática e chat.
 * Exposto como IIFE: const AIAgent = (() => { ... })()
 */

const AIAgent = (() => {
  // ── State ───────────────────────────────────────────────────────────────────
  let aiDisabled = false;

  // ── Formatação ──────────────────────────────────────────────────────────────

  /**
   * Formata um valor numérico como moeda BRL.
   * @param {*} val
   * @returns {string}
   */
  function fmt(val) {
    if (typeof val !== 'number') return String(val || 0);
    if (val >= 1e6) return `R$ ${(val / 1e6).toFixed(2)}M`;
    if (val >= 1e3) return `R$ ${(val / 1e3).toFixed(1)}K`;
    return `R$ ${val.toFixed(0)}`;
  }

  // ── Prompt builders ─────────────────────────────────────────────────────────

  /**
   * Constrói o prompt de sistema com os dados do dashboard.
   * IMPORTANTE: Nunca inclui credenciais (AK/SK, tokens, API keys).
   * @param {Object} data - UnifiedData do DataBus
   * @returns {string}
   */
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

  /**
   * Constrói o array de contents para o Gemini com contexto e histórico.
   * Inclui as últimas 6 mensagens do histórico para não exceder a context window.
   * @param {string} message - Mensagem atual do usuário
   * @param {Object} data - UnifiedData do DataBus
   * @param {Array} history - Histórico de mensagens [{role, content}]
   * @returns {Array} Array de contents para a Gemini API
   */
  function buildContextualPrompt(message, data, history = []) {
    const systemText = buildSystemPrompt(data);
    const recentHistory = history.slice(-6);

    const contents = [
      { role: 'user', parts: [{ text: systemText }] },
      { role: 'model', parts: [{ text: 'Entendido. Estou pronto para analisar os dados e responder suas perguntas sobre FinOps.' }] },
      ...recentHistory.map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }]
      })),
      { role: 'user', parts: [{ text: message }] }
    ];

    return contents;
  }

  // ── Parse de insights ───────────────────────────────────────────────────────

  /**
   * Converte texto de resposta do Gemini em array de AIInsight.
   * @param {string} text
   * @returns {Array}
   */
  function _parseInsights(text) {
    if (!text) return [];
    const lines = text.split('\n').filter(l =>
      l.trim() && (
        l.includes('•') ||
        l.includes('-') ||
        l.match(/^[🔴🟠🟡🟢💰⚠️📊🚀]/u)
      )
    );
    return lines.slice(0, 5).map((line, i) => ({
      id: i + 1,
      type: 'insight',
      text: line.trim(),
      severity: i === 0 ? 'high' : i < 3 ? 'medium' : 'low'
    }));
  }

  // ── autoAnalyze ─────────────────────────────────────────────────────────────

  /**
   * Análise automática ao carregar dados. Retorna array de AIInsight.
   * Retorna [] se a API key não estiver configurada ou se estiver throttled.
   * @param {Object} data - UnifiedData do DataBus
   * @returns {Promise<Array>}
   */
  async function autoAnalyze(data) {
    if (!GeminiClient.hasApiKey()) { aiDisabled = true; return []; }
    if (GeminiClient.isThrottled()) return [];

    try {
      const prompt = buildSystemPrompt(data) + '\n\nGere uma análise executiva em 3-5 bullet points dos principais pontos de atenção e oportunidades de economia. Formato: cada bullet começa com emoji relevante.';
      const text = await GeminiClient.generate(prompt);
      return _parseInsights(text);
    } catch (err) {
      if (err.message === 'GEMINI_NO_KEY') aiDisabled = true;
      console.warn('[AIAgent] autoAnalyze error:', err.message);
      return [];
    }
  }

  // ── chat ────────────────────────────────────────────────────────────────────

  /**
   * Chat interativo com o agente FinOps.
   * Se o BackendProvider tiver JWT, envia a mensagem ao endpoint RAG do backend.
   * Caso contrário, faz fallback para a Gemini API direta.
   * Suporta streaming via onChunk callback (apenas no fallback direto).
   * @param {string} message - Mensagem do usuário
   * @param {Array} history - Histórico de mensagens
   * @param {Function|null} onChunk - Callback para streaming (opcional)
   * @returns {Promise<string|void>}
   */
  async function chat(message, history, onChunk) {
    // ── Backend RAG path ──────────────────────────────────────────────────────
    const backendAvailable =
      typeof BackendProvider !== 'undefined' &&
      BackendProvider.hasJWT() &&
      typeof window !== 'undefined' &&
      window.BACKEND_URL;

    if (backendAvailable) {
      const jwt = BackendProvider.getJWT ? BackendProvider.getJWT() : null;
      const url = `${window.BACKEND_URL}/api/chat`;

      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${jwt || ''}`
          },
          body: JSON.stringify({ message, history: history.slice(-6) })
        });
      } catch (_networkErr) {
        // Network failure — fall through to direct Gemini path
        res = null;
      }

      if (res !== null) {
        if (res.status === 401) {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('auth:expired'));
          }
          throw new Error('AUTH_EXPIRED');
        }

        if (res.ok) {
          const json = await res.json();
          const text = json.text || '';
          if (onChunk) onChunk(text);
          return text;
        }

        // Non-401 error from backend — fall through to direct Gemini path
      }
    }

    // ── Direct Gemini fallback ────────────────────────────────────────────────
    if (aiDisabled || !GeminiClient.hasApiKey()) throw new Error('GEMINI_NO_KEY');
    if (GeminiClient.isThrottled()) throw new Error('GEMINI_QUOTA_EXCEEDED');

    const data = (typeof DataBus !== 'undefined' && DataBus.getData()) || {};
    const contents = buildContextualPrompt(message, data, history);

    if (onChunk) {
      return GeminiClient.generateStream(contents, onChunk);
    }
    return GeminiClient.generate(contents);
  }

  // ── isDisabled ──────────────────────────────────────────────────────────────

  /**
   * Retorna true se o agente estiver desabilitado (sem API key ou erro anterior).
   * @returns {boolean}
   */
  function isDisabled() {
    return aiDisabled || !GeminiClient.hasApiKey();
  }

  // ── Public API ──────────────────────────────────────────────────────────────
  return {
    buildSystemPrompt,
    buildContextualPrompt,
    autoAnalyze,
    chat,
    isDisabled
  };
})();
