/**
 * API Gateway — roteamento, rate limit, CORS, health check.
 * Proxy reverso para auth-service, billing-service e chat-service.
 */

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

const app = express();
const PORT = process.env.PORT || 8080;

const SERVICES = {
  auth:    process.env.AUTH_SERVICE_URL    || 'http://auth-service:3001',
  billing: process.env.BILLING_SERVICE_URL || 'http://billing-service:3002',
  chat:    process.env.CHAT_SERVICE_URL    || 'http://chat-service:3003',
};

app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
}));
app.use(express.json({ limit: '1mb' }));

// Força HTTPS em produção
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] !== 'https') {
    return res.redirect(301, `https://${req.headers.host}${req.url}`);
  }
  next();
});

// Rate limit global
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
  max: parseInt(process.env.RATE_LIMIT_MAX || '120'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Limite de requisições excedido. Tente novamente em 1 minuto.' },
});
app.use('/api', limiter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'api-gateway', uptime: process.uptime() });
});

// Proxy helper
async function proxyTo(serviceUrl, req, res) {
  const url = `${serviceUrl}${req.originalUrl}`;
  try {
    const fetchRes = await fetch(url, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
        'X-Forwarded-For': req.headers['x-forwarded-for'] || req.ip,
      },
      ...(req.method !== 'GET' && req.method !== 'HEAD' ? { body: JSON.stringify(req.body) } : {}),
    });

    const data = await fetchRes.json().catch(() => ({}));
    res.status(fetchRes.status).json(data);
  } catch (err) {
    console.error(`[Gateway] Proxy error → ${url}:`, err.message);
    res.status(503).json({ error: 'Serviço temporariamente indisponível' });
  }
}

// Rotas → auth-service
app.all('/auth/*', (req, res) => proxyTo(SERVICES.auth, req, res));

// Rotas → billing-service
app.all('/api/billing/*', (req, res) => proxyTo(SERVICES.billing, req, res));
app.all('/api/summaries*', (req, res) => proxyTo(SERVICES.billing, req, res));
app.all('/api/recommendations*', (req, res) => proxyTo(SERVICES.billing, req, res));

// Rotas → chat-service
app.all('/api/chat*', (req, res) => proxyTo(SERVICES.chat, req, res));

app.use((req, res) => res.status(404).json({ error: 'Rota não encontrada' }));

app.listen(PORT, () => console.log(`[Gateway] Listening on :${PORT}`));
