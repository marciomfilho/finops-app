/**
 * Sync Job — coleta GCP + Huawei → upsert billing_records → embeddings → summaries.
 * Executado como CronJob no Kubernetes (diário às 02:00).
 */

import { createClient } from '@supabase/supabase-js';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { createHmac, createHash } from 'crypto';

const ENV = {
  NODE_ENV:      process.env.NODE_ENV || 'production',
  SUPABASE_URL:  process.env.SUPABASE_URL,
  GCP_PROJECT_ID: process.env.GCP_PROJECT_ID,
  BILLING_ACCOUNT_ID: process.env.BILLING_ACCOUNT_ID,
};

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

let _db = null;
async function getDB() {
  if (_db) return _db;
  const key = await getSecret('supabase-service-role-key');
  _db = createClient(ENV.SUPABASE_URL, key);
  return _db;
}

// ── GCP Sync ──────────────────────────────────────────────────────────────────
async function runGCPSync(db, periodStart, periodEnd) {
  console.log('[GCPSync] Iniciando...');
  if (ENV.NODE_ENV !== 'production') {
    console.log('[GCPSync] DEV mode — skipping real API call');
    return { processed: 0, errors: 0 };
  }

  const saJson = await getSecret('gcp-service-account-json');
  const sa = JSON.parse(saJson);

  // Obtém access token via JWT
  const { createSign } = await import('crypto');
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-billing.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  })).toString('base64url');
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const jwt = `${header}.${payload}.${sign.sign(sa.private_key, 'base64url')}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const { access_token } = await tokenRes.json();

  const billingRes = await fetch(
    `https://cloudbilling.googleapis.com/v1/billingAccounts/${ENV.BILLING_ACCOUNT_ID}/skus?startTime=${encodeURIComponent(periodStart)}&endTime=${encodeURIComponent(periodEnd)}`,
    { headers: { Authorization: `Bearer ${access_token}` } }
  );
  const billingData = await billingRes.json();

  const records = [];
  for (const row of billingData.rows || []) {
    const projectId = row.dimensions?.find(d => d.key === 'project.id')?.value || 'unknown';
    const projectName = row.dimensions?.find(d => d.key === 'project.name')?.value || projectId;
    const service = row.dimensions?.find(d => d.key === 'service.description')?.value || 'Other';
    const region = row.dimensions?.find(d => d.key === 'location.region')?.value || 'global';
    const cost = parseFloat(row.metrics?.[0]?.values?.[0]?.moneyValue?.units || '0');
    records.push({ provider: 'gcp', project_id: projectId, project_name: projectName, service, cost, currency: 'USD', period_start: periodStart, period_end: periodEnd, region, tags: {}, synced_at: new Date().toISOString() });
  }

  return upsertChunks(db, records, 'GCPSync');
}

// ── Huawei Sync ───────────────────────────────────────────────────────────────
async function runHuaweiSync(db, periodStart, periodEnd) {
  console.log('[HuaweiSync] Iniciando...');
  if (ENV.NODE_ENV !== 'production') {
    console.log('[HuaweiSync] DEV mode — skipping real API call');
    return { processed: 0, errors: 0 };
  }

  const ak = await getSecret('huawei-ak');
  const sk = await getSecret('huawei-sk');
  const billCycle = periodStart.slice(0, 7); // YYYY-MM

  const HOST = 'bss.myhuaweicloud.com';
  const datetime = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const date = datetime.slice(0, 8);
  const path = '/v2/bills/monthly-bills/res-summary';
  const query = `bill_cycle=${billCycle}&limit=100`;
  const canonicalReq = `GET\n${path}\n${query}\ncontent-type:application/json\nhost:${HOST}\nx-sdk-date:${datetime}\n\ncontent-type;host;x-sdk-date\n${createHash('sha256').update('').digest('hex')}`;
  const stringToSign = `SDK-HMAC-SHA256\n${datetime}\n${createHash('sha256').update(canonicalReq).digest('hex')}`;
  const sigKey = createHmac('sha256', sk).update(date).digest();
  const sig = createHmac('sha256', sigKey).update(stringToSign).digest('hex');
  const auth = `SDK-HMAC-SHA256 Access=${ak}, SignedHeaders=content-type;host;x-sdk-date, Signature=${sig}`;

  const res = await fetch(`https://${HOST}${path}?${query}`, {
    headers: { 'Content-Type': 'application/json', Host: HOST, 'X-Sdk-Date': datetime, Authorization: auth },
  });
  const data = await res.json();

  const records = (data.bill_sums || []).map(bill => ({
    provider: 'huawei',
    project_id: bill.enterprise_project_id || 'default',
    project_name: bill.enterprise_project_name || 'Default Project',
    service: bill.cloud_service_type_name || 'Other',
    cost: parseFloat(bill.consume_amount || '0'),
    currency: 'CNY',
    period_start: periodStart, period_end: periodEnd,
    region: bill.region || 'cn-north-4',
    tags: {}, synced_at: new Date().toISOString(),
  }));

  return upsertChunks(db, records, 'HuaweiSync');
}

// ── Embedding Sync ────────────────────────────────────────────────────────────
async function runEmbeddingSync(db) {
  console.log('[EmbeddingSync] Iniciando...');
  const apiKey = await getSecret('gemini-api-key').catch(() => null);
  if (!apiKey) { console.warn('[EmbeddingSync] Sem API key — pulando'); return { processed: 0, errors: 0 }; }

  const { data: embedded } = await db.from('financial_embeddings').select('record_id').eq('record_type', 'billing_record');
  const embeddedIds = (embedded || []).map(e => e.record_id);

  let query = db.from('billing_records').select('*');
  if (embeddedIds.length > 0) query = query.not('id', 'in', `(${embeddedIds.join(',')})`);
  const { data: records } = await query.limit(500);

  let processed = 0, errors = 0;
  for (const rec of records || []) {
    const content = `Provider: ${rec.provider}, Project: ${rec.project_name}, Service: ${rec.service}, Cost: ${rec.cost} ${rec.currency}, Period: ${rec.period_start} to ${rec.period_end}`;
    try {
      const embRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'models/text-embedding-004', content: { parts: [{ text: content }] } }),
      });
      const embData = await embRes.json();
      const embedding = embData?.embedding?.values;
      if (!embedding) { errors++; continue; }

      const { error } = await db.from('financial_embeddings').insert({
        record_type: 'billing_record', record_id: rec.id, content, embedding,
        metadata: { provider: rec.provider, project_id: rec.project_id, cost: rec.cost },
      });
      if (error) { errors++; } else { processed++; }
    } catch { errors++; }
  }
  console.log(`[EmbeddingSync] processed: ${processed}, errors: ${errors}`);
  return { processed, errors };
}

// ── Summary Sync ──────────────────────────────────────────────────────────────
async function runSummarySync(db) {
  console.log('[SummarySync] Iniciando...');
  const { data: periods } = await db.from('billing_records').select('provider, period_start, period_end');
  const seen = new Map();
  for (const row of periods || []) {
    const key = `${row.provider}|${row.period_start}|${row.period_end}`;
    if (!seen.has(key)) seen.set(key, row);
  }

  let processed = 0, errors = 0;
  for (const { provider, period_start, period_end } of seen.values()) {
    const { data } = await db.from('billing_records').select('cost, project_id').eq('provider', provider).eq('period_start', period_start).eq('period_end', period_end);
    const total_cost = (data || []).reduce((s, r) => s + (r.cost || 0), 0);
    const active_projects = new Set((data || []).map(r => r.project_id)).size;
    const { error } = await db.from('cost_summaries').upsert(
      { provider, period_start, period_end, total_cost, total_waste: 0, potential_saving: 0, active_projects, payload: {} },
      { onConflict: 'provider,period_start,period_end' }
    );
    if (error) { errors++; } else { processed++; }
  }
  console.log(`[SummarySync] processed: ${processed}, errors: ${errors}`);
  return { processed, errors };
}

// ── Upsert helper ─────────────────────────────────────────────────────────────
async function upsertChunks(db, records, label) {
  const CHUNK = 1000;
  let processed = 0, errors = 0;
  for (let i = 0; i < records.length; i += CHUNK) {
    const { error } = await db.from('billing_records').upsert(records.slice(i, i + CHUNK), {
      onConflict: 'provider,project_id,service,period_start,period_end',
    });
    if (error) { console.error(`[${label}] Chunk error:`, error.message); errors += CHUNK; }
    else { processed += records.slice(i, i + CHUNK).length; }
  }
  console.log(`[${label}] processed: ${processed}, errors: ${errors}`);
  return { processed, errors };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('[SyncJob] Iniciando...');
  const db = await getDB();
  const now = new Date();
  const periodEnd = now.toISOString();
  const periodStart = new Date(now.getTime() - 30 * 86400000).toISOString();

  await db.from('audit_log').insert({ user_email: 'sync-job@system', action: 'sync:start', payload: { started_at: periodStart }, created_at: new Date().toISOString() });

  const results = [];
  for (const [name, fn] of [
    ['gcpSync',       () => runGCPSync(db, periodStart, periodEnd)],
    ['huaweiSync',    () => runHuaweiSync(db, periodStart, periodEnd)],
    ['embeddingSync', () => runEmbeddingSync(db)],
    ['summarySync',   () => runSummarySync(db)],
  ]) {
    try {
      const r = await fn();
      results.push({ step: name, ...r });
    } catch (err) {
      console.error(`[SyncJob] ${name} falhou:`, err.message);
      results.push({ step: name, processed: 0, errors: 1, exception: err.message });
    }
  }

  const totalErrors = results.reduce((s, r) => s + r.errors, 0);
  await db.from('audit_log').insert({ user_email: 'sync-job@system', action: 'sync:end', payload: { finished_at: new Date().toISOString(), steps: results }, created_at: new Date().toISOString() });

  console.log('[SyncJob] Concluído.', results);
  process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch(err => { console.error('[SyncJob] Fatal:', err.message); process.exit(1); });
