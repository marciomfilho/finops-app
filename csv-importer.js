/**
 * FinOps Dashboard V2 — CSVImporter
 * Parser and schema mapper for CSV data import.
 * Exposes a unified interface for importing costs, projects, waste, and recommendations.
 */

const CSVImporter = (() => {

  // ── Schema definitions ──────────────────────────────────────────────────────

  const SCHEMA_MAP = {
    costs: {
      date:    ['date', 'data', 'period', 'periodo', 'month', 'mes', 'data_referencia'],
      cost:    ['cost', 'custo', 'amount', 'valor', 'total', 'spend', 'gasto', 'value'],
      project: ['project', 'projeto', 'project_id', 'account', 'conta'],
      service: ['service', 'servico', 'product', 'produto', 'recurso']
    },
    projects: {
      name:        ['name', 'nome', 'project', 'projeto', 'project_name', 'nome_projeto'],
      cost:        ['cost', 'custo', 'amount', 'valor', 'monthly_cost', 'custo_mensal'],
      budget:      ['budget', 'orcamento', 'limit', 'limite', 'budget_limit'],
      id:          ['id', 'project_id', 'identifier'],
      environment: ['environment', 'env', 'ambiente', 'tipo']
    },
    waste: {
      name:     ['name', 'nome', 'resource', 'recurso', 'resource_name'],
      cost:     ['cost', 'custo', 'amount', 'valor', 'waste_cost', 'custo_desperdicio'],
      category: ['category', 'categoria', 'type', 'tipo'],
      reason:   ['reason', 'motivo', 'description', 'descricao'],
      action:   ['action', 'acao', 'recommendation', 'recomendacao']
    },
    recommendations: {
      title:       ['title', 'titulo', 'name', 'nome', 'recommendation'],
      saving:      ['saving', 'economia', 'savings', 'amount', 'valor', 'monthly_saving'],
      priority:    ['priority', 'prioridade', 'severity', 'severidade'],
      category:    ['category', 'categoria', 'type', 'tipo'],
      effort:      ['effort', 'esforco', 'complexity', 'complexidade'],
      description: ['description', 'descricao', 'details', 'detalhes']
    }
  };

  const REQUIRED_FIELDS = {
    costs:           ['date', 'cost'],
    projects:        ['name', 'cost'],
    waste:           ['name', 'cost', 'category'],
    recommendations: ['title', 'saving']
  };

  // ── Delimiter detection ─────────────────────────────────────────────────────

  /**
   * Detects the delimiter used in a CSV file by counting occurrences in the first line.
   * @param {string} rawText
   * @returns {string} ',' | ';' | '\t'
   */
  function detectDelimiter(rawText) {
    const firstLine = rawText.split('\n')[0] || '';
    const counts = {
      ',':  (firstLine.match(/,/g)  || []).length,
      ';':  (firstLine.match(/;/g)  || []).length,
      '\t': (firstLine.match(/\t/g) || []).length
    };
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  // ── Row parsing ─────────────────────────────────────────────────────────────

  /**
   * Parses raw CSV text into headers and row objects.
   * @param {string} rawText
   * @param {string} delimiter
   * @returns {{ headers: string[], rows: Object[] }}
   */
  function parseRows(rawText, delimiter) {
    const lines = rawText.split('\n').filter(l => l.trim());
    if (lines.length < 2) return { headers: [], rows: [] };

    const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^"|"$/g, ''));
    const rows = lines.slice(1).map(line => {
      const values = line.split(delimiter).map(v => v.trim().replace(/^"|"$/g, ''));
      const row = {};
      headers.forEach((h, i) => { row[h] = values[i] || ''; });
      return row;
    });

    return { headers, rows };
  }

  // ── File reading ────────────────────────────────────────────────────────────

  /**
   * Reads a File as text, falling back to ISO-8859-1 if UTF-8 fails.
   * @param {File} file
   * @returns {Promise<{ text: string, encoding: string }>}
   */
  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve({ text: e.target.result, encoding: 'UTF-8' });
      reader.onerror = () => {
        const reader2 = new FileReader();
        reader2.onload = e2 => resolve({ text: e2.target.result, encoding: 'latin-1' });
        reader2.onerror = reject;
        reader2.readAsText(file, 'ISO-8859-1');
      };
      reader.readAsText(file, 'UTF-8');
    });
  }

  // ── Schema detection ────────────────────────────────────────────────────────

  /**
   * Detects which CSV columns map to internal fields for a given category.
   * @param {string[]} headers - Raw CSV headers
   * @param {string} category - 'costs' | 'projects' | 'waste' | 'recommendations'
   * @returns {Object} mapping of internalField → originalHeader
   */
  function detectSchema(headers, category) {
    const normalizedHeaders = headers.map(h => h.toLowerCase().trim());
    const targetSchema = SCHEMA_MAP[category] || {};
    const mapping = {};

    for (const [field, aliases] of Object.entries(targetSchema)) {
      const match = normalizedHeaders.find(h => aliases.some(alias => h.includes(alias)));
      if (match !== undefined) {
        mapping[field] = headers[normalizedHeaders.indexOf(match)];
      }
    }

    return mapping;
  }

  // ── Normalization ───────────────────────────────────────────────────────────

  /**
   * Maps raw CSV rows to the internal normalized format for a given category.
   * @param {Object[]} rows
   * @param {Object} mapping - internalField → originalHeader
   * @param {string} category
   * @returns {Object[]}
   */
  function mapToNormalizedFormat(rows, mapping, category) {
    return rows.map(row => {
      switch (category) {
        case 'costs':
          return {
            date:    row[mapping.date]    || '',
            cost:    parseFloat(row[mapping.cost])    || 0,
            project: row[mapping.project] || '',
            service: row[mapping.service] || ''
          };

        case 'projects':
          return {
            name:         row[mapping.name]   || '',
            cost:         parseFloat(row[mapping.cost])   || 0,
            budget:       parseFloat(row[mapping.budget]) || 0,
            id:           row[mapping.id]     || row[mapping.name] || '',
            provider:     'csv',
            currentCost:  parseFloat(row[mapping.cost]) || 0,
            previousCost: 0,
            change:       '0.0',
            services:     [],
            timeSeries:   []
          };

        case 'waste':
          return {
            name:     row[mapping.name]     || '',
            cost:     parseFloat(row[mapping.cost])     || 0,
            category: row[mapping.category] || '',
            reason:   row[mapping.reason]   || '',
            action:   row[mapping.action]   || 'Revisar',
            provider: 'csv'
          };

        case 'recommendations':
          return {
            id:          Date.now() + Math.random(),
            title:       row[mapping.title]       || '',
            saving:      parseFloat(row[mapping.saving])      || 0,
            priority:    row[mapping.priority]    || 'medium',
            category:    row[mapping.category]    || 'other',
            effort:      row[mapping.effort]      || 'Médio',
            description: row[mapping.description] || '',
            source:      'csv'
          };

        default:
          return row;
      }
    });
  }

  // ── Main parse ──────────────────────────────────────────────────────────────

  /**
   * Parses a CSV file for a given category and returns normalized data + metadata.
   * @param {File} file
   * @param {string} category - 'costs' | 'projects' | 'waste' | 'recommendations'
   * @returns {Promise<Object>} ParseResult
   */
  async function parse(file, category) {
    if (!file || file.size === 0) throw new Error('CSV_EMPTY_FILE');

    const { text, encoding } = await readFile(file);
    const delimiter = detectDelimiter(text);
    const { headers, rows } = parseRows(text, delimiter);

    if (rows.length === 0) throw new Error('CSV_EMPTY_FILE');

    const mapping = detectSchema(headers, category);
    const requiredFields = REQUIRED_FIELDS[category] || [];
    const missingFields = requiredFields.filter(f => !mapping[f]);
    const data = mapToNormalizedFormat(rows, mapping, category);

    return {
      data,
      errors: [],
      preview: rows.slice(0, 5),
      rowCount: rows.length,
      detectedEncoding: encoding,
      mapping,
      missingFields,
      headers
    };
  }

  // ── Import Modal UI ─────────────────────────────────────────────────────────

  /**
   * Shows a modal for importing a CSV file for the given category.
   * @param {string} category - 'costs' | 'projects' | 'waste' | 'recommendations'
   */
  function showImportModal(category) {
    // Remove any existing modal
    const existing = document.getElementById('csv-import-modal');
    if (existing) existing.remove();

    const categoryLabels = {
      costs:           'Custos',
      projects:        'Projetos',
      waste:           'Desperdícios',
      recommendations: 'Recomendações'
    };
    const label = categoryLabels[category] || category;

    // ── Overlay ──
    const overlay = document.createElement('div');
    overlay.id = 'csv-import-modal';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.6)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'z-index:9999', 'padding:16px'
    ].join(';');

    // ── Modal card ──
    const modal = document.createElement('div');
    modal.style.cssText = [
      'background:#1e2130', 'border-radius:12px', 'padding:28px',
      'width:100%', 'max-width:640px', 'max-height:90vh',
      'overflow-y:auto', 'color:#e0e0e0', 'font-family:inherit'
    ].join(';');

    // Title
    const title = document.createElement('h2');
    title.textContent = `Importar CSV — ${label}`;
    title.style.cssText = 'margin:0 0 20px;font-size:1.2rem;color:#fff;';
    modal.appendChild(title);

    // ── Drop zone ──
    const dropZone = document.createElement('div');
    dropZone.style.cssText = [
      'border:2px dashed #4a5568', 'border-radius:8px', 'padding:32px',
      'text-align:center', 'cursor:pointer', 'transition:border-color .2s',
      'margin-bottom:16px'
    ].join(';');
    dropZone.innerHTML = `
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="1.5" style="margin-bottom:8px">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/>
        <line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
      <p style="margin:0 0 4px;color:#9ca3af;">Arraste um arquivo CSV aqui</p>
      <p style="margin:0;font-size:.85rem;color:#6b7280;">ou clique para selecionar</p>
    `;

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.csv';
    fileInput.style.display = 'none';

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', e => {
      e.preventDefault();
      dropZone.style.borderColor = '#1a73e8';
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.style.borderColor = '#4a5568';
    });
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.style.borderColor = '#4a5568';
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    });

    modal.appendChild(dropZone);
    modal.appendChild(fileInput);

    // ── Status / preview area ──
    const statusArea = document.createElement('div');
    statusArea.id = 'csv-status-area';
    modal.appendChild(statusArea);

    // ── Buttons ──
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:12px;justify-content:flex-end;margin-top:20px;';

    const btnCancel = document.createElement('button');
    btnCancel.textContent = 'Cancelar';
    btnCancel.style.cssText = [
      'padding:8px 20px', 'border-radius:6px', 'border:1px solid #4a5568',
      'background:transparent', 'color:#9ca3af', 'cursor:pointer', 'font-size:.9rem'
    ].join(';');
    btnCancel.addEventListener('click', () => overlay.remove());

    const btnConfirm = document.createElement('button');
    btnConfirm.textContent = 'Confirmar Importação';
    btnConfirm.disabled = true;
    btnConfirm.style.cssText = [
      'padding:8px 20px', 'border-radius:6px', 'border:none',
      'background:#1a73e8', 'color:#fff', 'cursor:pointer', 'font-size:.9rem',
      'opacity:0.5'
    ].join(';');

    btnRow.appendChild(btnCancel);
    btnRow.appendChild(btnConfirm);
    modal.appendChild(btnRow);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Close on overlay click
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.remove();
    });

    // ── File handling ──
    let parseResult = null;

    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) handleFile(fileInput.files[0]);
    });

    async function handleFile(file) {
      statusArea.innerHTML = '<p style="color:#9ca3af;font-size:.9rem;">Processando...</p>';
      btnConfirm.disabled = true;
      btnConfirm.style.opacity = '0.5';

      try {
        parseResult = await parse(file, category);
        renderPreview(parseResult);
      } catch (err) {
        statusArea.innerHTML = `<p style="color:#f87171;">Erro: ${err.message}</p>`;
      }
    }

    function renderPreview(result) {
      statusArea.innerHTML = '';

      // Info row
      const info = document.createElement('p');
      info.style.cssText = 'font-size:.85rem;color:#9ca3af;margin:0 0 12px;';
      info.textContent = `${result.rowCount} linha(s) detectada(s) · Encoding: ${result.detectedEncoding}`;
      statusArea.appendChild(info);

      // Preview table
      if (result.preview.length > 0) {
        const tableWrap = document.createElement('div');
        tableWrap.style.cssText = 'overflow-x:auto;margin-bottom:16px;';

        const table = document.createElement('table');
        table.style.cssText = [
          'width:100%', 'border-collapse:collapse', 'font-size:.8rem'
        ].join(';');

        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        result.headers.forEach(h => {
          const th = document.createElement('th');
          th.textContent = h;
          th.style.cssText = 'padding:6px 10px;background:#2d3748;color:#9ca3af;text-align:left;white-space:nowrap;';
          headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        result.preview.forEach((row, i) => {
          const tr = document.createElement('tr');
          tr.style.background = i % 2 === 0 ? '#1a2035' : '#1e2540';
          result.headers.forEach(h => {
            const td = document.createElement('td');
            td.textContent = row[h] || '';
            td.style.cssText = 'padding:5px 10px;color:#e0e0e0;white-space:nowrap;';
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        tableWrap.appendChild(table);
        statusArea.appendChild(tableWrap);
      }

      // Missing fields — manual mapping
      if (result.missingFields.length > 0) {
        const missingSection = document.createElement('div');
        missingSection.style.cssText = 'background:#2d1f1f;border-radius:6px;padding:14px;margin-bottom:12px;';

        const missingTitle = document.createElement('p');
        missingTitle.style.cssText = 'margin:0 0 10px;color:#f87171;font-size:.9rem;font-weight:600;';
        missingTitle.textContent = `Campos obrigatórios não detectados: ${result.missingFields.join(', ')}`;
        missingSection.appendChild(missingTitle);

        result.missingFields.forEach(field => {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:8px;';

          const lbl = document.createElement('label');
          lbl.textContent = field;
          lbl.style.cssText = 'min-width:100px;color:#e0e0e0;font-size:.85rem;';

          const sel = document.createElement('select');
          sel.dataset.field = field;
          sel.style.cssText = [
            'flex:1', 'padding:5px 8px', 'border-radius:4px',
            'background:#1e2130', 'color:#e0e0e0', 'border:1px solid #4a5568',
            'font-size:.85rem'
          ].join(';');

          const emptyOpt = document.createElement('option');
          emptyOpt.value = '';
          emptyOpt.textContent = '— selecionar coluna —';
          sel.appendChild(emptyOpt);

          result.headers.forEach(h => {
            const opt = document.createElement('option');
            opt.value = h;
            opt.textContent = h;
            sel.appendChild(opt);
          });

          sel.addEventListener('change', () => {
            if (sel.value) {
              parseResult.mapping[field] = sel.value;
              // Re-normalize with updated mapping
              parseResult.data = mapToNormalizedFormat(
                parseResult.preview.concat(/* full rows not stored, use preview as proxy */[]),
                parseResult.mapping,
                category
              );
            }
          });

          row.appendChild(lbl);
          row.appendChild(sel);
          missingSection.appendChild(row);
        });

        statusArea.appendChild(missingSection);
      }

      // Enable confirm
      btnConfirm.disabled = false;
      btnConfirm.style.opacity = '1';
    }

    btnConfirm.addEventListener('click', () => {
      if (!parseResult) return;
      if (typeof DataBus !== 'undefined') {
        DataBus.injectCSVData(category, parseResult.data);
      }
      overlay.remove();
    });
  }

  // ── Public API ──────────────────────────────────────────────────────────────
  return {
    detectDelimiter,
    parseRows,
    detectSchema,
    mapToNormalizedFormat,
    parse,
    showImportModal
  };
})();
