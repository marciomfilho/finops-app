/**
 * FinOps Dashboard V2 — OKRs Page
 * Tracker de KPIs estratégicos FinOps com progresso editável e persistência local.
 */

const OKRsPage = (() => {

  const STORAGE_KEY = 'finops_okrs_progress';

  // ── KPI definitions ──────────────────────────────────────────────────────────
  const OKRS = [
    {
      id: 'unit-cost',
      index: 1,
      objective: 'FinOps e Eficiência de Cloud (Orçamento R$ 14MM)',
      title: 'Custo Unitário por Produto',
      description: 'Visibilidade do custo de infra vs. receita de produtos como EXA Seguros e AYA.',
      target: 'Dashboard 100% — visibilidade do custo de infra vs. receita de produtos',
      vision: 'Visão de negócio (usuários) — ferramenta / automação',
      color: 'blue',
      unit: '%',
      goal: 100
    },
    {
      id: 'tagging',
      index: 2,
      objective: 'FinOps e Eficiência de Cloud (Orçamento R$ 14MM)',
      title: 'Percentual de Ambientes com Tagging',
      description: 'Meta de 95% de cobertura para governança e alocação de custos.',
      target: '> 95% (target FinOps Foundation) — gestão e governança e alocação de custos',
      vision: 'Garantir tageamento de custos e recursos margem 5%',
      color: 'green',
      unit: '%',
      goal: 95
    },
    {
      id: 'waste-backlog',
      index: 3,
      objective: 'FinOps e Eficiência de Cloud (Orçamento R$ 14MM)',
      title: 'Backlog de Economia de FinOps',
      description: 'Valor financeiro (R$) de oportunidades de economia identificadas vs. implementadas mensalmente.',
      target: 'Listar oportunidades mapeadas até o momento, criar um dashboard com a visão X projeção',
      vision: 'KPIs — oportunidades mapeadas X realizadas > 90%',
      color: 'yellow',
      unit: '%',
      goal: 90
    },
    {
      id: 'db-cost',
      index: 4,
      objective: 'FinOps e Eficiência de Cloud (Orçamento R$ 14MM)',
      title: 'Redução de Custos de Banco de Dados',
      description: 'Medir a meta de redução de 10% nos custos de DB em comparação ao mês anterior.',
      target: 'Listar oportunidades mapeadas até o momento, criar um dashboard com a visão X projeção',
      vision: 'KPIs — oportunidades mapeadas X realizadas > 90%',
      color: 'red',
      unit: '%',
      goal: 10
    },
    {
      id: 'budget-adherence',
      index: 5,
      objective: 'FinOps e Eficiência de Cloud (Orçamento R$ 14MM)',
      title: 'Aderência ao Orçamento Mensal',
      description: 'Monitoramento do limite de R$ 14MM/ano para evitar estouros do EBITDA.',
      target: 'Real vs. Orçado — monitoramento do limite de R$ 14MM/ano',
      vision: 'Garantir orçamentária e eficiência financeira',
      color: 'yellow',
      unit: '%',
      goal: 100
    },
    {
      id: 'well-arch',
      index: 6,
      objective: 'FinOps e Eficiência de Cloud (Orçamento R$ 14MM)',
      title: 'Índice de Modernização Well-Architected',
      description: 'Percentual de redução de custo (meta 20%) via revisão de arquitetura.',
      target: 'Alinhar expectativa — Well Architected é muito mais abrangente. Boas práticas de consolidação de recursos.',
      vision: 'Necessário, definir estratégia junto a arquitetura e Sistemas',
      color: 'purple',
      unit: '%',
      goal: 20
    },
    {
      id: 'contracts',
      index: 7,
      objective: 'FinOps e Eficiência de Cloud (Orçamento R$ 14MM)',
      title: 'Gestão de Contratos Cloud',
      description: '100% dos fornecedores catalogados com indicadores de SLA e aniversário de renovação.',
      target: 'Garantir visibilidade de contratos e fornecedores, encontrar sinergia e melhores práticas',
      vision: 'Garantir reduções de custos e demonstrar evolução',
      color: 'blue',
      unit: '%',
      goal: 100
    },
    {
      id: 'waste-index',
      index: 8,
      objective: 'FinOps e Eficiência de Cloud (Orçamento R$ 14MM)',
      title: 'Cloud Waste Index',
      description: 'Monitoramento de recursos sem uso (Zombies) para eliminação de desperdício.',
      target: 'Recomendações Cloud8 + Cloud providers + Capacity',
      vision: 'KPIs — oportunidades mapeadas X realizadas > 90%',
      color: 'red',
      unit: '%',
      goal: 90
    }
  ];

  // ── Persistence ──────────────────────────────────────────────────────────────

  function _loadProgress() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch { return {}; }
  }

  function _saveProgress(progress) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch { /* ignore */ }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function _pct(current, goal) {
    if (!goal) return 0;
    return Math.min((current / goal) * 100, 100);
  }

  function _statusLabel(pct) {
    if (pct >= 100) return { label: '✅ Concluído',  cls: 'okr-status--done' };
    if (pct >= 75)  return { label: '🟢 No Prazo',   cls: 'okr-status--on-track' };
    if (pct >= 40)  return { label: '🟡 Em Progresso', cls: 'okr-status--progress' };
    if (pct > 0)    return { label: '🟠 Em Risco',   cls: 'okr-status--risk' };
    return           { label: '⚪ Não Iniciado',      cls: 'okr-status--none' };
  }

  function _barColor(pct) {
    if (pct >= 100) return '#00c48c';
    if (pct >= 75)  return '#00c48c';
    if (pct >= 40)  return '#ffb800';
    if (pct > 0)    return '#ff6b35';
    return '#2a3347';
  }

  function _colorVar(color) {
    const map = { blue: '#1a73e8', green: '#00c48c', red: '#ff4d6a', yellow: '#ffb800', purple: '#a855f7' };
    return map[color] || '#1a73e8';
  }

  // ── Summary bar ──────────────────────────────────────────────────────────────

  function _buildSummary(progress) {
    const totals = OKRS.reduce((acc, okr) => {
      const current = progress[okr.id] ?? 0;
      const pct = _pct(current, okr.goal);
      if (pct >= 100) acc.done++;
      else if (pct >= 40) acc.progress++;
      else if (pct > 0) acc.risk++;
      else acc.none++;
      acc.avgPct += pct;
      return acc;
    }, { done: 0, progress: 0, risk: 0, none: 0, avgPct: 0 });

    totals.avgPct = (totals.avgPct / OKRS.length).toFixed(0);

    return `
      <div class="okr-summary">
        <div class="okr-summary-title">
          <span>FinOps e Eficiência de Cloud — Orçamento R$ 14MM</span>
          <span class="okr-summary-avg">${totals.avgPct}% concluído</span>
        </div>
        <div class="okr-summary-bar">
          <div class="okr-summary-fill" style="width:${totals.avgPct}%"></div>
        </div>
        <div class="okr-summary-stats">
          <span class="okr-stat okr-stat--done">✅ ${totals.done} concluído${totals.done !== 1 ? 's' : ''}</span>
          <span class="okr-stat okr-stat--progress">🟡 ${totals.progress} em progresso</span>
          <span class="okr-stat okr-stat--risk">🟠 ${totals.risk} em risco</span>
          <span class="okr-stat okr-stat--none">⚪ ${totals.none} não iniciado${totals.none !== 1 ? 's' : ''}</span>
        </div>
      </div>
    `;
  }

  // ── OKR card ─────────────────────────────────────────────────────────────────

  function _buildCard(okr, progress) {
    const current = progress[okr.id] ?? 0;
    const pct = _pct(current, okr.goal);
    const status = _statusLabel(pct);
    const barColor = _barColor(pct);
    const accentColor = _colorVar(okr.color);

    return `
      <div class="okr-card" data-id="${okr.id}" style="animation-delay:${(okr.index - 1) * 0.06}s">
        <div class="okr-card-accent" style="background:${accentColor}"></div>
        <div class="okr-card-body">
          <div class="okr-card-header">
            <span class="okr-index">#${okr.index}</span>
            <span class="okr-status ${status.cls}">${status.label}</span>
          </div>
          <div class="okr-title">${okr.title}</div>
          <div class="okr-desc">${okr.description}</div>

          <div class="okr-target">
            <span class="okr-target-label">Meta:</span>
            <span class="okr-target-text">${okr.target}</span>
          </div>
          <div class="okr-vision">
            <span class="okr-target-label">Visão:</span>
            <span class="okr-target-text">${okr.vision}</span>
          </div>

          <div class="okr-progress-row">
            <div class="okr-bar-wrap">
              <div class="okr-bar">
                <div class="okr-bar-fill" style="width:${pct.toFixed(1)}%;background:${barColor}"></div>
              </div>
              <span class="okr-pct">${pct.toFixed(0)}%</span>
            </div>
            <div class="okr-input-row">
              <label class="okr-input-label">Atual</label>
              <input
                type="number"
                class="okr-input"
                data-id="${okr.id}"
                data-goal="${okr.goal}"
                value="${current}"
                min="0"
                max="${okr.goal * 2}"
                step="1"
                placeholder="0"
              />
              <span class="okr-unit">/ ${okr.goal}${okr.unit}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  function render() {
    const container = document.getElementById('page-okrs');
    if (!container) return;

    const progress = _loadProgress();

    container.innerHTML = `
      <div class="okr-page">
        <div id="okr-summary-wrap">${_buildSummary(progress)}</div>
        <div class="okr-grid" id="okr-grid">
          ${OKRS.map(okr => _buildCard(okr, progress)).join('')}
        </div>
      </div>
    `;

    _bindEvents();
  }

  // ── Events ───────────────────────────────────────────────────────────────────

  function _bindEvents() {
    document.querySelectorAll('.okr-input').forEach(input => {
      input.addEventListener('change', _handleInput);
      input.addEventListener('input', _handleInput);
    });
  }

  function _handleInput(e) {
    const id = e.target.dataset.id;
    const goal = parseFloat(e.target.dataset.goal);
    const current = parseFloat(e.target.value) || 0;

    const progress = _loadProgress();
    progress[id] = current;
    _saveProgress(progress);

    // Update just this card's bar + status without full re-render
    const card = document.querySelector(`.okr-card[data-id="${id}"]`);
    if (!card) return;

    const pct = _pct(current, goal);
    const status = _statusLabel(pct);
    const barColor = _barColor(pct);

    const barFill = card.querySelector('.okr-bar-fill');
    if (barFill) { barFill.style.width = `${pct.toFixed(1)}%`; barFill.style.background = barColor; }

    const pctEl = card.querySelector('.okr-pct');
    if (pctEl) pctEl.textContent = `${pct.toFixed(0)}%`;

    const statusEl = card.querySelector('.okr-status');
    if (statusEl) { statusEl.textContent = status.label; statusEl.className = `okr-status ${status.cls}`; }

    // Refresh summary
    const summaryWrap = document.getElementById('okr-summary-wrap');
    if (summaryWrap) summaryWrap.innerHTML = _buildSummary(progress);
  }

  // ── Public API ───────────────────────────────────────────────────────────────
  return { render };
})();
