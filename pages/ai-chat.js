/**
 * FinOps Dashboard V2 — AIChatPage
 * Widget de chat interativo com o agente FinOps via Gemini.
 * Exposto como IIFE: const AIChatPage = (() => { ... })()
 */

const AIChatPage = (() => {
  // ── State ───────────────────────────────────────────────────────────────────
  let chatHistory = [];
  let isStreaming = false;

  // ── Render ──────────────────────────────────────────────────────────────────

  /**
   * Renderiza a página de chat no #page-ai-chat.
   */
  function render() {
    const container = document.getElementById('page-ai-chat');
    if (!container) return;

    const disabled = (typeof AIAgent !== 'undefined') && AIAgent.isDisabled();

    container.innerHTML = `
      <div class="ai-chat-container">
        <div class="ai-chat-header">
          <div class="ai-chat-title">
            <span class="ai-icon">🤖</span>
            <div>
              <h3>Assistente FinOps</h3>
              <span class="ai-status">Powered by Gemini</span>
            </div>
          </div>
          <button id="btn-clear-chat" class="btn-secondary">Limpar</button>
        </div>

        <div class="ai-disabled-banner" id="ai-disabled-banner" style="display:${disabled ? 'block' : 'none'}">
          <p>Configure sua Gemini API Key em <code>config.js</code> para usar o assistente de IA.</p>
          <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">Obter API Key →</a>
        </div>

        <div class="ai-insights" id="ai-insights"></div>

        <div class="ai-messages" id="ai-messages"></div>

        <div class="ai-input-row">
          <input
            type="text"
            id="ai-input"
            placeholder="Pergunte sobre seus custos cloud..."
            ${disabled ? 'disabled' : ''}
          />
          <button id="btn-ai-send" ${disabled ? 'disabled' : ''}>Enviar</button>
        </div>

        <div class="ai-suggestions">
          <button onclick="AIChatPage.sendSuggestion('Quais são os maiores desperdícios?')">Maiores desperdícios</button>
          <button onclick="AIChatPage.sendSuggestion('Como reduzir custos em 20%?')">Reduzir 20%</button>
          <button onclick="AIChatPage.sendSuggestion('Compare GCP vs Huawei')">GCP vs Huawei</button>
          <button onclick="AIChatPage.sendSuggestion('Previsão para próximo mês')">Previsão</button>
        </div>
      </div>
    `;

    _bindEvents();
    _restoreHistory();
  }

  // ── Event binding ───────────────────────────────────────────────────────────

  function _bindEvents() {
    const sendBtn = document.getElementById('btn-ai-send');
    const input = document.getElementById('ai-input');
    const clearBtn = document.getElementById('btn-clear-chat');

    if (sendBtn) {
      sendBtn.addEventListener('click', () => {
        const text = input ? input.value.trim() : '';
        if (text) sendMessage(text);
      });
    }

    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          const text = input.value.trim();
          if (text) sendMessage(text);
        }
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', clearChat);
    }
  }

  // ── Restore history ─────────────────────────────────────────────────────────

  function _restoreHistory() {
    if (chatHistory.length === 0) return;
    const messagesEl = document.getElementById('ai-messages');
    if (!messagesEl) return;

    chatHistory.forEach(msg => {
      const el = _createMessageElement(msg.role, msg.content, false);
      messagesEl.appendChild(el);
    });
    _scrollToBottom();
  }

  // ── Message element ─────────────────────────────────────────────────────────

  /**
   * Cria um elemento de mensagem no DOM.
   * @param {'user'|'model'} role
   * @param {string} content
   * @param {boolean} isStreaming - se true, exibe indicador "..."
   * @returns {HTMLElement}
   */
  function _createMessageElement(role, content, streaming) {
    const wrapper = document.createElement('div');
    wrapper.className = `ai-message ai-message--${role}`;

    const bubble = document.createElement('div');
    bubble.className = 'ai-message-bubble';

    if (streaming) {
      bubble.textContent = '...';
      bubble.classList.add('ai-message--typing');
    } else if (role === 'user') {
      bubble.textContent = content;
    } else {
      bubble.innerHTML = _renderMarkdown(content);
    }

    wrapper.appendChild(bubble);
    return wrapper;
  }

  // ── Markdown rendering ──────────────────────────────────────────────────────

  /**
   * Renderiza markdown com marked (se disponível) e sanitiza com DOMPurify (se disponível).
   * @param {string} text
   * @returns {string} HTML seguro
   */
  function _renderMarkdown(text) {
    let html = text;

    if (typeof marked !== 'undefined') {
      try {
        html = marked.parse(text);
      } catch (parseErr) {
        console.warn('[AIChatPage] marked parse error:', parseErr);
        html = text;
      }
    }

    if (typeof DOMPurify !== 'undefined') {
      html = DOMPurify.sanitize(html);
    }

    return html;
  }

  // ── Scroll ──────────────────────────────────────────────────────────────────

  function _scrollToBottom() {
    const messagesEl = document.getElementById('ai-messages');
    if (messagesEl) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  // ── sendMessage ─────────────────────────────────────────────────────────────

  /**
   * Envia uma mensagem ao agente e exibe a resposta com streaming.
   * @param {string} text
   */
  async function sendMessage(text) {
    if (!text || isStreaming) return;

    const input = document.getElementById('ai-input');
    const messagesEl = document.getElementById('ai-messages');
    if (!messagesEl) return;

    // Limpar input
    if (input) input.value = '';

    // Adicionar mensagem do usuário ao DOM
    const userEl = _createMessageElement('user', text, false);
    messagesEl.appendChild(userEl);
    _scrollToBottom();

    // Adicionar ao histórico
    chatHistory.push({ role: 'user', content: text, timestamp: new Date() });

    // Criar elemento de resposta com indicador de digitando
    const responseWrapper = document.createElement('div');
    responseWrapper.className = 'ai-message ai-message--model';
    const responseBubble = document.createElement('div');
    responseBubble.className = 'ai-message-bubble ai-message--typing';
    responseBubble.textContent = '...';
    responseWrapper.appendChild(responseBubble);
    messagesEl.appendChild(responseWrapper);
    _scrollToBottom();

    isStreaming = true;
    _setInputDisabled(true);

    let buffer = '';

    try {
      await AIAgent.chat(text, chatHistory, (chunk) => {
        buffer += chunk;
        responseBubble.classList.remove('ai-message--typing');
        responseBubble.textContent = buffer;
        _scrollToBottom();
      });

      // Finalizar: renderizar markdown sanitizado
      responseBubble.innerHTML = _renderMarkdown(buffer);
      _scrollToBottom();

      // Adicionar ao histórico
      chatHistory.push({ role: 'model', content: buffer, timestamp: new Date() });

    } catch (err) {
      _handleChatError(err, responseBubble);
    } finally {
      isStreaming = false;
      _setInputDisabled(false);
      if (input) input.focus();
    }
  }

  // ── Error handling ──────────────────────────────────────────────────────────

  function _handleChatError(err, bubbleEl) {
    const msg = err && err.message ? err.message : String(err);

    if (msg === 'GEMINI_NO_KEY') {
      const banner = document.getElementById('ai-disabled-banner');
      if (banner) banner.style.display = 'block';
      if (bubbleEl) {
        bubbleEl.classList.remove('ai-message--typing');
        bubbleEl.textContent = '⚠️ Configure sua API Key para usar o assistente.';
        bubbleEl.classList.add('ai-message--error');
      }
    } else if (msg === 'GEMINI_QUOTA_EXCEEDED') {
      _showToast('Limite de requisições atingido. Aguarde 60 segundos.');
      if (bubbleEl) {
        bubbleEl.classList.remove('ai-message--typing');
        bubbleEl.textContent = '⏳ Limite de requisições atingido. Tente novamente em 60 segundos.';
        bubbleEl.classList.add('ai-message--error');
      }
    } else {
      if (bubbleEl) {
        bubbleEl.classList.remove('ai-message--typing');
        bubbleEl.textContent = `❌ Erro ao processar resposta: ${msg}`;
        bubbleEl.classList.add('ai-message--error');
      }
    }
  }

  // ── Toast ───────────────────────────────────────────────────────────────────

  function _showToast(message) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast toast--warning';
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast--fade');
      setTimeout(() => toast.remove(), 400);
    }, 4000);
  }

  // ── Input state ─────────────────────────────────────────────────────────────

  function _setInputDisabled(disabled) {
    const input = document.getElementById('ai-input');
    const btn = document.getElementById('btn-ai-send');
    if (input) input.disabled = disabled;
    if (btn) btn.disabled = disabled;
  }

  // ── clearChat ───────────────────────────────────────────────────────────────

  function clearChat() {
    chatHistory = [];
    const messagesEl = document.getElementById('ai-messages');
    if (messagesEl) messagesEl.innerHTML = '';
    const insightsEl = document.getElementById('ai-insights');
    if (insightsEl) insightsEl.innerHTML = '';
  }

  // ── renderInsights ──────────────────────────────────────────────────────────

  /**
   * Exibe os insights do autoAnalyze como cards coloridos por severidade.
   * @param {Array} insights - Array de AIInsight
   */
  function renderInsights(insights) {
    const container = document.getElementById('ai-insights');
    if (!container || !insights || insights.length === 0) return;

    const severityEmoji = { high: '🔴', medium: '🟠', low: '🟡', critical: '🔴' };
    const severityLabel = { high: 'Alto', medium: 'Médio', low: 'Baixo', critical: 'Crítico' };

    container.innerHTML = `
      <div class="ai-insights-header">
        <span>💡 Insights Automáticos</span>
      </div>
      <div class="ai-insights-list">
        ${insights.map(insight => `
          <div class="ai-insight-card ai-insight-card--${insight.severity || 'low'}">
            <span class="ai-insight-emoji">${severityEmoji[insight.severity] || '🟡'}</span>
            <span class="ai-insight-text">${_escapeHtml(insight.text || insight.description || '')}</span>
            <span class="ai-insight-badge ai-insight-badge--${insight.severity || 'low'}">
              ${severityLabel[insight.severity] || 'Info'}
            </span>
          </div>
        `).join('')}
      </div>
    `;
  }

  // ── sendSuggestion ──────────────────────────────────────────────────────────

  /**
   * Envia uma sugestão rápida como mensagem do usuário.
   * @param {string} text
   */
  function sendSuggestion(text) {
    const input = document.getElementById('ai-input');
    if (input) input.value = text;
    sendMessage(text);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Public API ──────────────────────────────────────────────────────────────
  return {
    render,
    sendMessage,
    sendSuggestion,
    renderInsights,
    clearChat
  };
})();
