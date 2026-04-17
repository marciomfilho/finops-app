/**
 * Entry point do servidor Express.
 * Registra middleware na ordem correta e inicia o servidor.
 * .env é carregado via --import ./src/loadEnv.js (ver package.json scripts).
 * Requirements: 1.6, 3.4, 12.1, 12.3, 12.6
 */

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';

import { ENV } from './config/env.js';
import { loadAllSecrets } from './config/secrets.js';
import { requireAuth } from './middleware/auth.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import { auditMiddleware } from './middleware/audit.js';
import { errorHandler } from './middleware/errorHandler.js';

import authRouter from './routes/auth.js';
import billingRouter from './routes/billing.js';
import summariesRouter from './routes/summaries.js';
import recommendationsRouter from './routes/recommendations.js';
import chatRouter from './routes/chat.js';

const app = express();

// ─── Segurança ────────────────────────────────────────────────────────────────
app.use(helmet());

app.use(
  cors({
    origin: ENV.FRONTEND_URL,
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  })
);

app.use(express.json({ limit: '1mb' }));

// ─── Força HTTPS em produção ──────────────────────────────────────────────────
app.use((req, res, next) => {
  if (
    ENV.NODE_ENV === 'production' &&
    req.headers['x-forwarded-proto'] !== 'https'
  ) {
    return res.redirect(301, `https://${req.headers.host}${req.url}`);
  }
  next();
});

// ─── Health check (sem autenticação) ─────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: process.env.npm_package_version || '1.0.0',
    uptime: process.uptime(),
  });
});

// ─── Rotas de autenticação (sem rate limit global) ────────────────────────────
app.use('/auth', authRouter);

// ─── Middleware de autenticação + rate limit + auditoria para /api ────────────
app.use('/api', requireAuth);
app.use('/api', rateLimiter);
app.use('/api', auditMiddleware);

// ─── Rotas de dados ───────────────────────────────────────────────────────────
app.use('/api/billing', billingRouter);
app.use('/api/summaries', summariesRouter);
app.use('/api/recommendations', recommendationsRouter);
app.use('/api/chat', chatRouter);

// ─── Handler global de erros (deve ser o último) ──────────────────────────────
app.use(errorHandler);

// ─── Inicialização ────────────────────────────────────────────────────────────
async function start() {
  try {
    await loadAllSecrets();
  } catch (err) {
    console.error('[Server] Falha ao carregar segredos — encerrando:', err.message);
    process.exit(1);
  }

  const server = app.listen(ENV.PORT, () => {
    console.log(`[Server] Listening on port ${ENV.PORT} (${ENV.NODE_ENV})`);
  });

  // ─── Graceful shutdown ────────────────────────────────────────────────────
  let shutdownTimer;

  process.on('SIGTERM', () => {
    console.log('[Server] SIGTERM recebido — iniciando graceful shutdown');

    shutdownTimer = setTimeout(() => {
      console.error('[Server] Timeout de shutdown — forçando encerramento');
      process.exit(1);
    }, 30000);

    server.close(() => {
      clearTimeout(shutdownTimer);
      console.log('[Server] Servidor encerrado com sucesso');
      process.exit(0);
    });
  });

  return server;
}

start();

export default app;
