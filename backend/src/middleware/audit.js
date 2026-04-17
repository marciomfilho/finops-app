/**
 * Middleware de auditoria append-only.
 * Registra cada requisição autenticada no audit_log de forma assíncrona.
 * Requirements: 2.7, 10.1, 10.5
 */

import { getSupabaseServiceClient } from '../services/supabase.js';

const SENSITIVE_FIELDS = ['password', 'token', 'secret', 'key', 'authorization', 'ak', 'sk'];

/**
 * Substitui campos sensíveis por '[REDACTED]'.
 * @param {Record<string, unknown>} params
 * @returns {Record<string, unknown>}
 */
export function sanitizeParams(params) {
  const result = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (SENSITIVE_FIELDS.some((s) => k.toLowerCase().includes(s))) {
      result[k] = '[REDACTED]';
    } else {
      result[k] = v;
    }
  }
  return result;
}

/**
 * Registra a requisição no audit_log de forma assíncrona (não bloqueia a resposta).
 * Loga apenas erros de inserção — nunca os valores dos parâmetros.
 */
export function auditMiddleware(req, res, next) {
  const safeParams = sanitizeParams({ ...req.query, ...req.body });

  const entry = {
    user_email: req.user?.email,
    action: `${req.method} ${req.path}`,
    payload: safeParams,
    ip_address: req.headers['x-forwarded-for'] || req.ip,
    created_at: new Date().toISOString(),
  };

  // Inserção assíncrona — não bloqueia a resposta
  getSupabaseServiceClient()
    .then((supabase) =>
      supabase.from('audit_log').insert(entry).then(({ error }) => {
        if (error) console.error('[Audit] Falha ao registrar:', error.message);
      })
    )
    .catch((err) => {
      console.error('[Audit] Falha ao obter cliente:', err.message);
    });

  next();
}
