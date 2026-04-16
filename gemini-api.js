/**
 * FinOps Dashboard V2 — GeminiClient
 * Cliente para a Google Gemini API (REST).
 * Exposto como IIFE: const GeminiClient = (() => { ... })()
 */

const GeminiClient = (() => {
  const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';
  const STREAM_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:streamGenerateContent';

  // ── Throttle state ──────────────────────────────────────────────────────────
  let _throttledUntil = 0;

  function _setThrottled(ms) {
    _throttledUntil = Date.now() + ms;
  }

  function isThrottled() {
    return Date.now() < _throttledUntil;
  }

  function hasApiKey() {
    return !!(window.GEMINI_API_KEY && window.GEMINI_API_KEY.length > 0);
  }

  // ── generate ────────────────────────────────────────────────────────────────

  /**
   * Gera conteúdo via Gemini API (não-streaming).
   * @param {string|Array} promptOrContents - Prompt string ou array de contents
   * @param {Object} options - Opções de geração (temperature, maxOutputTokens, topP)
   * @returns {Promise<string>} Texto gerado
   */
  async function generate(promptOrContents, options = {}) {
    const apiKey = window.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_NO_KEY');

    const body = {
      contents: Array.isArray(promptOrContents)
        ? promptOrContents
        : [{ role: 'user', parts: [{ text: promptOrContents }] }],
      generationConfig: {
        temperature: options.temperature ?? 0.4,
        maxOutputTokens: options.maxOutputTokens ?? 1024,
        topP: options.topP ?? 0.8
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' }
      ]
    };

    const res = await fetch(`${BASE_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (res.status === 429) {
      _setThrottled(60000);
      throw new Error('GEMINI_QUOTA_EXCEEDED');
    }
    if (!res.ok) throw new Error(`GEMINI_HTTP_${res.status}`);

    const data = await res.json();

    // Check for safety block
    if (data.candidates?.[0]?.finishReason === 'SAFETY') {
      throw new Error('GEMINI_SAFETY_BLOCK');
    }

    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  // ── generateStream ──────────────────────────────────────────────────────────

  /**
   * Gera conteúdo via Gemini API com streaming (SSE).
   * @param {string|Array} contentsOrPrompt - Prompt string ou array de contents
   * @param {Function} onChunk - Callback chamado a cada fragmento de texto recebido
   * @param {Object} options - Opções de geração
   * @returns {Promise<void>}
   */
  async function generateStream(contentsOrPrompt, onChunk, options = {}) {
    const apiKey = window.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_NO_KEY');

    const body = {
      contents: Array.isArray(contentsOrPrompt)
        ? contentsOrPrompt
        : [{ role: 'user', parts: [{ text: contentsOrPrompt }] }],
      generationConfig: {
        temperature: options.temperature ?? 0.4,
        maxOutputTokens: options.maxOutputTokens ?? 1024
      }
    };

    const res = await fetch(`${STREAM_URL}?key=${apiKey}&alt=sse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) throw new Error(`GEMINI_STREAM_ERROR_${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const json = JSON.parse(line.slice(6));
            const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) onChunk(text);
          } catch (_) {}
        }
      }
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────
  return {
    generate,
    generateStream,
    isThrottled,
    hasApiKey
  };
})();
