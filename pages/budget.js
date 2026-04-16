/**
 * FinOps Dashboard V2 — BudgetPage
 * Painel de orçamento multi-provider com alertas e exportação CSV.
 * Exposto como IIFE: const BudgetPage = (() => { ... })()
 */

const BudgetPage = (() => {
  // ── State ───────────────────────────────────────────────────────────────────
  const STORAGE_KEY = 'finops_budget_config';

  let budgetConfig = {
    budgets: {
      gcp:    { monthly: 0, alert75: true, alert90: true, alert100: true },
      huawei: { monthly: 0, alert75: true, alert90: true, alert100: true },
      total:  { monthly: 0, alert75: true, alert90: true, alert100: true }
    },
    currency: 'BRL',
    showProjected: true
  };

  // ── Persistence ─────────────────────────────────────────────────────────────

  function _loadConfig() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Deep merge to preserve defaults for new keys
        budgetConfig = {
          ...budgetConfig,
          ...parsed,
          budgets: {
            gcp:    { ...budgetConfig.budgets.gcp,    ...(parsed.budgets?.gcp    || {}) },
            huawei: { ...budgetConfig.budgets.huawei, ...(parsed.budgets?.huawei || {}) },
            total:  { ...budgetConfig.budgets.total,  ...(parsed.budgets?.total  || {}) }
          }
        };
      }
    } catch (loadErr) {
      console.warn('[BudgetPage] Failed to load config from localStorage:', loadErr);
    }
  }

  function _saveConfig() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(budgetConfig));
    } catch (saveErr) {
      console.warn('[BudgetPage] Failed to save config to localStorage:', saveErr);
    }
  }

  // ── Calculations ─────────────────────────────────────────────────────────────

  /**
   * Calcula o percentual de utilização do orçamento.
   * @param {number} currentSpend
   * @param {number} budgetLimit
   * @returns {number}
   */
  function calculateUtilization(currentSpend, budgetLimit) {
    if (!budgetLimit || budgetLimit <= 0) return 0;
    return (currentSpend / budgetLimit) * 100;
  }

  /**
   * Retorna o badge de alerta baseado na utilização.
   * @param {number} utilizationPct
   * @param {Object} config - { alert75, alert90, alert100 }
   * @returns {{ label: string, class: string }}
   */
  function getAlertBadge(utilizationPct, config) {
    if (utilizationPct >= 100 && config.alert100) {
      return { label: '🔴 Crítico', cls: 'badge--critical' };
    }
    if (utilizationPct >= 90 && config.alert90) {
      return { label: '🟠 Atenção', cls: 'badge--warning' };
    }
    if (utilizationPct >= 75 && config.alert75) {
      return { label: '🟡 Aviso', cls: 'badge--caution' };
    }
    return { label: '🟢 Normal', cls: 'badge--ok' };  }

  // ── Formatting ───────────────────────────────────────────────────────────────

  function _fmt(val) {
    if (typeof val !== 'number') return 'R$ 0';
    if (val >= 1e6) return `R$ ${(val / 1e6).toFixed(2)}M`;
    if (val >= 1e3) return `R$ ${(val / 1e3).toFixed(1)}K`;
    return `R$ ${val.toFixed(0)}`;
  }

  // ── Provider card ─────────────────────────────────────────────────────────────

  function _buildProviderCard(provider, label, currentSpend, projectedSpend) {
    const cfg = budgetConfig.budgets[provider] || { monthly: 0, alert75: true, alert90: true, alert100: true };
    const limit = cfg.monthly || 0;
    const utilPct = calculateUtilization(currentSpend, limit);
    const barWidth = Math.min(utilPct, 100).toFixed(1);
    const badge = getAlertBadge(utilPct, cfg);

    let barColor = '#00c48c';
    if (utilPct >= 100) { barColor = '#ff4d6a'; }
    else if (utilPct >= 90) { barColor = '#ff6b35'; }
    else if (utilPct >= 75) { barColor = '#ffb800'; }
    return `
      <div class="budget-provider-card" data-provider="${provider}">
        <div class="budget-provider-header">
          <span class="provider-badge ${provider}">${label}</span>
          <span class="budget-alert-badge ${badge.cls}">${badge.label}</span>
        </div>
        <div class="budget-current">${_fmt(currentSpend)}</div>
        <div class="budget-limit-row">
          <span>Orçamento:</span>
          <input
            type="number"
            class="budget-input"
            data-provider="${provider}"
            value="${limit}"
            min="0"
            step="1000"
            placeholder="0"
          />
        </div>
        <div class="budget-bar-wrap">
          <div class="budget-bar">
            <div class="budget-bar-fill" style="width: ${barWidth}%; background: ${barColor}"></div>
          </div>
          <span class="budget-pct">${utilPct.toFixed(1)}%</span>
        </div>
        ${budgetConfig.showProjected ? `<div class="budget-projected">Projeção: ${_fmt(projectedSpend)}</div>` : ''}
      </div>
    `;
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  /**
   * Renderiza a página de orçamento no #page-budget.
   * @param {Object} data - UnifiedData do DataBus
   */
  function render(data) {
    _loadConfig();

    const container = document.getElementById('page-budget');
    if (!container) return;

    const summary = (data && data.summary) || {};
    const byProvider = summary.byProvider || {};

    const gcpCurrent = byProvider.gcp?.currentCost || 0;
    const hwCurrent = byProvider.huawei?.currentCost || 0;
    const totalCurrent = summary.totalCurrentCost || (gcpCurrent + hwCurrent);

    // Projected: use summary.projectedCost or estimate 5% growth
    const gcpProjected = Math.round(gcpCurrent * 1.05);
    const hwProjected = Math.round(hwCurrent * 1.05);
    const totalProjected = summary.projectedCost || Math.round(totalCurrent * 1.05);

    container.innerHTML = `
      <div class="budget-page">
        <div class="budget-providers-grid">
          ${_buildProviderCard('gcp', 'GCP', gcpCurrent, gcpProjected)}
          ${_buildProviderCard('huawei', 'Huawei', hwCurrent, hwProjected)}
          ${_buildProviderCard('total', 'Total', totalCurrent, totalProjected)}
        </div>

        <div class="chart-card full-width">
          <div class="chart-header">
            <h3>Gastos Mensais por Provider vs Orçamento</h3>
            <button id="btn-export-budget" class="btn-secondary">Exportar CSV</button>
          </div>
          <canvas id="chart-budget-monthly"></canvas>
        </div>
      </div>
    `;

    _bindEvents(data);
    renderBudgetChart(data);
  }

  // ── Event binding ─────────────────────────────────────────────────────────────

  function _bindEvents(data) {
    // Budget input changes
    document.querySelectorAll('.budget-input').forEach(input => {
      input.addEventListener('change', (e) => {
        const provider = e.target.dataset.provider;
        const value = parseFloat(e.target.value) || 0;
        if (budgetConfig.budgets[provider]) {
          budgetConfig.budgets[provider].monthly = value;
          _saveConfig();
          render(data);
        }
      });
    });

    // Export button
    const exportBtn = document.getElementById('btn-export-budget');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => exportReport(data));
    }
  }

  // ── renderBudgetChart ─────────────────────────────────────────────────────────

  /**
   * Renderiza o gráfico de barras mensais GCP + Huawei com linha de orçamento.
   * @param {Object} data - UnifiedData
   */
  function renderBudgetChart(data) {
    // Use renderProviderBudgetChart from charts.js if available (Task 14)
    if (typeof renderProviderBudgetChart === 'function') {
      renderProviderBudgetChart('chart-budget-monthly', data, budgetConfig);
      return;
    }

    // Fallback: render a simple grouped bar chart inline
    const canvas = document.getElementById('chart-budget-monthly');
    if (!canvas || typeof Chart === 'undefined') return;

    // Destroy existing chart if any
    if (typeof destroyChart === 'function') {
      destroyChart('chart-budget-monthly');
    }

    const summary = (data && data.summary) || {};
    const byProvider = summary.byProvider || {};

    const gcpCurrent = byProvider.gcp?.currentCost || 0;
    const hwCurrent = byProvider.huawei?.currentCost || 0;
    const totalBudget = budgetConfig.budgets.total.monthly || 0;

    // Build last 6 months labels (simplified)
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }));
    }

    // Simulate monthly data with slight variation (real data would come from timeline)
    const gcpData = months.map((_, i) => Math.round(gcpCurrent * (0.85 + i * 0.03)));
    const hwData = months.map((_, i) => Math.round(hwCurrent * (0.85 + i * 0.03)));

    const ctx = canvas.getContext('2d');
    const chartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: months,
        datasets: [
          {
            label: 'GCP',
            data: gcpData,
            backgroundColor: 'rgba(26,115,232,0.8)',
            borderRadius: 6,
            borderSkipped: false
          },
          {
            label: 'Huawei',
            data: hwData,
            backgroundColor: 'rgba(255,77,106,0.8)',
            borderRadius: 6,
            borderSkipped: false
          },
          ...(totalBudget > 0 ? [{
            label: 'Orçamento Total',
            data: months.map(() => totalBudget),
            type: 'line',
            borderColor: '#ffb800',
            borderDash: [6, 3],
            borderWidth: 2,
            pointRadius: 0,
            fill: false,
            tension: 0
          }] : [])
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 900 },
        plugins: {
          legend: { position: 'top' },
          datalabels: { display: false },
          tooltip: {
            backgroundColor: '#1e2535',
            borderColor: '#2a3347',
            borderWidth: 1,
            callbacks: {
              label: (ctx) => {
                const val = ctx.raw;
                if (typeof val !== 'number') return '';
                return `${ctx.dataset.label}: ${_fmt(val)}`;
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            grid: { color: '#2a3347' },
            ticks: { callback: v => _fmt(v) }
          }
        }
      }
    });

    // Store reference for cleanup
    if (typeof activeCharts !== 'undefined') {
      activeCharts['chart-budget-monthly'] = chartInstance;
    }
  }

  // ── exportReport ──────────────────────────────────────────────────────────────

  /**
   * Gera e faz download de um relatório CSV de orçamento.
   * @param {Object} data - UnifiedData
   */
  function exportReport(data) {
    const summary = (data && data.summary) || {};
    const byProvider = summary.byProvider || {};

    const gcpCurrent = byProvider.gcp?.currentCost || 0;
    const hwCurrent = byProvider.huawei?.currentCost || 0;
    const totalCurrent = summary.totalCurrentCost || (gcpCurrent + hwCurrent);

    const rows = [
      ['provider', 'currentSpend', 'budgetLimit', 'utilizationPct', 'projectedSpend'],
      [
        'gcp',
        gcpCurrent,
        budgetConfig.budgets.gcp.monthly || 0,
        calculateUtilization(gcpCurrent, budgetConfig.budgets.gcp.monthly).toFixed(2),
        Math.round(gcpCurrent * 1.05)
      ],
      [
        'huawei',
        hwCurrent,
        budgetConfig.budgets.huawei.monthly || 0,
        calculateUtilization(hwCurrent, budgetConfig.budgets.huawei.monthly).toFixed(2),
        Math.round(hwCurrent * 1.05)
      ],
      [
        'total',
        totalCurrent,
        budgetConfig.budgets.total.monthly || 0,
        calculateUtilization(totalCurrent, budgetConfig.budgets.total.monthly).toFixed(2),
        summary.projectedCost || Math.round(totalCurrent * 1.05)
      ]
    ];

    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `finops-budget-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  return {
    render,
    calculateUtilization,
    getAlertBadge,
    exportReport,
    renderBudgetChart
  };
})();
