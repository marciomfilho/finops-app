/**
 * Pipeline RAG completo: embed → busca vetorial → contexto → Gemini.
 * NUNCA inclui credenciais no payload enviado ao Gemini.
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.7
 */

import { generateEmbedding } from './geminiEmbedding.js';
import { searchFinancialContext } from './supabase.js';
import { getSecret } from '../config/secrets.js';
import { ENV } from '../config/env.js';

const GEMINI_GENERATE_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

/**
 * Executa o pipeline RAG completo.
 * @param {string} message - Mensagem do usuário
 * @param {Array} history - Histórico de conversa [{ role, content }]
 * @returns {Promise<{ text: string, insights: Array, chunksUsed: number, hasContext: boolean }>}
 */
export async function runRAGPipeline(message, history = []) {
  // 1. Gera embedding da mensagem
  const embedding = await generateEmbedding(message);

  // 2. Busca vetorial no Supabase
  const chunks = await searchFinancialContext(
    embedding,
    ENV.RAG_MAX_CHUNKS,
    ENV.RAG_SIMILARITY_THRESHOLD
  );

  // 3. Monta contexto compacto
  const hasContext = chunks.length > 0;
  const context = hasContext ? buildContext(chunks, ENV.RAG_MAX_TOKENS) : null;

  // 4. Obtém chave Gemini (nunca incluída no payload)
  const apiKey = await getSecret('gemini-api-key');

  // 5. Chama Gemini
  const response = await callGemini(message, context, history, apiKey);

  return {
    text: response.text,
    insights: response.insights,
    chunksUsed: chunks.length,
    hasContext,
  };
}

/**
 * Monta contexto compacto a partir dos chunks, respeitando o limite de tokens.
 * Chunks já chegam ordenados por similaridade DESC do Supabase.
 * @param {Array} chunks - Chunks retornados pela busca vetorial
 * @param {number} maxTokens - Limite de tokens
 * @returns {string}
 */
export function buildContext(chunks, maxTokens) {
  const maxChars = maxTokens * 4;
  let context = 'DADOS FINANCEIROS RELEVANTES:\n\n';

  for (const chunk of chunks) {
    const chunkText = `[${chunk.record_type}] ${chunk.content}\n`;
    if (context.length + chunkText.length > maxChars) break;
    context += chunkText;
  }

  return context;
}

/**
 * Chama a Gemini API com contexto RAG.
 * IMPORTANTE: nunca inclui credenciais no payload.
 * @param {string} message
 * @param {string|null} context
 * @param {Array} history
 * @param {string} apiKey
 * @returns {Promise<{ text: string, insights: Array }>}
 */
export async function callGemini(message, context, history, apiKey) {
  const systemPrompt = context
    ? `Você é um especialista em FinOps. Responda em português brasileiro baseando-se nos dados abaixo.\n\n${context}`
    : `Você é um especialista em FinOps. Responda em português brasileiro. IMPORTANTE: há dados insuficientes para responder com precisão — informe isso ao usuário.`;

  const contents = [
    { role: 'user', parts: [{ text: systemPrompt }] },
    { role: 'model', parts: [{ text: 'Entendido. Pronto para analisar os dados financeiros.' }] },
    ...history.slice(-6).map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }],
    })),
    { role: 'user', parts: [{ text: message }] },
  ];

  const res = await fetch(`${GEMINI_GENERATE_ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
    }),
  });

  if (!res.ok) {
    const err = new Error(`Gemini API error: ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  return { text, insights: parseInsights(text) };
}

/**
 * Extrai insights estruturados do texto de resposta do Gemini.
 * @param {string} text
 * @returns {Array}
 */
function parseInsights(text) {
  return text
    .split('\n')
    .filter((l) => l.trim() && (l.includes('•') || /^[🔴🟠🟡🟢💰⚠️]/u.test(l)))
    .slice(0, 5)
    .map((line, i) => ({ id: i + 1, text: line.trim(), severity: i === 0 ? 'high' : 'medium' }));
}
