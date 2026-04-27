/**
 * GCP FinOps Dashboard V2 — Main Application Shell
 * Orchestrates DataBus, providers, routing, lazy loading and modals.
 */

const App = (() => {
  let currentPeriod = 30;
  let isDemo = false;

  // Pages already loaded via <script> tags in index.html — no dynamic load needed
  const PRELOADED_PAGES = new Set([
    'overview', 'projects', 'waste', 'recommendations', 'trends', 'ai-chat', 'budget'
  ]);

  // Track which pages have been loaded (for lazy loading of future pages not in index.html)
  const loadedPages = new Set(PRELOADED_PAGES);

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    // Register real providers in DataBus (DEMO_DATA is handled internally by DataBus as fallback)
    DataBus.registerProvider(GCP_API);
    DataBus.registerProvider(HUAWEI_API);

    // Re-render current page whenever DataBus fires an update
    DataBus.onUpdate(data => {
      isDemo = !!data.isDemo;
      _updateDataStatus(isDemo);
      updateLastUpdate();
      const activePage = document.querySelector('.nav-item.active');
      if (activePage) renderPage(activePage.dataset.page);
    });

    // Listen for JWT expiry — clear session and show login screen
    window.addEventListener('auth:expired', () => {
      BackendProvider.clearJWT();
      _showLoginScreen();
      showToast('Sessão expirada. Faça login novamente.', 'error');
    });

    // If ?jwt= is in URL, handle backend auth callback first
    const _initParams = new URLSearchParams(window.location.search);
    if (_initParams.has('jwt')) {
      handleAuthCallback();
      return;
    }

    // If ?error= is in URL, show the error from the backend auth flow
    if (_initParams.has('error')) {
      const authError = _initParams.get('error');
      history.replaceState(null, '', window.location.pathname + window.location.hash);
      bindLoginEvents();
      showToast(authError, 'error');
      return;
    }

    // If BACKEND_URL is configured but no JWT yet, show login screen for Google SSO
    if (window.BACKEND_URL && !BackendProvider.hasJWT()) {
      bindLoginEvents();
      return;
    }

    // Handle legacy GCP OAuth2 redirect callback
    if (GCP_API.handleRedirectCallback()) {
      showLoading();
      _loadData();
      return;
    }

    bindLoginEvents();
    bindNavEvents();
    bindTopbarEvents();
    bindHuaweiConfigButton();
    bindCSVImportButton();
  }

  // ── Backend Auth Callback ─────────────────────────────────────────────────
  /**
   * Handles the redirect back from the backend after Google SSO.
   * Captures ?jwt=<token> from URL, stores it in BackendProvider,
   * removes the token from the URL, then loads data.
   * Requirement 9.3, 9.4
   */
  function handleAuthCallback() {
    const params = new URLSearchParams(window.location.search);
    const jwt = params.get('jwt');

    if (!jwt) {
      showToast('Falha na autenticação: token ausente.', 'error');
      bindLoginEvents();
      return;
    }

    // Store JWT in memory only — never in localStorage (Requirement 9.4)
    BackendProvider.setJWT(jwt);

    // Remove JWT from URL to avoid leaking it in browser history (Requirement 9.3)
    params.delete('jwt');
    const newSearch = params.toString();
    const newUrl = window.location.pathname + (newSearch ? '?' + newSearch : '') + window.location.hash;
    history.replaceState(null, '', newUrl);

    // Proceed to load data
    bindNavEvents();
    bindTopbarEvents();
    bindHuaweiConfigButton();
    bindCSVImportButton();
    _loadData();
  }

  // ── Google Login via Backend ──────────────────────────────────────────────
  /**
   * Redirects to the backend Google OAuth2 flow.
   * Requirement 9.2
   */
  function handleGoogleLogin() {
    if (!window.BACKEND_URL) {
      showToast('BACKEND_URL não configurado.', 'error');
      return;
    }
    window.location.href = `${window.BACKEND_URL}/auth/google`;
  }

  // ── Logout ────────────────────────────────────────────────────────────────
  /**
   * Clears the JWT and shows the login screen.
   * Requirement 9.5
   */
  function handleLogout() {
    BackendProvider.clearJWT();
    _showLoginScreen();
    showToast('Sessão encerrada', 'info');
  }

  function _showLoginScreen() {
    document.getElementById('app').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
  }

  // ── Login ─────────────────────────────────────────────────────────────────
  function bindLoginEvents() {
    document.getElementById('btn-google-login').addEventListener('click', () => {
      // If BACKEND_URL is configured, use backend Google SSO flow (Requirement 9.2, 8.7)
      if (window.BACKEND_URL) {
        handleGoogleLogin();
        return;
      }
      // Fallback: legacy GCP client-side OAuth2
      if (!GCP_API.hasClientId) {
        showToast('Configure o CLIENT_ID em config.js para usar autenticação real.', 'error');
        return;
      }
      showLoading();
      GCP_API.signIn();
    });

    document.getElementById('btn-demo').addEventListener('click', () => {
      isDemo = true;
      _loadData();
    });

    document.getElementById('btn-logout').addEventListener('click', () => {
      handleLogout();
      // Also sign out of legacy GCP session if active
      if (!window.BACKEND_URL) GCP_API.signOut();
    });
  }

  // ── Data Loading via DataBus ──────────────────────────────────────────────
  async function _loadData() {
    showLoading();
    try {
      // Se estiver usando GCP direto e autenticado, busca o perfil do usuário
      if (GCP_API.isAuthenticated() && !GCP_API.currentUser) {
        try { await GCP_API.getUserInfo(); } catch (e) { console.warn('User info fetch failed:', e); }
      }

      const data = await DataBus.load(currentPeriod);
      isDemo = !!data.isDemo;
      _renderApp(data);

      // Trigger AI auto-analysis after data loads
      if (typeof AIAgent !== 'undefined' && !AIAgent.isDisabled()) {
        AIAgent.autoAnalyze(data).then(insights => {
          if (insights && insights.length > 0) {
            console.info('[App] AI insights:', insights.length);
          }
        }).catch(err => {
          console.warn('[App] autoAnalyze error:', err.message);
        });
      }
    } catch (err) {
      hideLoading();
      showToast('Erro ao carregar dados: ' + err.message, 'error');
    }
  }

  // ── Render App ────────────────────────────────────────────────────────────
  function _renderApp(data) {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');

    const user = data.user || (GCP_API.currentUser) || { name: 'Usuário', org: 'FinOps V2' };
    _setUserInfo(user);
    _updateDataStatus(isDemo);
    updateLastUpdate();

    bindNavEvents();
    bindTopbarEvents();
    bindHuaweiConfigButton();
    bindCSVImportButton();

    navigateTo('overview');
    hideLoading();

    if (isDemo) showToast('Modo demonstração ativo — dados simulados', 'info');
  }

  function _setUserInfo(user) {
    document.getElementById('user-name').textContent = user.name || user.email || 'Usuário';
    document.getElementById('user-org').textContent = user.org || user.hd || 'FinOps V2';
    const avatar = document.getElementById('user-avatar');
    if (user.picture) {
      avatar.innerHTML = `<img src="${user.picture}" alt="avatar" />`;
    } else {
      avatar.textContent = (user.name || 'U')[0].toUpperCase();
    }
  }

  function _updateDataStatus(demo) {
    const badge = document.getElementById('data-status-badge');
    if (!badge) return;

    const text = badge.querySelector('.status-text');
    if (demo) {
      badge.className = 'data-status-badge status-demo';
      if (text) text.textContent = 'MODO DEMONSTRAÇÃO';
    } else {
      badge.className = 'data-status-badge status-real';
      if (text) text.textContent = 'CONECTADO: DADOS REAIS';
    }
  }

  function updateLastUpdate() {
    const now = new Date();
    const el = document.getElementById('last-update');
    if (el) el.textContent = `Atualizado: ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  }

  // ── Navigation ────────────────────────────────────────────────────────────
  let navBound = false;
  let topbarBound = false;

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

  async function navigateTo(page) {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.page === page));
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));

    const titles = {
      overview:        'Visão Geral',
      projects:        'Projetos',
      waste:           'Desperdícios',
      recommendations: 'Recomendações',
      trends:          'Tendências',
      budget:          'Orçamento',
      'ai-chat':       'Chat IA'
    };
    document.getElementById('page-title').textContent = titles[page] || page;

    // Lazy load page module if not already loaded
    await _ensurePageLoaded(page);

    const data = DataBus.getData();
    if (data) renderPage(page);
  }

  /**
   * Lazy loads a page module via dynamic <script> tag.
   * No-op if the page is already loaded (preloaded or previously loaded).
   */
  async function _ensurePageLoaded(page) {
    if (loadedPages.has(page)) return;

    return new Promise(resolve => {
      const script = document.createElement('script');
      script.src = `pages/${page}.js`;
      script.onload = () => {
        loadedPages.add(page);
        resolve();
      };
      script.onerror = () => {
        console.warn(`[App] Could not lazy-load pages/${page}.js`);
        resolve(); // resolve anyway — page may still render with fallback
      };
      document.head.appendChild(script);
    });
  }

  function renderPage(page) {
    switch (page) {
      case 'overview':
        if (typeof OverviewPage !== 'undefined') OverviewPage.render();
        else _renderOverviewFallback();
        break;
      case 'projects':
        if (typeof ProjectsPage !== 'undefined') ProjectsPage.render();
        else _renderProjectsFallback();
        break;
      case 'waste':
        if (typeof WastePage !== 'undefined') WastePage.render();
        else _renderWasteFallback();
        break;
      case 'recommendations':
        if (typeof RecommendationsPage !== 'undefined') RecommendationsPage.render();
        else _renderRecommendationsFallback();
        break;
      case 'trends':
        if (typeof TrendsPage !== 'undefined') TrendsPage.render();
        else _renderTrendsFallback();
        break;
      case 'budget':
        if (typeof BudgetPage !== 'undefined') BudgetPage.render();
        break;
      case 'ai-chat':
        if (typeof AIChatPage !== 'undefined') AIChatPage.render();
        break;
      case 'okrs':
        if (typeof OKRsPage !== 'undefined') OKRsPage.render();
        break;
      default:
        break;
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
        _loadData();
      });
    });
  }

  // ── CSV Import Button ─────────────────────────────────────────────────────
  let csvBtnBound = false;
  function bindCSVImportButton() {
    if (csvBtnBound) return;
    const btn = document.getElementById('btn-import-csv');
    if (!btn) return;
    csvBtnBound = true;
    btn.addEventListener('click', () => {
      if (typeof CSVImporter !== 'undefined') {
        CSVImporter.showImportModal('projects');
      } else {
        showToast('Módulo de importação CSV não disponível.', 'error');
      }
    });
  }

  // ── Huawei Config Modal ───────────────────────────────────────────────────
  let huaweiBtnBound = false;
  function bindHuaweiConfigButton() {
    if (huaweiBtnBound) return;
    const btn = document.getElementById('btn-huawei-config');
    if (!btn) return;
    huaweiBtnBound = true;
    btn.addEventListener('click', showHuaweiConfigModal);
  }

  function showHuaweiConfigModal() {
    const existing = document.getElementById('huawei-config-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'huawei-config-modal';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.65)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'z-index:9999', 'padding:16px'
    ].join(';');

    const modal = document.createElement('div');
    modal.style.cssText = [
      'background:#1e2130', 'border-radius:12px', 'padding:28px',
      'width:100%', 'max-width:480px', 'color:#e0e0e0', 'font-family:inherit'
    ].join(';');

    modal.innerHTML = `
      <h2 style="margin:0 0 6px;font-size:1.15rem;color:#fff;">Configurar Huawei Cloud</h2>
      <p style="margin:0 0 20px;font-size:.85rem;color:#9ca3af;">
        As credenciais são armazenadas apenas em memória e descartadas ao fechar o browser.
      </p>
      <div style="display:flex;flex-direction:column;gap:14px;">
        <label style="display:flex;flex-direction:column;gap:4px;font-size:.85rem;color:#9ca3af;">
          Access Key (AK)
          <input id="hw-ak" type="text" autocomplete="off" placeholder="LTAI5t..."
            style="padding:8px 12px;border-radius:6px;border:1px solid #4a5568;background:#131929;color:#e0e0e0;font-size:.9rem;" />
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:.85rem;color:#9ca3af;">
          Secret Key (SK)
          <input id="hw-sk" type="password" autocomplete="off" placeholder="••••••••"
            style="padding:8px 12px;border-radius:6px;border:1px solid #4a5568;background:#131929;color:#e0e0e0;font-size:.9rem;" />
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:.85rem;color:#9ca3af;">
          Project ID
          <input id="hw-project" type="text" autocomplete="off" placeholder="0a1b2c3d..."
            style="padding:8px 12px;border-radius:6px;border:1px solid #4a5568;background:#131929;color:#e0e0e0;font-size:.9rem;" />
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:.85rem;color:#9ca3af;">
          Region
          <input id="hw-region" type="text" autocomplete="off" value="la-south-2"
            style="padding:8px 12px;border-radius:6px;border:1px solid #4a5568;background:#131929;color:#e0e0e0;font-size:.9rem;" />
        </label>
      </div>
      <div style="display:flex;gap:12px;justify-content:flex-end;margin-top:24px;">
        <button id="hw-cancel" style="padding:8px 20px;border-radius:6px;border:1px solid #4a5568;background:transparent;color:#9ca3af;cursor:pointer;font-size:.9rem;">
          Cancelar
        </button>
        <button id="hw-save" style="padding:8px 20px;border-radius:6px;border:none;background:#1a73e8;color:#fff;cursor:pointer;font-size:.9rem;">
          Salvar e Conectar
        </button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    modal.querySelector('#hw-cancel').addEventListener('click', () => overlay.remove());

    modal.querySelector('#hw-save').addEventListener('click', () => {
      const accessKey = modal.querySelector('#hw-ak').value.trim();
      const secretKey = modal.querySelector('#hw-sk').value.trim();
      const projectId = modal.querySelector('#hw-project').value.trim();
      const region    = modal.querySelector('#hw-region').value.trim() || 'la-south-2';

      if (!accessKey || !secretKey) {
        showToast('Access Key e Secret Key são obrigatórios.', 'error');
        return;
      }

      HUAWEI_API.configure({ accessKey, secretKey, projectId, region });
      overlay.remove();
      showToast('Credenciais Huawei configuradas. Recarregando dados...', 'success');
      _loadData();
    });
  }

  // ── Legacy fallback renderers (kept for backward compatibility) ───────────
  function _renderOverviewFallback() {
    const data = DataBus.getData();
    if (!data) return;
    const s = data.summary;
    const changeAmt = (s.currentMonthCost || s.totalCurrentCost || 0) - (s.previousMonthCost || s.totalPreviousCost || 0);
    const prevCost = s.previousMonthCost || s.totalPreviousCost || 1;
    const changePct = ((changeAmt / prevCost) * 100).toFixed(1);
    const isUp = changeAmt > 0;

    const kpis = [
      { label: 'Gasto no Período', value: fmt(s.currentMonthCost || s.totalCurrentCost || 0), change: `${isUp ? '▲' : '▼'} ${Math.abs(Number(changePct))}% vs período anterior`, changeClass: isUp ? 'up' : 'down', sub: `Projeção: ${fmt(s.projectedCost || 0)}`, color: 'blue' },
      { label: 'Desperdício Identificado', value: fmt(s.totalWaste || 0), change: `${s.wastePercent || 0}% do total`, changeClass: 'up', sub: 'Recursos ociosos e superdimensionados', color: 'red' },
      { label: 'Economia Potencial', value: fmt(s.potentialSaving || 0), change: `${s.savingPercent || 0}% de redução possível`, changeClass: 'down', sub: 'Com as recomendações aplicadas', color: 'green' },
      { label: 'Projetos Ativos', value: s.activeProjects || 0, change: `${(s.activeProviders || []).join(', ').toUpperCase()}`, changeClass: 'neutral', sub: 'Monitorados neste período', color: 'purple' }
    ];

    const grid = document.getElementById('kpi-grid');
    if (grid) {
      grid.innerHTML = kpis.map((k, i) => `
        <div class="kpi-card ${k.color}" style="animation-delay:${i * 0.08}s">
          <div class="kpi-label">${k.label}</div>
          <div class="kpi-value">${k.value}</div>
          <div class="kpi-change ${k.changeClass}">${k.change}</div>
          <div class="kpi-sub">${k.sub}</div>
        </div>
      `).join('');
    }

    setTimeout(() => {
      if (typeof renderTimeline === 'function') renderTimeline('chart-timeline', data.timeline);
      if (typeof renderServicesDonut === 'function') renderServicesDonut('chart-services', data.services);
      if (typeof renderTopProjects === 'function') renderTopProjects('chart-top-projects', data.projects);
      if (typeof renderRegions === 'function') renderRegions('chart-regions', data.regions);
      if (typeof renderBudget === 'function') renderBudget('chart-budget', s.currentMonthCost || s.totalCurrentCost || 0, s.totalBudget || 0);
    }, 100);
  }

  function _renderProjectsFallback() {
    const data = DataBus.getData();
    if (!data) return;
    const grid = document.getElementById('projects-grid');
    if (!grid) return;
    const projects = [...(data.projects || [])].sort((a, b) => b.currentCost - a.currentCost);
    grid.innerHTML = projects.map((p, i) => {
      const isUp = parseFloat(p.change) > 0;
      const budget = p.budget || 1;
      const budgetPct = Math.round((p.currentCost / budget) * 100);
      const badgeClass = budgetPct > 90 ? 'badge-high' : budgetPct > 70 ? 'badge-medium' : 'badge-low';
      const badgeText = budgetPct > 90 ? 'Crítico' : budgetPct > 70 ? 'Atenção' : 'Normal';
      const barColor = budgetPct > 90 ? '#ff4d6a' : budgetPct > 70 ? '#ffb800' : '#1a73e8';
      const topServices = (p.services || []).slice(0, 3);
      return `
        <div class="project-card" style="animation-delay:${i * 0.06}s">
          <div class="project-header">
            <div>
              <div class="project-name">${p.name}</div>
              <div class="project-id">${p.id} <span class="provider-badge">${(p.provider || 'gcp').toUpperCase()}</span></div>
            </div>
            <span class="project-badge ${badgeClass}">${badgeText}</span>
          </div>
          <div class="project-cost">${fmt(p.currentCost)}</div>
          <div class="project-change ${isUp ? 'up' : 'down'}">${isUp ? '▲' : '▼'} ${Math.abs(parseFloat(p.change) || 0)}% vs período anterior</div>
          <div class="project-bar-wrap">
            <div class="project-bar-label"><span>Orçamento utilizado</span><span>${budgetPct}% de ${fmt(budget)}</span></div>
            <div class="project-bar"><div class="project-bar-fill" style="width:${Math.min(budgetPct, 100)}%;background:${barColor}"></div></div>
          </div>
          <div class="project-services">${topServices.map(s => `<span class="service-tag">${s.name}</span>`).join('')}</div>
        </div>
      `;
    }).join('');
    setTimeout(() => {
      if (typeof renderProjectsCompare === 'function') renderProjectsCompare('chart-projects-compare', projects);
    }, 100);
  }

  function _renderWasteFallback() {
    const data = DataBus.getData();
    if (!data) return;
    const s = data.summary;
    const totalWaste = (data.waste || []).reduce((sum, w) => sum + (w.totalWaste || 0), 0);
    const summaryEl = document.getElementById('waste-summary');
    if (summaryEl) {
      summaryEl.innerHTML = `
        <div class="waste-summary-card"><div class="icon">🔥</div><div class="label">Total Desperdiçado</div><div class="value red">${fmt(totalWaste)}</div></div>
        <div class="waste-summary-card"><div class="icon">📊</div><div class="label">% do Orçamento</div><div class="value yellow">${s.wastePercent || 0}%</div></div>
      `;
    }
    const grid = document.getElementById('waste-grid');
    if (grid) {
      grid.innerHTML = (data.waste || []).map((w, i) => `
        <div class="waste-card" style="animation-delay:${i * 0.08}s">
          <div class="waste-card-header">
            <div class="waste-icon ${w.color || ''}">${w.icon || '⚠️'}</div>
            <div><div class="waste-title">${w.category}</div><div class="waste-subtitle">${(w.items || []).length} recursos · ${fmt(w.totalWaste || 0)}/mês</div></div>
          </div>
        </div>
      `).join('');
    }
    setTimeout(() => {
      if (typeof renderWasteCategories === 'function') renderWasteCategories('chart-waste-categories', data.waste);
    }, 100);
  }

  function _renderRecommendationsFallback() {
    const data = DataBus.getData();
    if (!data) return;
    const list = document.getElementById('rec-list');
    if (!list) return;
    list.innerHTML = (data.recommendations || []).map((r, i) => `
      <div class="rec-card" style="animation-delay:${i * 0.06}s">
        <div class="rec-priority ${r.priority}"></div>
        <div class="rec-content">
          <div class="rec-title">${r.title}</div>
          <div class="rec-desc">${r.description || ''}</div>
        </div>
      </div>
    `).join('');
  }

  function _renderTrendsFallback() {
    const data = DataBus.getData();
    if (!data) return;
    setTimeout(() => {
      if (typeof renderForecast === 'function') renderForecast('chart-forecast', data.timeline);
      if (typeof renderMoM === 'function') renderMoM('chart-mom', data.services);
      if (typeof renderHeatmap === 'function') renderHeatmap('chart-heatmap');
    }, 100);
  }

  // ── Public helpers ────────────────────────────────────────────────────────
  function filterRec(f) {
    if (typeof RecommendationsPage !== 'undefined') RecommendationsPage.render(f);
    else _renderRecommendationsFallback();
  }

  function applyRec(id) {
    const data = DataBus.getData();
    if (!data) return;
    const rec = (data.recommendations || []).find(r => r.id === id);
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
    if (typeof val !== 'number') return String(val || 0);
    if (val >= 1e6) return `R$ ${(val / 1e6).toFixed(2)}M`;
    if (val >= 1e3) return `R$ ${(val / 1e3).toFixed(1)}K`;
    return `R$ ${val.toFixed(0)}`;
  }

  // Bootstrap
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { filterRec, applyRec, showToast, navigateTo, showHuaweiConfigModal, handleGoogleLogin, handleAuthCallback, handleLogout };
})();
