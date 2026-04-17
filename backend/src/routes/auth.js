/**
 * Rotas de autenticação via Google OAuth2.
 * Requirements: 1.1, 1.2, 1.3, 1.4, 9.2, 9.3
 */

import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { ENV } from '../config/env.js';
import { getSecret } from '../config/secrets.js';

const router = Router();

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

/**
 * GET /auth/google
 * Redireciona para o fluxo OAuth2 do Google com escopos profile e email.
 */
router.get('/google', (req, res) => {
  const params = new URLSearchParams({
    client_id: ENV.GOOGLE_CLIENT_ID,
    redirect_uri: ENV.GOOGLE_REDIRECT_URI,
    scope: 'openid profile email',
    response_type: 'code',
    access_type: 'offline',
    prompt: 'select_account',
  });

  res.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
});

/**
 * GET /auth/callback
 * Callback OAuth2 — troca code por tokens, valida domínio, cria sessão Supabase.
 */
router.get('/callback', async (req, res) => {
  const { code, error: oauthError } = req.query;

  if (oauthError) {
    return res.redirect(
      `${ENV.FRONTEND_URL}?error=${encodeURIComponent('Autenticação cancelada')}`
    );
  }

  if (!code) {
    return res.redirect(
      `${ENV.FRONTEND_URL}?error=${encodeURIComponent('Código de autorização ausente')}`
    );
  }

  try {
    const clientSecret = await getSecret('google-client-secret');

    // Troca code por tokens
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: ENV.GOOGLE_CLIENT_ID,
        client_secret: clientSecret,
        redirect_uri: ENV.GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }).toString(),
    });

    if (!tokenRes.ok) {
      throw new Error(`Token exchange failed: ${tokenRes.status}`);
    }

    const tokens = await tokenRes.json();

    // Obtém informações do usuário
    const userInfoRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userInfoRes.ok) {
      throw new Error(`User info fetch failed: ${userInfoRes.status}`);
    }

    const userInfo = await userInfoRes.json();

    // Verifica domínio corporativo via campo hd (hosted domain) do Google
    // O campo hd é definido pelo Google para contas G Suite/Workspace
    const hd = userInfo.hd;
    const emailDomain = userInfo.email?.split('@')[1];
    if (hd !== ENV.CORPORATE_DOMAIN && emailDomain !== ENV.CORPORATE_DOMAIN) {
      return res.redirect(
        `${ENV.FRONTEND_URL}?error=${encodeURIComponent(
          'Acesso restrito ao domínio corporativo'
        )}`
      );
    }

    // Cria/atualiza usuário no Supabase via admin API
    const serviceKey = await getSecret('supabase-service-role-key');
    const supabaseAdmin = createClient(ENV.SUPABASE_URL, serviceKey);

    const { error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: userInfo.email,
      email_confirm: true,
      user_metadata: {
        name: userInfo.name,
        picture: userInfo.picture,
        google_id: userInfo.sub,
      },
    });

    if (authError && !authError.message?.includes('already been registered')) {
      throw new Error(`Supabase user creation failed: ${authError.message}`);
    }

    // Gera magic link para obter access_token (funciona para usuários novos e existentes)
    const { data: linkData, error: linkError } =
      await supabaseAdmin.auth.admin.generateLink({
        type: 'magiclink',
        email: userInfo.email,
      });

    if (linkError) throw new Error(`Failed to generate session: ${linkError.message}`);
    const jwt = linkData?.properties?.access_token;

    if (!jwt) {
      throw new Error('Failed to obtain JWT from Supabase');
    }

    return res.redirect(`${ENV.FRONTEND_URL}?jwt=${encodeURIComponent(jwt)}`);
  } catch (err) {
    console.error('[Auth] Callback error:', err.message);
    return res.redirect(
      `${ENV.FRONTEND_URL}?error=${encodeURIComponent('Erro interno de autenticação')}`
    );
  }
});

/**
 * GET /auth/dev-login?email=test@exa.com.br
 * Atalho de desenvolvimento — cria sessão Supabase para o email fornecido.
 * Disponível apenas em NODE_ENV !== 'production'.
 */
router.get('/dev-login', async (req, res) => {
  if (ENV.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }

  const { email } = req.query;
  if (!email) {
    return res.status(400).json({ error: 'Parâmetro email obrigatório' });
  }

  const emailDomain = email.split('@')[1];
  if (emailDomain !== ENV.CORPORATE_DOMAIN) {
    return res.status(403).json({
      error: `Email deve pertencer ao domínio ${ENV.CORPORATE_DOMAIN}`,
    });
  }

  try {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) {
      return res.status(500).json({
        error: 'SUPABASE_SERVICE_ROLE_KEY não configurada para dev-login',
      });
    }

    const supabaseAdmin = createClient(ENV.SUPABASE_URL, serviceKey);

    // Cria usuário se não existir
    await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { name: email.split('@')[0], dev_user: true },
    });

    // Gera magic link para obter access_token
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });

    if (error) {
      return res.status(500).json({ error: `Falha ao gerar sessão: ${error.message}` });
    }

    const jwt = data?.properties?.access_token;
    if (!jwt) {
      return res.status(500).json({ error: 'Não foi possível obter JWT do Supabase' });
    }

    return res.json({ jwt, email });
  } catch (err) {
    console.error('[Auth] dev-login error:', err.message);
    return res.status(500).json({ error: 'Erro interno' });
  }
});

/**
 * POST /auth/logout
 * Stateless — apenas retorna 200. O frontend descarta o JWT da memória.
 */
router.post('/logout', (req, res) => {
  res.status(200).json({ message: 'Sessão encerrada' });
});

export default router;
