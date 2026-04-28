/**
 * Auth Service — Google OAuth2 + Supabase JWT.
 * Rotas: GET /auth/google, GET /auth/callback, POST /auth/logout, GET /auth/dev-login
 */

import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const app = express();
const PORT = process.env.PORT || 3001;
app.use(express.json());

const ENV = {
  NODE_ENV:          process.env.NODE_ENV || 'development',
  SUPABASE_URL:      process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  CORPORATE_DOMAIN:  process.env.CORPORATE_DOMAIN,
  GOOGLE_CLIENT_ID:  process.env.GOOGLE_CLIENT_ID,
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
  FRONTEND_URL:      process.env.FRONTEND_URL || 'http://localhost:3000',
  GCP_PROJECT_ID:    process.env.GCP_PROJECT_ID,
};

// Secret Manager
const smClient = new SecretManagerServiceClient();
const secretCache = new Map();

async function getSecret(name) {
  if (secretCache.has(name)) return secretCache.get(name);
  if (ENV.NODE_ENV !== 'production') {
    const val = process.env[name.toUpperCase().replace(/-/g, '_')];
    if (val) { secretCache.set(name, val); return val; }
  }
  const [version] = await smClient.accessSecretVersion({
    name: `projects/${ENV.GCP_PROJECT_ID}/secrets/${name}/versions/latest`,
  });
  const val = version.payload.data.toString('utf8');
  secretCache.set(name, val);
  return val;
}

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'auth-service' }));

// GET /auth/google — inicia OAuth2
app.get('/auth/google', (req, res) => {
  const params = new URLSearchParams({
    client_id: ENV.GOOGLE_CLIENT_ID,
    redirect_uri: ENV.GOOGLE_REDIRECT_URI,
    scope: 'openid profile email',
    response_type: 'code',
    access_type: 'offline',
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// GET /auth/callback — troca code por JWT Supabase
app.get('/auth/callback', async (req, res) => {
  const { code, error: oauthError } = req.query;
  if (oauthError || !code) {
    return res.redirect(`${ENV.FRONTEND_URL}?error=${encodeURIComponent('Autenticação cancelada')}`);
  }

  try {
    const clientSecret = await getSecret('google-client-secret');

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: ENV.GOOGLE_CLIENT_ID, client_secret: clientSecret,
        redirect_uri: ENV.GOOGLE_REDIRECT_URI, grant_type: 'authorization_code',
      }).toString(),
    });
    if (!tokenRes.ok) throw new Error(`Token exchange failed: ${tokenRes.status}`);
    const tokens = await tokenRes.json();

    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!userInfoRes.ok) throw new Error('User info fetch failed');
    const userInfo = await userInfoRes.json();

    const emailDomain = userInfo.email?.split('@')[1];
    if (userInfo.hd !== ENV.CORPORATE_DOMAIN && emailDomain !== ENV.CORPORATE_DOMAIN) {
      return res.redirect(`${ENV.FRONTEND_URL}?error=${encodeURIComponent('Acesso restrito ao domínio corporativo')}`);
    }

    const serviceKey = await getSecret('supabase-service-role-key');
    const supabaseAdmin = createClient(ENV.SUPABASE_URL, serviceKey);

    await supabaseAdmin.auth.admin.createUser({
      email: userInfo.email, email_confirm: true,
      user_metadata: { name: userInfo.name, picture: userInfo.picture, google_id: userInfo.sub },
    }).catch(() => {}); // ignora se já existe

    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink', email: userInfo.email,
    });
    if (linkError) throw new Error(`Failed to generate session: ${linkError.message}`);

    const jwt = linkData?.properties?.access_token;
    if (!jwt) throw new Error('Failed to obtain JWT');

    return res.redirect(`${ENV.FRONTEND_URL}?jwt=${encodeURIComponent(jwt)}`);
  } catch (err) {
    console.error('[Auth] Callback error:', err.message);
    return res.redirect(`${ENV.FRONTEND_URL}?error=${encodeURIComponent('Erro interno de autenticação')}`);
  }
});

// POST /auth/logout — stateless
app.post('/auth/logout', (req, res) => res.json({ message: 'Sessão encerrada' }));

// GET /auth/dev-login — apenas em desenvolvimento
app.get('/auth/dev-login', async (req, res) => {
  if (ENV.NODE_ENV === 'production') return res.status(404).json({ error: 'Not found' });
  const { email } = req.query;
  if (!email || email.split('@')[1] !== ENV.CORPORATE_DOMAIN) {
    return res.status(400).json({ error: `Email deve pertencer ao domínio ${ENV.CORPORATE_DOMAIN}` });
  }
  try {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseAdmin = createClient(ENV.SUPABASE_URL, serviceKey);
    await supabaseAdmin.auth.admin.createUser({ email, email_confirm: true }).catch(() => {});
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({ type: 'magiclink', email });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ jwt: data?.properties?.access_token, email });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`[Auth] Listening on :${PORT}`));
