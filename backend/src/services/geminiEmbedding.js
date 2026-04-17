/**
 * Gemini Embedding API — text-embedding-004 (dimensão 768).
 * Em DEV sem GEMINI_API_KEY: retorna vetor de zeros como mock.
 * Em PROD: obtém chave via Secret Manager. Nunca loga a chave.
 * Requirements: 4.7, 7.1
 */

import { ENV } from '../config/env.js';
import { getSecret } from '../config/secrets.js';

const IS_DEV = ENV.NODE_ENV !== 'production';
const EMBEDDING_DIMENSION = 768;
const EMBEDDING_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent';

/**
 * Gera embedding vetorial de um texto usando Gemini text-embedding-004.
 * @param {string} text - Texto a ser embedado
 * @returns {Promise<number[]>} Array de 768 floats
 */
export async function generateEmbedding(text) {
  let apiKey;

  if (IS_DEV) {
    apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn(
        '[GeminiEmbedding] Modo DEV: GEMINI_API_KEY não definida. Retornando embedding mock (zeros).'
      );
      return new Array(EMBEDDING_DIMENSION).fill(0);
    }
  } else {
    apiKey = await getSecret('gemini-api-key');
  }

  const res = await fetch(`${EMBEDDING_ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'models/text-embedding-004',
      content: {
        parts: [{ text }],
      },
    }),
  });

  if (!res.ok) {
    const err = new Error(`Gemini Embedding API error: ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const values = data?.embedding?.values;

  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSION) {
    throw new Error(
      `[GeminiEmbedding] Resposta inesperada: esperado array de ${EMBEDDING_DIMENSION} floats`
    );
  }

  return values;
}
