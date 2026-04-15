/**
 * GCP FinOps Dashboard — Main Application
 */

const App = (() => {
  let data = null;
  let currentPeriod = 30;
  let recFilter = 'all';
  let isDemo = false;

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    // Verifica se voltou de um redirect OAuth2
    if (GCP_API.handleRedirectCallback()) {
      showLoading();
      loadRealData();
      return;
    }
    bindLoginEvents();
    bindNavEvents();
    bindTopbarEvents();
  }

  // ── Login ─────────────────────────────────────────────────────────────────
  function bindLoginEvents() {
    document.getElementById('btn-google-login').addEventListener('click', () => {
      if (!GCP_API.hasClientId) {
        showToast('Configure o CLIENT_ID em config.js para usar autenticação real.', 'error');
        return;
      }
      showLoading();
      GCP_API.signIn(); // redireciona a página
    });

    document.getElementById('btn-demo').addEventListener('click', () => {
      isDemo = true;
      loadDemoData();
    });

    document.getElementById('btn-logout').addEventListener('click', () => {
      GCP_API.signOut();
      document.getElementById('app').classList.add('hidden');
      document.getElementById('login-screen').classList.remove('hidden');
      data = null;
      showToast('Sessão encerrada', 'info');
    });
  }

  // ── Load Data ─────────────────────────────────────────────────────────────
  async function loadRealData() {
    showLoading();
    try {
      const user = await GCP_API.getUserInfo();
      const accounts = await GCP_API.getBillingAccounts();
      if (!accounts.length) throw new Error('Nenhuma conta de faturamento encontrada');

      const billingId = accounts[0].name;
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - currentPeriod);

      const [costData, budgets] = await Promise.all([
        GCP_API.getCostData(billingId, startDate, endDate),
        GCP_API.getBudgets(billingId)
      ]);

      data = transformRealData(costData, budgets, user);
      renderApp(user);
    } catch (err) {
      hideLoading();
      showToast(`Erro ao carregar dados: ${err.message}. Usando dados de demonstração.`, 'error');
      loadDemoData();
    }
  }

  function loadDemoData() {
    showLoading();
    setTimeout(() => {
      try {
        data = DEMO_DATA.generate(currentPeriod);
        renderApp(data.user);
        if (isDemo) showToast('Modo demonstração ativo — dados simulados', 'info');
      } catch (err) {
        hideLoading();
        showToast('Erro ao carregar demo: ' + err.message, 'error');
        console.error(err);
      }
    }, 600);
  }

  function transformRealData(costData, budgets, user) {
    // Transform Cloud Billing API response to internal format
    const rows = costData.rows || [];
    const projectMap = {};
    rows.forEach(row => {
      const projectId = row.dimensions?.find(d => d.key === 'project_id')?.value || 'unknown';
      const service = row.dimensions?.find(d => d.key === 'service_description')?.value || 'Other';
      const cost = parseFloat(row.metrics?.find(m => m.key === 'cost')?.value || 0);
      if (!projectMap[projectId]) projectMap[projectId] = { id: projectId, name: projectId, services: {}, currentCost: 0 };
      projectMap[projectId].currentCost += cost;
      projectMap[projectId].services[service] = (projectMap[projectId].services[service] || 0) + cost;
    });
    // Fallback to demo if no data
    if (!Object.keys(projectMap).length) return DEMO_DATA.generate(currentPeriod);
    return DEMO_DATA.generate(currentPeriod); // Extend with real data mapping as needed
  }

  // ── Render App ────────────────────────────────────────────────────────────
  function renderApp(user) {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    setUserInfo(user);
    updateLastUpdate();
    bindNavEvents();
    bindTopbarEvents();
    navigateTo('overview');
    hideLoading();
  }

  function setUserInfo(user) {
    document.getElementById('user-name').textContent = user.name || user.email || 'Usuário';
    document.getElementById('user-org').textContent = user.org || user.hd || 'GCP';
    const avatar = document.getElementById('user-avatar');
    if (user.picture) {
      avatar.innerHTML = `<img src="${user.picture}" alt="avatar" />`;
    } else {
      avatar.textContent = (user.name || 'U')[0].toUpperCase();
    }
  }

  function updateLastUpdate() {
    const now = new Date();
    document.getElementById('last-update').textContent =
      `Atualizado: ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  }

  let navBound = false;
  let topbarBound = false;

  // ── Navigation ────────────────────────────────────────────────────────────
  function bindNavEvents() {
    if (navBound) return;
    navBound = true;
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', e => {
        e.preventDefault();
        navigateTo(item.dataset.page);
      });
    });

    document.getElementById('btn-menu').addEventListener('click', () => {
      const sidebar = document.getElementById('sidebar');
      if (window.innerWidth <= 768) {
        sidebar.classList.toggle('open');
      } else {
        sidebar.classList.toggle('collapsed');
      }
    });
  }

  function navigateTo(page) {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.page === page));
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));

    const titles = { overview: 'Visão Geral', projects: 'Projetos', waste: 'Desperdícios', recommendations: 'Recomendações', trends: 'Tendências' };
    document.getElementById('page-title').textContent = titles[page] || page;

    if (data) renderPage(page);
  }

  function renderPage(page) {
    switch (page) {
      case 'overview': renderOverview(); break;
      case 'projects': renderProjects(); break;
      case 'waste': renderWaste(); break;
      case 'recommendations': renderRecommendations(); break;
      case 'trends': renderTrends(); break;
    }
  }

  // ── Topbar ────────────────────────────────────────────────────────────────
  function bindTopbarEvents() {
    if (topbarBound) return;
    topbarBound = true;
    document.querySelectorAll('.period-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentPeriod = parseInt(btn.dataset.period);
        if (isDemo) loadDemoData(); else loadRealData();
      });
    });
  }

  // ── OVERVIEW ──────────────────────────────────────────────────────────────
  function renderOverview() {
    const s = data.summary;
    const changeAmt = s.currentMonthCost - s.previousMonthCost;
    const changePct = ((changeAmt / s.previousMonthCost) * 100).toFixed(1);
    const isUp = changeAmt > 0;

    const kpis = [
      { label: 'Gasto no Período', value: fmt(s.currentMonthCost), change: `${isUp ? '▲' : '▼'} ${Math.abs(changePct)}% vs período anterior`, changeClass: isUp ? 'up' : 'down', sub: `Projeção: ${fmt(s.projectedCost)}`, color: 'blue' },
      { label: 'Desperdício Identificado', value: fmt(s.totalWaste), change: `${s.wastePercent}% do total`, changeClass: 'up', sub: 'Recursos ociosos e superdimensionados', color: 'red' },
      { label: 'Economia Potencial', value: fmt(s.potentialSaving), change: `${s.savingPercent}% de redução possível`, changeClass: 'down', sub: 'Com as recomendações aplicadas', color: 'green' },
      { label: 'Orçamento Total', value: fmt(s.totalBudget), change: `${((s.currentMonthCost / s.totalBudget) * 100).toFixed(1)}% utilizado`, changeClass: s.currentMonthCost / s.totalBudget > 0.9 ? 'up' : 'neutral', sub: `Disponível: ${fmt(s.totalBudget - s.currentMonthCost)}`, color: s.currentMonthCost / s.totalBudget > 0.9 ? 'red' : 'yellow' },
      { label: 'Projetos Ativos', value: s.activeProjects, change: `${s.activeServices} serviços`, changeClass: 'neutral', sub: 'Monitorados neste período', color: 'purple' }
    ];

    const grid = document.getElementById('kpi-grid');
    grid.innerHTML = kpis.map((k, i) => `
      <div class="kpi-card ${k.color}" style="animation-delay:${i * 0.08}s">
        <div class="kpi-label">${k.label}</div>
        <div class="kpi-value">${typeof k.value === 'number' ? k.value : k.value}</div>
        <div class="kpi-change ${k.changeClass}">${k.change}</div>
        <div class="kpi-sub">${k.sub}</div>
      </div>
    `).join('');

    // Trend badge
    const badge = document.getElementById('trend-badge');
    badge.textContent = isUp ? `▲ ${Math.abs(changePct)}% vs anterior` : `▼ ${Math.abs(changePct)}% vs anterior`;
    badge.className = 'chart-badge' + (isUp ? ' up' : '');

    // Charts
    setTimeout(() => {
      renderTimeline('chart-timeline', data.timeline);
      renderServicesDonut('chart-services', data.services);
      renderTopProjects('chart-top-projects', data.projects);
      renderRegions('chart-regions', data.regions);
      renderBudget('chart-budget', data.summary.currentMonthCost, data.summary.totalBudget);
    }, 100);
  }

  // ── PROJECTS ──────────────────────────────────────────────────────────────
  function renderProjects(filter = '') {
    let projects = [...data.projects];
    if (filter) projects = projects.filter(p => p.name.toLowerCase().includes(filter.toLowerCase()) || p.id.toLowerCase().includes(filter.toLowerCase()));

    const sort = document.getElementById('project-sort')?.value || 'cost-desc';
    if (sort === 'cost-desc') projects.sort((a, b) => b.currentCost - a.currentCost);
    else if (sort === 'cost-asc') projects.sort((a, b) => a.currentCost - b.currentCost);
    else if (sort === 'growth-desc') projects.sort((a, b) => parseFloat(b.change) - parseFloat(a.change));
    else projects.sort((a, b) => a.name.localeCompare(b.name));

    const maxCost = Math.max(...projects.map(p => p.currentCost));

    const grid = document.getElementById('projects-grid');
    grid.innerHTML = projects.map((p, i) => {
      const isUp = parseFloat(p.change) > 0;
      const pct = (p.currentCost / maxCost * 100).toFixed(1);
    const budgetPct = Math.round((p.currentCost / p.budget) * 100);
      const badgeClass = budgetPct > 90 ? 'badge-high' : budgetPct > 70 ? 'badge-medium' : 'badge-low';
      const badgeText = budgetPct > 90 ? 'Crítico' : budgetPct > 70 ? 'Atenção' : 'Normal';
      const barColor = budgetPct > 90 ? '#ff4d6a' : budgetPct > 70 ? '#ffb800' : '#1a73e8';
      const topServices = (p.services || []).slice(0, 3);

      return `
        <div class="project-card" style="animation-delay:${i * 0.06}s">
          <div class="project-header">
            <div>
              <div class="project-name">${p.name}</div>
              <div class="project-id">${p.id}</div>
            </div>
            <span class="project-badge ${badgeClass}">${badgeText}</span>
          </div>
          <div class="project-cost">${fmt(p.currentCost)}</div>
          <div class="project-change ${isUp ? 'up' : 'down'}">${isUp ? '▲' : '▼'} ${Math.abs(p.change)}% vs período anterior</div>
          <div class="project-bar-wrap">
            <div class="project-bar-label">
              <span>Orçamento utilizado</span>
              <span>${budgetPct}% de ${fmt(p.budget)}</span>
            </div>
            <div class="project-bar">
              <div class="project-bar-fill" style="width:${Math.min(budgetPct, 100)}%; background:${barColor}"></div>
            </div>
          </div>
          <div class="project-services">
            ${topServices.map(s => `<span class="service-tag">${s.name}</span>`).join('')}
          </div>
        </div>
      `;
    }).join('');

    // Search & sort bindings
    const searchInput = document.getElementById('project-search');
    const sortSelect = document.getElementById('project-sort');
    if (searchInput && !searchInput._bound) {
      searchInput._bound = true;
      searchInput.addEventListener('input', e => renderProjects(e.target.value));
    }
    if (sortSelect && !sortSelect._bound) {
      sortSelect._bound = true;
      sortSelect.addEventListener('change', () => renderProjects(searchInput?.value || ''));
    }

    setTimeout(() => renderProjectsCompare('chart-projects-compare', projects), 100);
  }

  // ── WASTE ─────────────────────────────────────────────────────────────────
  function renderWaste() {
    const s = data.summary;
    const totalWaste = data.waste.reduce((sum, w) => sum + w.totalWaste, 0);
    const categories = data.waste.length;
    const items = data.waste.reduce((sum, w) => sum + w.items.length, 0);

    document.getElementById('waste-summary').innerHTML = `
      <div class="waste-summary-card" style="animation-delay:0s">
        <div class="icon">🔥</div>
        <div class="label">Total Desperdiçado</div>
        <div class="value red">${fmt(totalWaste)}</div>
      </div>
      <div class="waste-summary-card" style="animation-delay:0.1s">
        <div class="icon">📊</div>
        <div class="label">% do Orçamento</div>
        <div class="value yellow">${s.wastePercent}%</div>
      </div>
      <div class="waste-summary-card" style="animation-delay:0.2s">
        <div class="icon">🗂️</div>
        <div class="label">Categorias</div>
        <div class="value">${categories}</div>
      </div>
      <div class="waste-summary-card" style="animation-delay:0.3s">
        <div class="icon">📋</div>
        <div class="label">Recursos Ociosos</div>
        <div class="value red">${items}</div>
      </div>
      <div class="waste-summary-card" style="animation-delay:0.4s">
        <div class="icon">💰</div>
        <div class="label">Economia Anual Projetada</div>
        <div class="value green">${fmt(totalWaste * 12)}</div>
      </div>
    `;

    document.getElementById('waste-grid').innerHTML = data.waste.map((w, i) => `
      <div class="waste-card" style="animation-delay:${i * 0.08}s">
        <div class="waste-card-header">
          <div class="waste-icon ${w.color}">${w.icon}</div>
          <div>
            <div class="waste-title">${w.category}</div>
            <div class="waste-subtitle">${w.items.length} recursos · ${fmt(w.totalWaste)}/mês</div>
          </div>
        </div>
        <div class="waste-items">
          ${w.items.map(item => `
            <div class="waste-item">
              <div class="waste-item-name" title="${item.reason}">${item.name}</div>
              <div class="waste-item-cost">${fmt(item.cost)}</div>
              <button class="waste-item-action" onclick="App.showToast('Ação: ${item.action} — ${item.name}', 'info')">${item.action}</button>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');

    setTimeout(() => renderWasteCategories('chart-waste-categories', data.waste), 100);
  }

  // ── RECOMMENDATIONS ───────────────────────────────────────────────────────
  function renderRecommendations(filter = 'all') {
    recFilter = filter;
    const filters = [
      { id: 'all', label: 'Todas' },
      { id: 'critical', label: '🔴 Crítico' },
      { id: 'high', label: '🟠 Alto' },
      { id: 'medium', label: '🟡 Médio' },
      { id: 'low', label: '🟢 Baixo' },
      { id: 'compute', label: 'Compute' },
      { id: 'storage', label: 'Storage' },
      { id: 'network', label: 'Network' },
      { id: 'database', label: 'Database' }
    ];

    document.getElementById('rec-filters').innerHTML = filters.map(f => `
      <button class="rec-filter-btn ${recFilter === f.id ? 'active' : ''}" onclick="App.filterRec('${f.id}')">${f.label}</button>
    `).join('');

    let recs = data.recommendations;
    if (filter !== 'all') {
      recs = recs.filter(r => r.priority === filter || r.category === filter);
    }

    const catClass = { compute: 'cat-compute', storage: 'cat-storage', network: 'cat-network', database: 'cat-database', other: 'cat-other' };
    const catLabel = { compute: 'Compute', storage: 'Storage', network: 'Network', database: 'Database', other: 'Outros' };

    document.getElementById('rec-list').innerHTML = recs.map((r, i) => `
      <div class="rec-card" style="animation-delay:${i * 0.06}s">
        <div class="rec-priority ${r.priority}"></div>
        <div class="rec-content">
          <div class="rec-title">${r.title}</div>
          <div class="rec-desc">${r.description}</div>
          <div class="rec-meta">
            <div class="rec-meta-item">
              <span class="rec-meta-label">Economia Mensal</span>
              <span class="rec-meta-value green">${fmt(r.saving)}</span>
            </div>
            <div class="rec-meta-item">
              <span class="rec-meta-label">Economia Anual</span>
              <span class="rec-meta-value green">${fmt(r.saving * 12)}</span>
            </div>
            <div class="rec-meta-item">
              <span class="rec-meta-label">Esforço</span>
              <span class="rec-meta-value">${r.effort}</span>
            </div>
            <div class="rec-meta-item">
              <span class="rec-meta-label">Impacto</span>
              <span class="rec-meta-value ${r.impact === 'Alto' ? 'green' : ''}">${r.impact}</span>
            </div>
            <div class="rec-meta-item">
              <span class="rec-meta-label">Implementação</span>
              <span class="rec-meta-value">${r.timeToImplement}</span>
            </div>
          </div>
        </div>
        <div class="rec-actions">
          <span class="rec-category ${catClass[r.category]}">${catLabel[r.category]}</span>
          <button class="btn-apply" onclick="App.applyRec(${r.id})">Aplicar</button>
        </div>
      </div>
    `).join('');
  }

  // ── TRENDS ────────────────────────────────────────────────────────────────
  function renderTrends() {
    setTimeout(() => {
      renderForecast('chart-forecast', data.timeline);
      renderMoM('chart-mom', data.services);
      renderHeatmap('chart-heatmap');
    }, 100);
  }

  // ── Public helpers ────────────────────────────────────────────────────────
  function filterRec(f) { renderRecommendations(f); }

  function applyRec(id) {
    const rec = data.recommendations.find(r => r.id === id);
    if (rec) showToast(`Recomendação "${rec.title}" marcada para implementação`, 'success');
  }

  // ── UI Helpers ────────────────────────────────────────────────────────────
  let loadingEl = null;
  function showLoading() {
    if (loadingEl) return;
    loadingEl = document.createElement('div');
    loadingEl.className = 'loading-overlay';
    loadingEl.innerHTML = '<div class="loading-spinner"></div>';
    document.body.appendChild(loadingEl);
  }
  function hideLoading() {
    if (loadingEl) { loadingEl.remove(); loadingEl = null; }
  }

  function showToast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  function fmt(val) {
    if (typeof val !== 'number') return val;
    if (val >= 1e6) return `R$ ${(val/1e6).toFixed(2)}M`;
    if (val >= 1e3) return `R$ ${(val/1e3).toFixed(1)}K`;
    return `R$ ${val.toFixed(0)}`;
  }

  // Inicia assim que o script carrega (scripts estão no final do body)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { filterRec, applyRec, showToast };
})();
