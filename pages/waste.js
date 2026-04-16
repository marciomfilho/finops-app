/**
 * FinOps Dashboard V2 — Waste Page
 * Exibe dados de waste agregados de todos os providers via DataBus.
 * Requirements: 3.1
 */

const WastePage = (() => {

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function fmt(val) {
    if (typeof val !== 'number') return val;
    if (val >= 1e6) return `R$ ${(val / 1e6).toFixed(2)}M`;
    if (val >= 1e3) return `R$ ${(val / 1e3).toFixed(1)}K`;
    return `R$ ${val.toFixed(0)}`;
  }

  // ── Main render ──────────────────────────────────────────────────────────────

  /**
   * Renders the waste page using UnifiedData from DataBus.
   * Reads waste[] aggregated from all providers.
   */
  function render() {
    const unified = DataBus.getData();
    if (!unified) return;

    const waste = unified.waste || [];
    const summary = unified.summary || {};

    const totalWaste = waste.reduce((sum, w) => sum + (w.totalWaste || 0), 0);
    const categories = waste.length;
    const items = waste.reduce((sum, w) => sum + (w.items ? w.items.length : 0), 0);

    // ── Summary cards ──────────────────────────────────────────────────────────
    const summaryEl = document.getElementById('waste-summary');
    if (summaryEl) {
      summaryEl.innerHTML = `
        <div class="waste-summary-card" style="animation-delay:0s">
          <div class="icon">🔥</div>
          <div class="label">Total Desperdiçado</div>
          <div class="value red">${fmt(totalWaste)}</div>
        </div>
        <div class="waste-summary-card" style="animation-delay:0.1s">
          <div class="icon">📊</div>
          <div class="label">% do Orçamento</div>
          <div class="value yellow">${summary.wastePercent || '0.0'}%</div>
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
    }

    // ── Waste cards ────────────────────────────────────────────────────────────
    const gridEl = document.getElementById('waste-grid');
    if (gridEl) {
      if (waste.length === 0) {
        gridEl.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--text3);padding:40px">Nenhum desperdício identificado.</div>`;
      } else {
        gridEl.innerHTML = waste.map((w, i) => _buildWasteCard(w, i)).join('');
      }
    }

    // ── Chart ──────────────────────────────────────────────────────────────────
    setTimeout(() => {
      if (typeof renderWasteCategories === 'function') {
        renderWasteCategories('chart-waste-categories', waste);
      }
    }, 100);
  }

  /**
   * Builds HTML for a single waste category card.
   * @param {Object} w - WasteCategory
   * @param {number} index - animation delay index
   * @returns {string} HTML string
   */
  function _buildWasteCard(w, index) {
    const items = w.items || [];
    const itemsHtml = items.map(item => `
      <div class="waste-item">
        <div class="waste-item-name" title="${_esc(item.reason || '')}">${_esc(item.name || '')}</div>
        <div class="waste-item-cost">${fmt(item.cost || 0)}</div>
        <button class="waste-item-action" onclick="WastePage.handleAction('${_esc(item.action || 'Ver')}', '${_esc(item.name || '')}')">
          ${_esc(item.action || 'Ver')}
        </button>
      </div>
    `).join('');

    return `
      <div class="waste-card" style="animation-delay:${index * 0.08}s">
        <div class="waste-card-header">
          <div class="waste-icon ${w.color || 'red'}">${w.icon || '⚠️'}</div>
          <div>
            <div class="waste-title">${_esc(w.category || '')}</div>
            <div class="waste-subtitle">${items.length} recursos · ${fmt(w.totalWaste || 0)}/mês</div>
          </div>
        </div>
        <div class="waste-items">${itemsHtml}</div>
      </div>
    `;
  }

  /**
   * Escapes a string for safe use in HTML attributes and text.
   * @param {string} str
   * @returns {string}
   */
  function _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── Public helpers ────────────────────────────────────────────────────────────

  /**
   * Handles waste item action button click.
   * @param {string} action
   * @param {string} name
   */
  function handleAction(action, name) {
    if (typeof App !== 'undefined' && App.showToast) {
      App.showToast(`Ação: ${action} — ${name}`, 'info');
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  return { render, handleAction };
})();
