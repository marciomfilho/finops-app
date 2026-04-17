/**
 * Middleware de autenticação JWT + domínio corporativo.
 * Stateless: valida o token via Supabase sem armazenar sessão no servidor.
 * Requirements: 1.2, 1.3, 1.5, 6.4, 6.5
 */

import { createClient } from '@supabase/supabase-js';
import { ENV } from '../config/env.js';

const supabase = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY);

/**
 * Extrai o Bearer token do header Authorization,
 * valida via Supabase e verifica o domínio corporativo.
 */
export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticação ausente' });
  }

  const token = authHeader.slice(7);

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }

  const domain = user.email?.split('@')[1];
  if (domain !== ENV.CORPORATE_DOMAIN) {
    return res.status(403).json({ error: 'Acesso restrito ao domínio corporativo' });
  }

  req.user = user;
  req.token = token;
  next();
}
