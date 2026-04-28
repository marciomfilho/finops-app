/**
 * Chat Service — RAG pipeline: embed → busca vetorial pgvector → Gemini.
 * Rota: POST /api/chat
 */

import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const app = express();
const PORT = process.env.PORT || 3003;
app.use(express.json({ limit: '2mb' }));

const ENV = {
  NODE_ENV:               process.env.NODE_ENV || 'development',
  SUPABASE_URL:           process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY:      process.env.SUPABASE_ANON_KEY,
  CORPORATE_DOMAIN:       process.env.CORPORATE_DOMAIN,
  GCP_PROJECT_ID:         process.env.GCP_PROJECT_ID,
  RAG_MAX_CHUNKS:         parseInt(process.env.RAG_MAX_CHUNKS || '10'),
  RAG_SIMILARITY_THRESHOLD: parseFloat(process.env.RAG_SIMILARITY_THRESHOLD || '0.75'),
  RAG_MAX_TOKENS:         parseInt(process.env.RAG_MAX_TOKENS || '8000'),
};

const EMBEDDING_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent';
const GEMINI_ENDPOINT     = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';
const EMBEDDING_DIM       = 768;

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

// ── Supabase ──────────────────────────────────────────────────────────────────
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

// ── Embedding ─────────────────────────────────────────────────────────────────
async function generateEmbedding(text) {
  const apiKey = await getSecret('gemini-api-key');
  if (!apiKey) return new Array(EMBEDDING_DIM).fill(0);

  const res = await fetch(`${EMBEDDING_ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'models/text-embedding-004', content: { parts: [{ text }] } }),
  });
  if (!res.ok) throw new Error(`Embedding API error: ${res.status}`);
  const data = await res.json();
  return data?.embedding?.values || new Array(EMBEDDING_DIM).fill(0);
}

// ── Vector search ─────────────────────────────────────────────────────────────
async function searchContext(embedding) {
  const db = await getDB();
  const { data, error } = await db.rpc('search_financial_context', {
    query_embedding: embedding,
    match_threshold: ENV.RAG_SIMILARITY_THRESHOLD,
    match_count: ENV.RAG_MAX_CHUNKS,
  });
  if (error) throw new Error(`Vector search error: ${error.message}`);
  return data || [];
}

// ── Gemini call ───────────────────────────────────────────────────────────────
async function callGemini(message, context, history, apiKey) {
  const systemPrompt = context
    ? `Você é um especialista em FinOps. Responda em português brasileiro baseando-se nos dados abaixo.\n\n${context}`
    : `Você é um especialista em FinOps. Responda em português brasileiro. Dados insuficientes — informe ao usuário.`;

  const contents = [
    { role: 'user', parts: [{ text: systemPrompt }] },
    { role: 'model', parts: [{ text: 'Entendido. Pronto para analisar os dados financeiros.' }] },
    ...history.slice(-6).map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] })),
    { role: 'user', parts: [{ text: message }] },
  ];

  const res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents, generationConfig: { temperature: 0.3, maxOutputTokens: 1024 } }),
  });
  if (!res.ok) { const err = new Error(`Gemini error: ${res.status}`); err.status = res.status; throw err; }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'chat-service' }));

// ── POST /api/chat ────────────────────────────────────────────────────────────
app.post('/api/chat', requireAuth, async (req, res, next) => {
  try {
    const { message, history = [] } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Campo message obrigatório' });
    if (message.length > 2000) return res.status(400).json({ error: 'Mensagem muito longa (max 2000)' });

    // 1. Embedding
    const embedding = await generateEmbedding(message.trim());

    // 2. Busca vetorial
    const chunks = await searchContext(embedding);
    const hasContext = chunks.length > 0;

    // 3. Monta contexto
    let context = null;
    if (hasContext) {
      const maxChars = ENV.RAG_MAX_TOKENS * 4;
      let ctx = 'DADOS FINANCEIROS RELEVANTES:\n\n';
      for (const chunk of chunks) {
        const line = `[${chunk.record_type}] ${chunk.content}\n`;
        if (ctx.length + line.length > maxChars) break;
        ctx += line;
      }
      context = ctx;
    }

    // 4. Gemini
    const apiKey = await getSecret('gemini-api-key');
    const text = await callGemini(message.trim(), context, history, apiKey);

    // 5. Extrai insights
    const insights = text.split('\n')
      .filter(l => l.trim() && (l.includes('•') || /^[🔴🟠🟡🟢💰⚠️]/u.test(l)))
      .slice(0, 5)
      .map((line, i) => ({ id: i + 1, text: line.trim(), severity: i === 0 ? 'high' : 'medium' }));

    return res.json({ text, insights, chunksUsed: chunks.length, hasContext });
  } catch (err) { next(err); }
});

app.use((err, req, res, next) => {
  console.error('[Chat]', err.message);
  res.status(err.status || 500).json({ error: ENV.NODE_ENV === 'development' ? err.message : 'Erro interno' });
});

app.listen(PORT, () => console.log(`[Chat] Listening on :${PORT}`));
