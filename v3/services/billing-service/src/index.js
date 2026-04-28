/**
 * Billing Service — billing records, summaries, recommendations.
 * Rotas: GET /api/billing/:provider, GET /api/summaries, GET /api/recommendations
 */

import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const app = express();
const PORT = process.env.PORT || 3002;
app.use(express.json());

const ENV = {
  NODE_ENV:          process.env.NODE_ENV || 'development',
  SUPABASE_URL:      process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  CORPORATE_DOMAIN:  process.env.CORPORATE_DOMAIN,
  GCP_PROJECT_ID:    process.env.GCP_PROJECT_ID,
};

// ── Secret Manager ────────────────────────────────────────────────────────────
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

// ── Supabase client ───────────────────────────────────────────────────────────
let _supabase = null;
async function getDB() {
  if (_supabase) return _supabase;
  const key = await getSecret('supabase-service-role-key');
  _supabase = createClient(ENV.SUPABASE_URL, key);
  return _supabase;
}

// ── Auth middleware ───────────────────────────────────────────────────────────
const supabaseAnon = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY);

async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.slice(7);
  if (!token) return res.status(401).json({ error: 'Token ausente' });
  const { data: { user }, error } = await supabaseAnon.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Token inválido' });
  if (user.email?.split('@')[1] !== ENV.CORPORATE_DOMAIN) {
    return res.status(403).json({ error: 'Acesso restrito ao domínio corporativo' });
  }
  req.user = user;
  next();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function toProviderData(provider, records, periodDays) {
  const now = new Date();
  const periodStart = new Date(now - periodDays * 86400000).toISOString();
  const projectsMap = {};
  const servicesMap = {};
  const regionsMap = {};

  for (const rec of records) {
    const pid = rec.project_id || 'unknown';
    if (!projectsMap[pid]) {
      projectsMap[pid] = { id: pid, name: rec.project_name || pid, provider: rec.provider, currentCost: 0, services: [], region: rec.region || null, tags: rec.tags || {} };
    }
    projectsMap[pid].currentCost += parseFloat(rec.cost || 0);
    if (rec.service) {
      projectsMap[pid].services.push({ name: rec.service, cost: parseFloat(rec.cost || 0) });
      servicesMap[rec.service] = (servicesMap[rec.service] || 0) + parseFloat(rec.cost || 0);
    }
    if (rec.region) regionsMap[rec.region] = (regionsMap[rec.region] || 0) + parseFloat(rec.cost || 0);
  }

  const projects = Object.values(projectsMap);
  const totalCost = projects.reduce((s, p) => s + p.currentCost, 0);
  const services = Object.entries(servicesMap).map(([name, cost]) => ({ name, cost })).sort((a, b) => b.cost - a.cost);
  const regions = Object.entries(regionsMap).map(([region, cost]) => ({ region, cost }));

  return {
    provider, period_start: periodStart, period_end: now.toISOString(),
    summary: { currentCost: totalCost, previousCost: 0, budget: 0, totalWaste: 0, potentialSaving: 0 },
    projects, services, regions, timeline: [], waste: [], recommendations: [],
  };
}

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'billing-service' }));

// ── GET /api/billing/:provider ────────────────────────────────────────────────
app.get('/api/billing/:provider', requireAuth, async (req, res, next) => {
  try {
    const { provider } = req.params;
    if (!['gcp', 'huawei', 'all'].includes(provider)) {
      return res.status(400).json({ error: 'Provider inválido. Use: gcp, huawei, all' });
    }
    const period = Math.min(Math.max(parseInt(req.query.period) || 30, 1), 365);
    const db = await getDB();
    const since = new Date(Date.now() - period * 86400000).toISOString();

    let query = db.from('billing_records').select('*').gte('period_start', since).order('cost', { ascending: false });
    if (provider !== 'all') query = query.eq('provider', provider);
    const { data, error } = await query;
    if (error) throw new Error(error.message);

    if (provider === 'all') {
      return res.json({
        provider: 'all',
        gcp: toProviderData('gcp', data.filter(r => r.provider === 'gcp'), period),
        huawei: toProviderData('huawei', data.filter(r => r.provider === 'huawei'), period),
      });
    }
    return res.json(toProviderData(provider, data, period));
  } catch (err) { next(err); }
});

// ── GET /api/summaries ────────────────────────────────────────────────────────
app.get('/api/summaries', requireAuth, async (req, res, next) => {
  try {
    const period = Math.min(Math.max(parseInt(req.query.period) || 30, 1), 365);
    const db = await getDB();
    const since = new Date(Date.now() - period * 86400000).toISOString();
    const { data, error } = await db.from('cost_summaries').select('*').gte('period_start', since).order('period_start', { ascending: false });
    if (error) throw new Error(error.message);
    return res.json({ summaries: data, count: data.length, synced_at: new Date().toISOString() });
  } catch (err) { next(err); }
});

// ── GET /api/recommendations ──────────────────────────────────────────────────
app.get('/api/recommendations', requireAuth, async (req, res, next) => {
  try {
    const db = await getDB();
    const { data, error } = await db.from('recommendations').select('*').eq('status', 'open').order('priority', { ascending: true });
    if (error) throw new Error(error.message);
    return res.json({ recommendations: data, count: data.length });
  } catch (err) { next(err); }
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Billing]', err.message);
  res.status(err.status || 500).json({ error: ENV.NODE_ENV === 'development' ? err.message : 'Erro interno' });
});

app.listen(PORT, () => console.log(`[Billing] Listening on :${PORT}`));
