/**
 * FinOps Dashboard V2 — Recommendations Page
 * Exibe recomendações de todos os providers + insights do AI_Agent com badge "IA".
 * Requirements: 3.1, 5.1
 */

const RecommendationsPage = (() => {

  // ── State ─────────────────────────────────────────────────────────────────────
  let _currentFilter = 'all';
  let _aiInsights = [];

  // ── Helpers ───────────────────────────────────────────────────────────────────

  function fmt(val) {
    if (typeof val !== 'number') return val;
    if (val >= 1e6) return `R$ ${(val / 1e6).toFixed(2)}M`;
    if (val >= 1e3) return `R$ ${(val / 1e3).toFixed(1)}K`;
    return `R$ ${val.toFixed(0)}`;
  }

  function _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── AI Insights loading ───────────────────────────────────────────────────────

  /**
   * Loads AI insights via AIAgent.autoAnalyze() and re-renders.
   * Called once when the page first renders with data.
   * @param {Object} unified - UnifiedData from DataBus
   */
  async function _loadAIInsights(unified) {
    if (typeof AIAgent === 'undefined' || AIAgent.isDisabled()) return;
    try {
      const insights = await AIAgent.autoAnalyze(unified);
      if (insights && insights.length > 0) {
        _aiInsights = insights;
        _renderList(_currentFilter);
      }
    } catch (err) {
      console.warn('[RecommendationsPage] AI insights error:', err.message);
    }
  }

  // ── Converters ────────────────────────────────────────────────────────────────

  /**
   * Converts an AIInsight into a display-compatible recommendation object.
   * @param {Object} insight - AIInsight
   * @param {number} index
   * @returns {Object}
   */
  function _insightToRec(insight, index) {
    const severityToPriority = { critical: 'critical', high: 'high', medium: 'medium', low: 'low' };
    return {
      id: `ai-${index}`,
      title: insight.title || insight.text || 'Insight de IA',
      description: insight.description || insight.text || '',
      priority: severityToPriority[insight.severity] || 'medium',
      category: 'ai',
      saving: typeof insight.estimatedImpact === 'number' ? insight.estimatedImpact : 0,
      effort: '—',
      impact: insight.severity === 'critical' || insight.severity === 'high' ? 'Alto' : 'Médio',
      timeToImplement: '—',
      isAI: true
    };
  }

  // ── Render helpers ────────────────────────────────────────────────────────────

  const CAT_CLASS = {
    compute: 'cat-compute',
    storage: 'cat-storage',
    network: 'cat-network',
    database: 'cat-database',
    ai: 'cat-ai',
    other: 'cat-other'
  };

  const CAT_LABEL = {
    compute: 'Compute',
    storage: 'Storage',
    network: 'Network',
    database: 'Database',
    ai: 'IA',
    other: 'Outros'
  };

  /**
   * Builds the HTML for a single recommendation card.
   * @param {Object} r - Recommendation (regular or AI-converted)
   * @param {number} index - animation delay index
   * @returns {string} HTML string
   */
  function _buildRecCard(r, index) {
    const catClass = CAT_CLASS[r.category] || 'cat-other';
    const catLabel = CAT_LABEL[r.category] || _esc(r.category || 'Outros');

    const aiBadge = r.isAI
      ? `<span class="badge-ai">✨ IA</span>`
      : '';

    const savingHtml = r.saving > 0 ? `
      <div class="rec-meta-item">
        <span class="rec-meta-label">Economia Mensal</span>
        <span class="rec-meta-value green">${fmt(r.saving)}</span>
      </div>
      <div class="rec-meta-item">
        <span class="rec-meta-label">Economia Anual</span>
        <span class="rec-meta-value green">${fmt(r.saving * 12)}</span>
      </div>
    ` : '';

    return `
      <div class="rec-card${r.isAI ? ' rec-card-ai' : ''}" style="animation-delay:${index * 0.06}s">
        <div class="rec-priority ${_esc(r.priority || 'low')}"></div>
        <div class="rec-content">
          <div class="rec-title">${_esc(r.title || '')} ${aiBadge}</div>
          <div class="rec-desc">${_esc(r.description || '')}</div>
          <div class="rec-meta">
            ${savingHtml}
            ${r.effort && r.effort !== '—' ? `
            <div class="rec-meta-item">
              <span class="rec-meta-label">Esforço</span>
              <span class="rec-meta-value">${_esc(r.effort)}</span>
            </div>` : ''}
            <div class="rec-meta-item">
              <span class="rec-meta-label">Impacto</span>
              <span class="rec-meta-value ${r.impact === 'Alto' ? 'green' : ''}">${_esc(r.impact || '—')}</span>
            </div>
            ${r.timeToImplement && r.timeToImplement !== '—' ? `
            <div class="rec-meta-item">
              <span class="rec-meta-label">Implementação</span>
              <span class="rec-meta-value">${_esc(r.timeToImplement)}</span>
            </div>` : ''}
          </div>
        </div>
        <div class="rec-actions">
          <span class="rec-category ${catClass}">${catLabel}</span>
          ${!r.isAI ? `<button class="btn-apply" onclick="RecommendationsPage.applyRec('${_esc(String(r.id))}')">Aplicar</button>` : ''}
        </div>
      </div>
    `;
  }

  // ── Filter & render ───────────────────────────────────────────────────────────

  /**
   * Renders the filter buttons.
   * @param {string} activeFilter
   */
  function _renderFilters(activeFilter) {
    const filters = [
      { id: 'all', label: 'Todas' },
      { id: 'critical', label: '🔴 Crítico' },
      { id: 'high', label: '🟠 Alto' },
      { id: 'medium', label: '🟡 Médio' },
      { id: 'low', label: '🟢 Baixo' },
      { id: 'compute', label: 'Compute' },
      { id: 'storage', label: 'Storage' },
      { id: 'network', label: 'Network' },
      { id: 'database', label: 'Database' },
      { id: 'ai', label: '✨ IA' }
    ];

    const filtersEl = document.getElementById('rec-filters');
    if (!filtersEl) return;

    filtersEl.innerHTML = filters.map(f => `
      <button class="rec-filter-btn ${activeFilter === f.id ? 'active' : ''}"
              onclick="RecommendationsPage.filter('${f.id}')">${f.label}</button>
    `).join('');
  }

  /**
   * Renders the recommendation list for the given filter.
   * Merges regular recommendations with AI insights.
   * @param {string} filter
   */
  function _renderList(filter) {
    const unified = DataBus.getData();
    if (!unified) return;

    // Regular recommendations from all providers
    const regularRecs = (unified.recommendations || []);

    // AI insights converted to rec format
    const aiRecs = _aiInsights.map((ins, i) => _insightToRec(ins, i));

    // Merge: regular first, then AI
    let allRecs = [...regularRecs, ...aiRecs];

    // Apply filter
    if (filter !== 'all') {
      allRecs = allRecs.filter(r => r.priority === filter || r.category === filter);
    }

    const listEl = document.getElementById('rec-list');
    if (!listEl) return;

    if (allRecs.length === 0) {
      listEl.innerHTML = `<div style="text-align:center;color:var(--text3);padding:40px">Nenhuma recomendação encontrada.</div>`;
    } else {
      listEl.innerHTML = allRecs.map((r, i) => _buildRecCard(r, i)).join('');
    }
  }

  // ── Main render ───────────────────────────────────────────────────────────────

  /**
   * Renders the recommendations page using UnifiedData from DataBus.
   * Also triggers AI analysis to merge AIInsight[] with badge "IA".
   */
  function render() {
    const unified = DataBus.getData();
    if (!unified) return;

    _renderFilters(_currentFilter);
    _renderList(_currentFilter);

    // Load AI insights asynchronously (re-renders list when ready)
    _loadAIInsights(unified);
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  /**
   * Applies a filter and re-renders the list.
   * @param {string} f - filter id
   */
  function filter(f) {
    _currentFilter = f;
    _renderFilters(f);
    _renderList(f);
  }

  /**
   * Marks a regular recommendation as applied.
   * @param {string} id
   */
  function applyRec(id) {
    const unified = DataBus.getData();
    const recs = unified ? (unified.recommendations || []) : [];
    const rec = recs.find(r => String(r.id) === String(id));
    if (rec && typeof App !== 'undefined' && App.showToast) {
      App.showToast(`Recomendação "${rec.title}" marcada para implementação`, 'success');
    }
  }

  return { render, filter, applyRec };
})();
