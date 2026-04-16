/**
 * FinOps Dashboard V2 — Projects Page
 * Renders project cards for all providers using UnifiedData from DataBus.
 * Requirements: 3.1
 */

const ProjectsPage = (() => {

  // ── Provider config ──────────────────────────────────────────────────────────

  const PROVIDER_LABELS = { gcp: 'GCP', huawei: 'Huawei', csv: 'CSV', demo: 'Demo' };
  const PROVIDER_COLORS = { gcp: '#1a73e8', huawei: '#e8341a', csv: '#00c48c', demo: '#a855f7' };

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function fmt(val) {
    if (typeof val !== 'number') return val;
    if (val >= 1e6) return `R$ ${(val / 1e6).toFixed(2)}M`;
    if (val >= 1e3) return `R$ ${(val / 1e3).toFixed(1)}K`;
    return `R$ ${val.toFixed(0)}`;
  }

  function getProviderLabel(provider) {
    return PROVIDER_LABELS[provider] || (provider ? provider.toUpperCase() : '—');
  }

  function getProviderColor(provider) {
    return PROVIDER_COLORS[provider] || '#8892a4';
  }

  /**
   * Builds the provider badge HTML for a project card.
   * @param {string} provider
   * @returns {string} HTML string
   */
  function buildProviderBadge(provider) {
    const label = getProviderLabel(provider);
    const color = getProviderColor(provider);
    return `<span class="provider-badge" style="background:${color}22;color:${color};border:1px solid ${color}55">${label}</span>`;
  }

  /**
   * Builds the provider filter buttons HTML.
   * @param {string[]} providers - unique provider ids present in data
   * @param {string} activeFilter - currently active provider filter ('all' or provider id)
   * @returns {string} HTML string
   */
  function buildProviderFilters(providers, activeFilter) {
    const allBtn = `<button class="rec-filter-btn ${activeFilter === 'all' ? 'active' : ''}" data-provider="all">Todos</button>`;
    const providerBtns = providers.map(pid => {
      const label = getProviderLabel(pid);
      const isActive = activeFilter === pid;
      return `<button class="rec-filter-btn ${isActive ? 'active' : ''}" data-provider="${pid}">${label}</button>`;
    }).join('');
    return allBtn + providerBtns;
  }

  /**
   * Renders a single project card.
   * @param {Object} p - NormalizedProject
   * @param {number} index - card index for animation delay
   * @param {number} maxCost - max cost across all visible projects
   * @returns {string} HTML string
   */
  function buildProjectCard(p, index, maxCost) {
    const isUp = parseFloat(p.change) > 0;
    const budget = p.budget || 0;
    const budgetPct = budget > 0 ? Math.round((p.currentCost / budget) * 100) : 0;
    let badgeClass, badgeText, barColor;
    if (budgetPct > 90) { badgeClass = 'badge-high'; badgeText = 'Crítico'; barColor = '#ff4d6a'; }
    else if (budgetPct > 70) { badgeClass = 'badge-medium'; badgeText = 'Atenção'; barColor = '#ffb800'; }
    else { badgeClass = 'badge-low'; badgeText = 'Normal'; barColor = '#1a73e8'; }
    const topServices = (p.services || []).slice(0, 3);

    return `
      <div class="project-card" style="animation-delay:${index * 0.06}s">
        <div class="project-header">
          <div>
            <div class="project-name">${p.name}</div>
            <div class="project-id">${p.id}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
            <span class="project-badge ${badgeClass}">${badgeText}</span>
            ${buildProviderBadge(p.provider)}
          </div>
        </div>
        <div class="project-cost">${fmt(p.currentCost)}</div>
        <div class="project-change ${isUp ? 'up' : 'down'}">${isUp ? '▲' : '▼'} ${Math.abs(parseFloat(p.change) || 0)}% vs período anterior</div>
        ${budget > 0 ? `
        <div class="project-bar-wrap">
          <div class="project-bar-label">
            <span>Orçamento utilizado</span>
            <span>${budgetPct}% de ${fmt(budget)}</span>
          </div>
          <div class="project-bar">
            <div class="project-bar-fill" style="width:${Math.min(budgetPct, 100)}%; background:${barColor}"></div>
          </div>
        </div>` : ''}
        <div class="project-services">
          ${topServices.map(s => `<span class="service-tag">${s.name || s}</span>`).join('')}
        </div>
      </div>
    `;
  }

  // ── State ────────────────────────────────────────────────────────────────────

  let _providerFilter = 'all';
  let _filtersBound = false;

  // ── Main render ──────────────────────────────────────────────────────────────

  /**
   * Renders the projects page using UnifiedData from DataBus.
   * @param {string} [searchText=''] - current search filter text
   */
  function render(searchText = '') {
    const unified = DataBus.getData();
    if (!unified) return;

    let projects = [...(unified.projects || [])];

    // Collect unique providers for filter buttons
    const uniqueProviders = [...new Set(projects.map(p => p.provider).filter(Boolean))];

    // Apply provider filter
    if (_providerFilter !== 'all') {
      projects = projects.filter(p => p.provider === _providerFilter);
    }

    // Apply search filter
    const search = searchText.trim().toLowerCase();
    if (search) {
      projects = projects.filter(p =>
        (p.name || '').toLowerCase().includes(search) ||
        (p.id || '').toLowerCase().includes(search)
      );
    }

    // Apply sort
    const sort = document.getElementById('project-sort')?.value || 'cost-desc';
    if (sort === 'cost-desc') projects.sort((a, b) => b.currentCost - a.currentCost);
    else if (sort === 'cost-asc') projects.sort((a, b) => a.currentCost - b.currentCost);
    else if (sort === 'growth-desc') projects.sort((a, b) => parseFloat(b.change) - parseFloat(a.change));
    else projects.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    const maxCost = projects.length > 0 ? Math.max(...projects.map(p => p.currentCost)) : 1;

    // Render provider filter buttons
    const filtersContainer = document.getElementById('project-provider-filters');
    if (filtersContainer) {
      filtersContainer.innerHTML = buildProviderFilters(uniqueProviders, _providerFilter);
      _bindFilterButtons(filtersContainer);
    }

    // Render project cards
    const grid = document.getElementById('projects-grid');
    if (grid) {
      if (projects.length === 0) {
        grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--text3);padding:40px">Nenhum projeto encontrado.</div>`;
      } else {
        grid.innerHTML = projects.map((p, i) => buildProjectCard(p, i, maxCost)).join('');
      }
    }

    // Bind search & sort (once)
    _bindSearchSort(searchText);

    // Render comparison chart
    setTimeout(() => {
      if (typeof renderProjectsCompare === 'function') {
        renderProjectsCompare('chart-projects-compare', projects);
      }
    }, 100);
  }

  /**
   * Binds provider filter button click events.
   * @param {HTMLElement} container
   */
  function _bindFilterButtons(container) {
    if (_filtersBound) return;
    _filtersBound = true;
    container.addEventListener('click', e => {
      const btn = e.target.closest('[data-provider]');
      if (!btn) return;
      _providerFilter = btn.dataset.provider;
      _filtersBound = false; // allow re-bind after re-render
      const searchInput = document.getElementById('project-search');
      render(searchInput?.value || '');
    });
  }

  /**
   * Binds search input and sort select events (idempotent via _bound flag).
   * @param {string} currentSearch
   */
  function _bindSearchSort(currentSearch) {
    const searchInput = document.getElementById('project-search');
    const sortSelect = document.getElementById('project-sort');

    if (searchInput && !searchInput._projectsBound) {
      searchInput._projectsBound = true;
      searchInput.addEventListener('input', e => render(e.target.value));
    }
    if (sortSelect && !sortSelect._projectsBound) {
      sortSelect._projectsBound = true;
      sortSelect.addEventListener('change', () => {
        const searchInput = document.getElementById('project-search');
        render(searchInput?.value || '');
      });
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────────
  return { render };
})();
