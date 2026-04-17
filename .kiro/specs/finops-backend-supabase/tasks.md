# Plano de Implementação: finops-backend-supabase

## Visão Geral

Implementação do backend Node.js/Express com integração ao Supabase para o FinOps Dashboard V2 da EXA. A ordem de implementação segue as dependências: configuração do projeto → schema do banco → camada de config → middleware → services → normalizers → routes → server.js → sync job → testes de propriedade → integração com o frontend.

Linguagem: JavaScript (Node.js, CommonJS, sem TypeScript)

---

## Tasks

- [x] 1. Configuração do projeto backend
  - Criar `backend/package.json` com dependências: `express`, `@supabase/supabase-js`, `@google-cloud/secret-manager`, `express-rate-limit`, `helmet`, `cors`, `node-fetch`
  - Criar `backend/Dockerfile` com imagem `node:20-slim`, `WORKDIR /app`, `COPY`, `npm ci --omit=dev`, `CMD ["node", "src/server.js"]`
  - Criar `backend/.env.example` com todas as variáveis não sensíveis: `NODE_ENV`, `PORT`, `FRONTEND_URL`, `CORPORATE_DOMAIN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GCP_PROJECT_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_REDIRECT_URI`, `RAG_SIMILARITY_THRESHOLD`, `RAG_MAX_CHUNKS`, `RAG_MAX_TOKENS`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`
  - Criar estrutura de diretórios: `backend/src/config/`, `backend/src/middleware/`, `backend/src/routes/`, `backend/src/services/`, `backend/src/normalizers/`, `backend/sync/`, `backend/migrations/`, `backend/tests/properties/`
  - _Requirements: 12.1, 12.2, 12.5_

- [x] 2. Schema Supabase — migration SQL
  - [x] 2.1 Criar `backend/migrations/001_initial_schema.sql` com extensões e enums
    - Habilitar `pgvector`, `pg_cron`, `uuid-ossp`
    - Criar enums `recommendation_source` e `recommendation_status`
    - _Requirements: 5.7, 5.8_

  - [x] 2.2 Adicionar tabelas `billing_records` e `cost_summaries` à migration
    - `billing_records`: id, provider, project_id, project_name, service, cost, currency, period_start, period_end, region, tags (jsonb), raw_payload (jsonb), synced_at; constraint UNIQUE (provider, project_id, service, period_start, period_end)
    - `cost_summaries`: id, provider, period_start, period_end, total_cost, total_waste, potential_saving, active_projects, payload (jsonb), created_at; constraint UNIQUE (provider, period_start, period_end)
    - Criar índices: `idx_billing_provider_period`, `idx_billing_project`, `idx_summaries_provider_period`
    - _Requirements: 5.1, 5.2_

  - [x] 2.3 Adicionar tabelas `recommendations`, `financial_embeddings` e `audit_log` à migration
    - `recommendations`: id, source (enum), provider, title, description, saving, priority, status (enum), created_at, updated_at
    - `financial_embeddings`: id, record_type, record_id, content (text), embedding (vector(768)), metadata (jsonb), created_at; índice HNSW com `vector_cosine_ops`
    - `audit_log`: id, user_email, action, payload (jsonb), ip_address, created_at; índice `idx_audit_user_created`
    - _Requirements: 5.3, 5.4, 5.5_

  - [x] 2.4 Adicionar RLS, políticas e função de busca vetorial à migration
    - Habilitar RLS em todas as 5 tabelas
    - Políticas de leitura para usuários autenticados em `billing_records`, `cost_summaries`, `recommendations`, `financial_embeddings`
    - Política de leitura apenas para role `admin` em `audit_log`; INSERT permitido para service role; políticas `FOR UPDATE USING (false)` e `FOR DELETE USING (false)` no `audit_log`
    - Criar função `search_financial_context(query_embedding, match_threshold, match_count)` em plpgsql
    - _Requirements: 5.6, 5.9, 6.1, 6.2, 6.3_

  - [x] 2.5 Adicionar agendamentos `pg_cron` à migration
    - Sync diário de billing às 02:00 UTC (`daily-billing-sync`)
    - Sync horário para detecção de anomalias (`hourly-anomaly-sync`)
    - _Requirements: 4.1, 5.8_

- [x] 3. Camada de configuração
  - [x] 3.1 Criar `backend/src/config/env.js` com objeto `ENV` e validação de variáveis obrigatórias
    - Exportar objeto `ENV` com todas as variáveis não sensíveis com valores padrão
    - Validar na inicialização as variáveis obrigatórias: `CORPORATE_DOMAIN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GCP_PROJECT_ID`, `GOOGLE_CLIENT_ID`; lançar erro explícito se ausentes
    - _Requirements: 12.2, 3.6_

  - [x] 3.2 Criar `backend/src/config/secrets.js` com integração ao Google Secret Manager
    - Implementar `getSecret(secretName)` com cache em `Map` — nunca registra o valor em logs
    - Implementar `loadAllSecrets()` que carrega os 6 segredos obrigatórios na inicialização; falha explicitamente se qualquer segredo estiver ausente
    - Segredos: `huawei-ak`, `huawei-sk`, `gcp-service-account-json`, `supabase-service-role-key`, `gemini-api-key`, `google-client-secret`
    - _Requirements: 3.1, 3.2, 3.4, 3.5_

- [x] 4. Middleware
  - [x] 4.1 Criar `backend/src/middleware/auth.js` — validação JWT + domínio corporativo
    - Extrair Bearer token do header `Authorization`; retornar 401 se ausente ou malformado
    - Chamar `supabase.auth.getUser(token)` para validação stateless; retornar 401 se inválido
    - Verificar `user.email.split('@')[1] === ENV.CORPORATE_DOMAIN`; retornar 403 se domínio inválido
    - Atribuir `req.user` e `req.token`; chamar `next()`
    - _Requirements: 1.2, 1.3, 1.5, 6.4, 6.5_

  - [x] 4.2 Criar `backend/src/middleware/rateLimiter.js` — 60 req/min por usuário
    - Usar `express-rate-limit` com `keyGenerator: (req) => req.user?.email || req.ip`
    - Configurar `windowMs` e `max` a partir de `process.env`; resposta 429 com mensagem em português
    - _Requirements: 2.6_

  - [x] 4.3 Criar `backend/src/middleware/audit.js` — registro append-only assíncrono
    - Implementar `sanitizeParams(params)` que substitui campos sensíveis por `[REDACTED]` (password, token, secret, key, authorization, ak, sk)
    - Inserir registro no `audit_log` de forma assíncrona (não bloqueia a resposta); logar apenas erro de inserção, nunca o valor dos parâmetros
    - _Requirements: 2.7, 10.1, 10.5_

  - [x] 4.4 Criar `backend/src/middleware/errorHandler.js` — erros sanitizados
    - Logar internamente `err.message`, `err.stack`, `req.path` e `req.user?.email`
    - Mapear status codes conhecidos (401, 403, 404, 429, 503) para mensagens seguras em português
    - Nunca expor stack trace ao cliente; incluir `detail` apenas em `NODE_ENV === 'development'`
    - _Requirements: 2.8, 11.2_

- [x] 5. Services
  - [x] 5.1 Criar `backend/src/services/secretManager.js` — re-exportar de `config/secrets.js`
    - Exportar `getSecret` e `loadAllSecrets` como interface pública do serviço
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 5.2 Criar `backend/src/services/supabase.js` — cliente Supabase com service role
    - Implementar `getSupabaseServiceClient()` com singleton lazy (cache em `_serviceClient`)
    - Implementar `getCostSummaries(periodDays)`, `getBillingRecords(provider, periodDays)`, `searchFinancialContext(embedding, limit, threshold)`
    - _Requirements: 5.1, 5.2, 7.2_

  - [x] 5.3 Criar `backend/src/services/gcpBilling.js` — cliente GCP Cloud Billing API
    - Implementar `fetchBillingData(projectId, periodStart, periodEnd)` usando service account JSON do Secret Manager
    - Implementar retry com backoff exponencial (5 tentativas: 1s, 2s, 4s, 8s, 16s) para erros 5xx e timeouts
    - _Requirements: 2.2, 11.1_

  - [x] 5.4 Criar `backend/src/services/huaweiBss.js` — cliente Huawei BSS API com AK/SK
    - Implementar `fetchBills(startDate, endDate)` com assinatura HMAC-SHA256 usando AK/SK do Secret Manager
    - Implementar paginação para suportar mais de 1.000 registros; retry com backoff exponencial
    - _Requirements: 2.2, 4.4, 11.1_

  - [x] 5.5 Criar `backend/src/services/geminiEmbedding.js` — Gemini Embedding API
    - Implementar `generateEmbedding(text)` chamando `text-embedding-004` com dimensão 768
    - Usar `gemini-api-key` do Secret Manager; nunca logar a chave
    - _Requirements: 4.7, 7.1_

  - [x] 5.6 Criar `backend/src/services/ragPipeline.js` — pipeline RAG completo
    - Implementar `runRAGPipeline(message, history)`: embed → busca vetorial → buildContext → callGemini
    - Implementar `buildContext(chunks, maxTokens)` respeitando limite de `maxTokens * 4` caracteres, priorizando chunks de maior similaridade
    - Implementar `callGemini(message, context, history, apiKey)` — nunca incluir credenciais no payload
    - Quando `chunks.length === 0`, informar ao Gemini que não há dados suficientes
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.7_

- [x] 6. Normalizers
  - [x] 6.1 Criar `backend/src/normalizers/gcpNormalizer.js`
    - Implementar `normalizeGCP(gcpResponse, periodStart, periodEnd)` → `ProviderData`
    - Agregar projetos por `project.id`; calcular `summary.currentCost` como soma de todos os projetos
    - Implementar `aggregateServices(projects)` e `aggregateRegions(projects)`
    - _Requirements: 2.3, 4.2_

  - [x] 6.2 Criar `backend/src/normalizers/huaweiNormalizer.js`
    - Implementar `normalizeHuawei(huaweiResponse, periodStart, periodEnd)` → `ProviderData`
    - Mapear `bill_sums` para projetos; calcular `summary.currentCost` como soma de todos os projetos
    - _Requirements: 2.3, 4.3_

- [x] 7. Routes
  - [x] 7.1 Criar `backend/src/routes/auth.js` — fluxo OAuth2 Google
    - `GET /auth/google`: redirecionar para OAuth2 do Google com escopos `profile` e `email`
    - `GET /auth/callback`: validar ID token, verificar campo `hd`, criar sessão Supabase, redirecionar com JWT
    - `POST /auth/logout`: invalidar sessão Supabase
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 9.2, 9.3_

  - [x] 7.2 Criar `backend/src/routes/billing.js` — `GET /api/billing/:provider`
    - Aceitar `provider`: `gcp` | `huawei` | `all`; parâmetro `?period=30`
    - Validar e sanitizar parâmetros; buscar dados do Supabase via `getBillingRecords`
    - Retornar no formato `ProviderData` compatível com o DataBus
    - _Requirements: 2.1, 2.3, 2.5_

  - [x] 7.3 Criar `backend/src/routes/summaries.js` — `GET /api/summaries`
    - Aceitar `?period=30`; retornar `UnifiedSummary` da tabela `cost_summaries`
    - Incluir campo `synced_at` no payload de resposta
    - _Requirements: 2.1, 11.3_

  - [x] 7.4 Criar `backend/src/routes/recommendations.js` — `GET /api/recommendations`
    - Retornar lista de recomendações da tabela `recommendations`
    - _Requirements: 2.1_

  - [x] 7.5 Criar `backend/src/routes/chat.js` — `POST /api/chat`
    - Aceitar `{ message, history[] }`; chamar `runRAGPipeline(message, history)`
    - Retornar `{ text, insights[], chunksUsed, hasContext }`
    - _Requirements: 7.1, 7.3, 7.6_

- [x] 8. server.js — montagem do app Express
  - Criar `backend/src/server.js` registrando middleware na ordem correta: `helmet`, `cors`, `express.json`, redirecionamento HTTPS, health check, rotas `/auth`, `requireAuth` + `rateLimiter` + `auditMiddleware` para `/api`, rotas de dados, `errorHandler`
  - Chamar `loadAllSecrets()` antes de `app.listen`; encerrar processo com erro se falhar
  - Implementar graceful shutdown: `SIGTERM` → `server.close()` → `process.exit(0)`; timeout de 30s força `process.exit(1)`
  - _Requirements: 1.6, 3.4, 12.1, 12.3, 12.6_

- [x] 9. Checkpoint — Backend funcional
  - Garantir que `GET /health` retorna 200, que requisições sem JWT retornam 401 e que o servidor inicializa sem erros com variáveis de ambiente configuradas. Pergunte ao usuário se tiver dúvidas.

- [x] 10. Sync Job
  - [x] 10.1 Criar `backend/sync/index.js` — entry point do Sync Job
    - Chamar `loadAllSecrets()` na inicialização; encerrar com erro se falhar
    - Orquestrar execução sequencial: `gcpSync` → `huaweiSync` → `embeddingSync` → `summarySync`
    - Registrar início e fim no `audit_log` com número de registros processados e erros
    - _Requirements: 3.3, 4.1, 10.4, 12.4_

  - [x] 10.2 Criar `backend/sync/gcpSync.js` — coleta e upsert de billing GCP
    - Chamar `gcpBilling.fetchBillingData()`, normalizar com `normalizeGCP()`, fazer upsert em `billing_records` pela chave composta
    - Paginar chamadas para suportar até 100.000 registros; processar em chunks de 1.000
    - _Requirements: 4.2, 4.4, 4.8_

  - [x] 10.3 Criar `backend/sync/huaweiSync.js` — coleta e upsert de billing Huawei
    - Chamar `huaweiBss.fetchBills()`, normalizar com `normalizeHuawei()`, fazer upsert em `billing_records`
    - Retry com backoff exponencial (5x) para falhas de API; continuar com demais registros em caso de falha parcial
    - _Requirements: 4.3, 4.5, 4.8_

  - [x] 10.4 Criar `backend/sync/embeddingSync.js` — geração e armazenamento de embeddings
    - Buscar registros em `billing_records` sem embedding correspondente em `financial_embeddings`
    - Gerar texto descritivo por registro, chamar `generateEmbedding()`, inserir em `financial_embeddings`
    - Processar em chunks de 100 para respeitar rate limits da Gemini Embedding API
    - _Requirements: 4.7_

  - [x] 10.5 Criar `backend/sync/summarySync.js` — agregação de cost_summaries
    - Agregar totais por provider e período a partir de `billing_records`
    - Fazer upsert em `cost_summaries` pela chave composta `(provider, period_start, period_end)`
    - _Requirements: 4.6_

- [x] 11. Testes de propriedade (fast-check)
  - [x] 11.1 Escrever property test para contexto RAG sem credenciais (Property 1)
    - Criar `backend/tests/properties/ragPipeline.property.test.js`
    - Gerar chunks arbitrários e `maxTokens` via fast-check; verificar que `buildContext(chunks, maxTokens)` não contém padrões de AK/SK Huawei, JWT, service account JSON ou Google API key
    - **Property 1: Contexto RAG nunca contém credenciais**
    - **Validates: Requirements 7.4, 3.5**

  - [x] 11.2 Escrever property test para auditoria de requisições autenticadas (Property 2)
    - Criar `backend/tests/properties/audit.property.test.js`
    - Para qualquer requisição autenticada a `/api/*`, verificar que exatamente um registro é inserido no `audit_log` com `user_email`, `action`, `payload` sanitizado e `created_at`
    - **Property 2: Audit log registra toda requisição autenticada**
    - **Validates: Requirements 2.7, 10.1**

  - [x] 11.3 Escrever property test para auditoria de falhas de autenticação (Property 3)
    - Para qualquer tentativa de autenticação que falhe (domínio inválido, token expirado, token ausente), verificar que o `audit_log` recebe registro com motivo e IP, sem conter o token fornecido
    - **Property 3: Audit log registra falhas de autenticação**
    - **Validates: Requirements 10.2**

  - [x] 11.4 Escrever property test para segredos ausentes em logs (Property 4)
    - Para qualquer valor de segredo gerado via fast-check, verificar que nenhuma linha de log produzida pelo backend contém esse valor
    - **Property 4: Segredos nunca aparecem em logs**
    - **Validates: Requirements 3.5, 10.5**

  - [x] 11.5 Escrever property test para normalização de providers (Property 5)
    - Criar `backend/tests/properties/normalizer.property.test.js`
    - Gerar respostas arbitrárias da GCP Billing API e da Huawei BSS API via fast-check
    - Verificar que `normalizeGCP` e `normalizeHuawei` produzem `ProviderData` com `provider` correto, `summary.currentCost === Σ projects[i].currentCost` e todos os projetos com `id`, `name`, `provider` e `currentCost >= 0`
    - **Property 5: Normalização produz ProviderData válido**
    - **Validates: Requirements 2.3, 4.2, 4.3**

  - [x] 11.6 Escrever property test para idempotência do upsert do Sync Job (Property 6)
    - Gerar conjuntos arbitrários de registros de billing via fast-check
    - Executar upsert duas vezes consecutivas com os mesmos dados; verificar que o número de registros em `billing_records` não aumenta na segunda execução
    - **Property 6: Idempotência do upsert do Sync Job**
    - **Validates: Requirements 4.8**

  - [x] 11.7 Escrever property test para imutabilidade do audit log (Property 7)
    - Para qualquer registro inserido no `audit_log`, verificar que tentativas de `UPDATE` e `DELETE` falham com erro de permissão
    - **Property 7: Audit log é append-only**
    - **Validates: Requirements 5.9, 10.3**

  - [x] 11.8 Escrever property test para rejeição sem JWT (Property 8)
    - Criar `backend/tests/properties/auth.property.test.js`
    - Para qualquer requisição a `/api/*` sem JWT válido (ausente, malformado, expirado, domínio inválido), verificar que o backend retorna 401 ou 403 sem realizar operação de banco
    - **Property 8: Requisições sem JWT são sempre rejeitadas com 401**
    - **Validates: Requirements 6.1, 6.4**

  - [x] 11.9 Escrever property test para limite de tokens do contexto RAG (Property 9)
    - Criar `backend/tests/properties/ragContext.property.test.js`
    - Gerar chunks arbitrários e `maxTokens` entre 100 e 16.000 via fast-check
    - Verificar que `buildContext(chunks, maxTokens).length <= maxTokens * 4`
    - **Property 9: Contexto RAG respeita limite de tokens**
    - **Validates: Requirements 7.5**

  - [x] 11.10 Escrever property test para chunks abaixo do threshold (Property 10)
    - Quando nenhum chunk possui similaridade `>= RAG_SIMILARITY_THRESHOLD`, verificar que o prompt enviado ao Gemini informa ausência de dados suficientes
    - **Property 10: Chunks abaixo do threshold são excluídos**
    - **Validates: Requirements 7.7**

  - [x] 11.11 Escrever property test para rate limiter (Property 11)
    - Criar `backend/tests/properties/rateLimiter.property.test.js`
    - Para qualquer usuário que envie exatamente `RATE_LIMIT_MAX` requisições na janela, verificar que a requisição `N+1` retorna 429; verificar que usuários distintos não interferem nos contadores uns dos outros
    - **Property 11: Rate limiter rejeita requisição N+1**
    - **Validates: Requirements 2.6**

  - [x] 11.12 Escrever property test para JWT em requisições do frontend (Property 12)
    - Para qualquer JWT recebido após autenticação, verificar que todas as requisições do `DataBus` e do `AIAgent` ao backend incluem `Authorization: Bearer <token>`
    - **Property 12: JWT incluído em todas as requisições do frontend**
    - **Validates: Requirements 8.4**

- [x] 12. Integração Frontend — DataBus e AIAgent
  - [x] 12.1 Adicionar `BackendProvider` ao `data-bus.js`
    - Implementar módulo `BackendProvider` com `setJWT(token)`, `clearJWT()`, `hasJWT()`, `isConfigured()`, `fetchData(period)`, `fetchSummaries(period)`
    - `fetchData` e `fetchSummaries` incluem `Authorization: Bearer <jwt>` em todas as requisições
    - Em caso de 401, chamar `clearJWT()` e disparar `CustomEvent('auth:expired')`
    - Registrar `BackendProvider` no `DataBus` com prioridade sobre GCP/Huawei diretos
    - _Requirements: 8.1, 8.4, 8.5, 8.6_

  - [x] 12.2 Atualizar `ai-agent.js` para usar o endpoint RAG do backend
    - Na função `chat(message, history, onChunk)`, verificar `BackendProvider.hasJWT()`
    - Se JWT disponível, enviar `POST /api/chat` com `{ message, history: history.slice(-6) }` e `Authorization: Bearer <jwt>`
    - Em caso de 401, disparar `CustomEvent('auth:expired')`; manter fallback para Gemini direto quando backend indisponível
    - _Requirements: 8.2, 8.3_

  - [x] 12.3 Atualizar `app.js` com fluxo de login e gerenciamento de sessão
    - Implementar `handleGoogleLogin()` que redireciona para `${BACKEND_URL}/auth/google`
    - Implementar `handleAuthCallback()` que captura `?jwt=<token>` da URL, chama `BackendProvider.setJWT(jwt)`, remove JWT da URL com `history.replaceState` e carrega dados
    - Ouvir `CustomEvent('auth:expired')` para limpar JWT e exibir tela de login
    - Implementar `handleLogout()` que chama `BackendProvider.clearJWT()` e exibe tela de login
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

- [x] 13. Checkpoint final — Verificação de integração
  - Garantir que o fluxo completo funciona: login Google → JWT armazenado em memória → DataBus carrega dados via backend → chat usa endpoint RAG → logout limpa sessão. Pergunte ao usuário se tiver dúvidas.

---

## Notes

- Tarefas marcadas com `*` são opcionais (testes de propriedade de integração) e podem ser puladas para MVP mais rápido
- A ordem das tarefas respeita dependências: config → middleware → services → normalizers → routes → server → sync → testes → frontend
- Cada tarefa referencia os requisitos específicos para rastreabilidade
- Os testes de propriedade usam a biblioteca **fast-check** (já presente no `package.json` do projeto raiz)
- O `backend/.env` nunca deve ser commitado — usar `.env.example` como referência
- Credenciais (AK/SK, API keys, service account) são carregadas exclusivamente do Secret Manager em runtime
- O `BackendProvider` armazena o JWT apenas em memória — nunca em `localStorage` ou cookies
