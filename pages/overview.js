/**
 * FinOps Dashboard V2 — Overview Page
 * Renders the main KPI grid and charts using UnifiedData from DataBus.
 * Requirements: 3.1, 10.3
 */

const OverviewPage = (() => {

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function fmt(val) {
    if (typeof val !== 'number') return val;
    if (val >= 1e6) return `R$ ${(val / 1e6).toFixed(2)}M`;
    if (val >= 1e3) return `R$ ${(val / 1e3).toFixed(1)}K`;
    return `R$ ${val.toFixed(0)}`;
  }

  /**
   * Returns true when demo data is active.
   * Demo mode is detected when:
   *  - unified.isDemo === true, OR
   *  - activeProviders includes 'demo', OR
   *  - providers list contains an entry with id 'demo'
   * @param {Object} unified - UnifiedData from DataBus
   * @returns {boolean}
   */
  function isDemoActive(unified) {
    if (!unified) return false;
    if (unified.isDemo === true) return true;
    const summary = unified.summary || {};
    const activeProviders = summary.activeProviders || [];
    if (activeProviders.includes('demo')) return true;
    const providers = unified.providers || [];
    return providers.some(p => (p.id || p.provider) === 'demo');
  }

  /**
   * Renders the "Modo Demo" banner above the KPI grid.
   * Inserts or removes the banner element as needed.
   * @param {boolean} show
   */
  function renderDemoBanner(show) {
    const pageEl = document.getElementById('page-overview');
    if (!pageEl) return;

    let banner = document.getElementById('demo-mode-banner');

    if (show) {
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'demo-mode-banner';
        banner.className = 'demo-mode-banner';
        banner.innerHTML = `
          <span class="demo-mode-icon">🎭</span>
          <span class="demo-mode-text">Modo Demo ativo — os dados exibidos são simulados e não representam custos reais</span>
        `;
        // Insert before the kpi-grid
        const kpiGrid = document.getElementById('kpi-grid');
        if (kpiGrid) {
          pageEl.insertBefore(banner, kpiGrid);
        } else {
          pageEl.prepend(banner);
        }
      }
      // Also update the topbar demo badge if present
      const topbarBadge = document.getElementById('demo-badge');
      if (topbarBadge) topbarBadge.classList.remove('hidden');
    } else {
      if (banner) banner.remove();
      const topbarBadge = document.getElementById('demo-badge');
      if (topbarBadge) topbarBadge.classList.add('hidden');
    }
  }

  /**
   * Builds the HTML for the "Providers Ativos" KPI card.
   * Shows count and a breakdown row per provider.
   * @param {Object} summary - UnifiedSummary from UnifiedData
   * @param {number} animDelay - CSS animation delay in seconds
   * @returns {string} HTML string
   */
  function buildProvidersKpiCard(summary, animDelay) {
    const byProvider = summary.byProvider || {};
    const activeProviders = summary.activeProviders || Object.keys(byProvider);
    const count = activeProviders.length;

    const providerLabels = { gcp: 'GCP', huawei: 'Huawei', csv: 'CSV', demo: 'Demo' };
    const providerColors = { gcp: '#1a73e8', huawei: '#e8341a', csv: '#00c48c', demo: '#a855f7' };

    const breakdownRows = activeProviders.map(pid => {
      const info = byProvider[pid] || {};
      const label = providerLabels[pid] || pid.toUpperCase();
      const color = providerColors[pid] || '#8892a4';
      const cost = info.currentCost != null ? fmt(info.currentCost) : '—';
      const utilPct = info.utilizationPct != null ? `${info.utilizationPct.toFixed(0)}%` : '';
      return `
        <div class="provider-breakdown-row">
          <span class="provider-dot" style="background:${color}"></span>
          <span class="provider-breakdown-name">${label}</span>
          <span class="provider-breakdown-cost">${cost}</span>
          ${utilPct ? `<span class="provider-breakdown-util">${utilPct}</span>` : ''}
        </div>
      `;
    }).join('');

    return `
      <div class="kpi-card purple" style="animation-delay:${animDelay}s">
        <div class="kpi-label">Providers Ativos</div>
        <div class="kpi-value">${count}</div>
        <div class="kpi-change neutral">${activeProviders.map(p => (providerLabels[p] || p.toUpperCase())).join(' · ')}</div>
        <div class="provider-breakdown">${breakdownRows}</div>
      </div>
    `;
  }

  // ── Main render ──────────────────────────────────────────────────────────────

  /**
   * Renders the overview page using UnifiedData from DataBus.
   * Falls back gracefully if DataBus has no data yet.
   */
  function render() {
    const unified = DataBus.getData();
    if (!unified) return;

    const s = unified.summary;

    // Demo mode indicator
    renderDemoBanner(isDemoActive(unified));

    // ── KPI cards ──────────────────────────────────────────────────────────────
    const changeAmt = s.currentMonthCost - s.previousMonthCost;
    const changePct = s.previousMonthCost > 0
      ? ((changeAmt / s.previousMonthCost) * 100).toFixed(1)
      : '0.0';
    const isUp = changeAmt > 0;

    const budgetUtil = s.totalBudget > 0
      ? ((s.currentMonthCost / s.totalBudget) * 100).toFixed(1)
      : '0.0';
    const budgetAvailable = s.totalBudget - s.currentMonthCost;
    const budgetColor = s.currentMonthCost / s.totalBudget > 0.9 ? 'red' : 'yellow';
    const budgetChangeClass = s.currentMonthCost / s.totalBudget > 0.9 ? 'up' : 'neutral';

    const standardKpis = [
      {
        label: 'Gasto no Período',
        value: fmt(s.currentMonthCost),
        change: `${isUp ? '▲' : '▼'} ${Math.abs(changePct)}% vs período anterior`,
        changeClass: isUp ? 'up' : 'down',
        sub: `Projeção: ${fmt(s.projectedCost)}`,
        color: 'blue'
      },
      {
        label: 'Desperdício Identificado',
        value: fmt(s.totalWaste),
        change: `${s.wastePercent}% do total`,
        changeClass: 'up',
        sub: 'Recursos ociosos e superdimensionados',
        color: 'red'
      },
      {
        label: 'Economia Potencial',
        value: fmt(s.potentialSaving),
        change: `${s.savingPercent}% de redução possível`,
        changeClass: 'down',
        sub: 'Com as recomendações aplicadas',
        color: 'green'
      },
      {
        label: 'Orçamento Total',
        value: fmt(s.totalBudget),
        change: `${budgetUtil}% utilizado`,
        changeClass: budgetChangeClass,
        sub: `Disponível: ${fmt(budgetAvailable)}`,
        color: budgetColor
      },
      {
        label: 'Projetos Ativos',
        value: s.activeProjects,
        change: `${unified.services?.length || 0} serviços`,
        changeClass: 'neutral',
        sub: 'Monitorados neste período',
        color: 'purple'
      }
    ];

    const grid = document.getElementById('kpi-grid');
    if (!grid) return;

    // Standard KPI cards
    const standardHtml = standardKpis.map((k, i) => `
      <div class="kpi-card ${k.color}" style="animation-delay:${i * 0.08}s">
        <div class="kpi-label">${k.label}</div>
        <div class="kpi-value">${k.value}</div>
        <div class="kpi-change ${k.changeClass}">${k.change}</div>
        <div class="kpi-sub">${k.sub}</div>
      </div>
    `).join('');

    // "Providers Ativos" KPI card (appended after standard cards)
    const providersHtml = buildProvidersKpiCard(s, standardKpis.length * 0.08);

    grid.innerHTML = standardHtml + providersHtml;

    // ── Trend badge ────────────────────────────────────────────────────────────
    const badge = document.getElementById('trend-badge');
    if (badge) {
      badge.textContent = isUp
        ? `▲ ${Math.abs(changePct)}% vs anterior`
        : `▼ ${Math.abs(changePct)}% vs anterior`;
      badge.className = 'chart-badge' + (isUp ? ' up' : '');
    }

    // ── Charts ─────────────────────────────────────────────────────────────────
    setTimeout(() => {
      if (typeof renderTimeline === 'function') renderTimeline('chart-timeline', unified.timeline);
      if (typeof renderServicesDonut === 'function') renderServicesDonut('chart-services', unified.services);
      if (typeof renderTopProjects === 'function') renderTopProjects('chart-top-projects', unified.projects);
      if (typeof renderRegions === 'function') renderRegions('chart-regions', unified.regions);
      if (typeof renderBudget === 'function') renderBudget('chart-budget', s.currentMonthCost, s.totalBudget);
    }, 100);
  }

  // ── Public API ───────────────────────────────────────────────────────────────
  return { render, isDemoActive };
})();
