# FinOps Dashboard — Guia de Configuração

## Pré-requisitos

- Node.js 20+
- Git
- Conta no [Supabase](https://supabase.com) (gratuita)
- Conta GCP com Cloud Billing API habilitada (para dados reais de GCP)
- Conta Huawei Cloud com acesso ao BSS (para dados reais de Huawei)

---

## 1. Clonar o repositório

```bash
git clone <url-do-repositorio>
cd finops-app
```

---

## 2. Frontend (sem instalação)

O frontend é HTML/CSS/JS puro — não precisa de build. Basta abrir o `index.html` no browser ou servir com qualquer servidor estático.

Para desenvolvimento local com live reload:

```bash
npx serve .
```

Acesse `http://localhost:3000`.

Sem nenhuma configuração, o dashboard abre em **Modo Demo** com dados simulados.

---

## 3. Configurar provedores no frontend

Edite o arquivo `config.js` na raiz do projeto:

### GCP (acesso direto via browser)

1. Acesse o [Google Cloud Console](https://console.cloud.google.com)
2. Crie ou selecione um projeto
3. Ative as APIs:
   - Cloud Billing API
   - Recommender API
   - Cloud Billing Budget API
4. Vá em **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
5. Tipo: **Web application**
6. Em "Authorized JavaScript origins" adicione a URL onde o dashboard está hospedado (ex: `http://localhost:3000`)
7. Copie o **Client ID** gerado
8. Cole em `config.js`:

```js
window.GCP_CLIENT_ID = 'SEU_CLIENT_ID.apps.googleusercontent.com';
```

### Huawei Cloud (acesso direto via browser)

1. Acesse o console da Huawei Cloud → **IAM → My Credentials**
2. Crie um usuário com permissão de leitura no BSS
3. Gere um par de chaves **AK/SK** (Access Key / Secret Key)
4. Anote o **Project ID** em "My Credentials"
5. Preencha em `config.js`:

```js
window.HUAWEI_ACCESS_KEY = 'sua-access-key';
window.HUAWEI_SECRET_KEY = 'sua-secret-key';
window.HUAWEI_PROJECT_ID = 'seu-project-id';
window.HUAWEI_REGION = 'la-south-2'; // ajuste para sua região
```

### Gemini AI (assistente de IA)

1. Acesse [https://aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
2. Gere uma API Key
3. Cole em `config.js`:

```js
window.GEMINI_API_KEY = 'sua-gemini-api-key';
```

---

## 4. Configurar o Supabase

### 4.1 Criar o projeto

1. Acesse [https://supabase.com](https://supabase.com) e crie uma conta
2. Clique em **New Project**
3. Escolha um nome, senha do banco e região
4. Aguarde o projeto inicializar (~2 minutos)

### 4.2 Executar a migration

1. No painel do Supabase, vá em **SQL Editor**
2. Abra o arquivo `backend/migrations/001_initial_schema.sql`
3. Cole o conteúdo no editor e clique em **Run**

Isso cria as tabelas: `billing_records`, `cost_summaries`, `recommendations`, `financial_embeddings`, `audit_log`.

### 4.3 Obter as chaves

No painel do Supabase, vá em **Project Settings → API**:

- **Project URL** → `SUPABASE_URL`
- **anon / public** → `SUPABASE_ANON_KEY`
- **service_role** → `SUPABASE_SERVICE_ROLE_KEY` (nunca expor no frontend)

---

## 5. Configurar o backend

### 5.1 Instalar dependências

```bash
cd backend
npm install
```

### 5.2 Criar o arquivo .env

```bash
cp .env.example .env
```

Edite o `backend/.env` com os valores reais:

```env
NODE_ENV=development
PORT=8080
FRONTEND_URL=http://localhost:3000
CORPORATE_DOMAIN=suaempresa.com.br

SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

GCP_PROJECT_ID=seu-projeto-gcp
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_REDIRECT_URI=http://localhost:8080/auth/callback

RAG_SIMILARITY_THRESHOLD=0.75
RAG_MAX_CHUNKS=10
RAG_MAX_TOKENS=8000
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=60
```

> **Atenção:** nunca commite o `.env` com chaves reais. O `.gitignore` já está configurado para ignorá-lo.

### 5.3 Iniciar o backend em desenvolvimento

```bash
npm run dev
```

O servidor sobe em `http://localhost:8080`. Verifique com:

```bash
curl http://localhost:8080/health
```

Resposta esperada: `{"status":"ok","version":"1.0.0","uptime":...}`

### 5.4 Conectar o frontend ao backend

Em `config.js`, defina a URL do backend:

```js
window.BACKEND_URL = 'http://localhost:8080';
```

---

## 6. Sincronização de dados (Sync Job)

O Sync Job coleta dados da GCP e Huawei e persiste no Supabase. Execute manualmente ou agende via cron.

### Execução manual

```bash
cd backend
npm run sync
```

O job executa em sequência: `gcpSync → huaweiSync → embeddingSync → summarySync` e registra tudo no `audit_log`.

### Agendamento (cron)

Para rodar diariamente às 2h:

```bash
0 2 * * * cd /caminho/para/backend && npm run sync >> /var/log/finops-sync.log 2>&1
```

---

## 7. Importar CSV do Cloud8

Não requer configuração adicional. Basta:

1. Exportar o relatório do Cloud8 em `.csv`
2. Abrir o dashboard
3. Usar o botão de importação CSV
4. Arrastar o arquivo — o formato é detectado automaticamente

Ver detalhes no `MANUAL.md`.

---

## 8. Deploy em produção (Google Cloud Run)

### 8.1 Build da imagem Docker

```bash
cd backend
docker build -t finops-backend .
```

### 8.2 Configurar o Google Secret Manager

Em produção, as chaves sensíveis devem estar no Secret Manager, não no `.env`. Crie os segredos no GCP:

```bash
echo -n "sua-huawei-ak" | gcloud secrets create huawei-ak --data-file=-
echo -n "sua-huawei-sk" | gcloud secrets create huawei-sk --data-file=-
echo -n "$(cat service-account.json)" | gcloud secrets create gcp-service-account-json --data-file=-
echo -n "eyJ..." | gcloud secrets create supabase-service-role-key --data-file=-
echo -n "sua-gemini-key" | gcloud secrets create gemini-api-key --data-file=-
echo -n "seu-google-client-secret" | gcloud secrets create google-client-secret --data-file=-
```

### 8.3 Deploy no Cloud Run

```bash
gcloud run deploy finops-backend \
  --image finops-backend \
  --region us-central1 \
  --set-env-vars NODE_ENV=production,PORT=8080,FRONTEND_URL=https://seu-dominio.com,CORPORATE_DOMAIN=suaempresa.com.br,SUPABASE_URL=https://xxxx.supabase.co,SUPABASE_ANON_KEY=eyJ...,GCP_PROJECT_ID=seu-projeto
```

### 8.4 Atualizar o frontend

Após o deploy, copie a URL gerada pelo Cloud Run e atualize `config.js`:

```js
window.BACKEND_URL = 'https://finops-backend-xxxx-uc.a.run.app';
```

---

## 9. Rotação de chaves

Se uma chave for exposta acidentalmente:

1. Acesse **Supabase → Project Settings → API**
2. Clique em **Regenerate** na chave comprometida
3. Atualize o `backend/.env` (dev) ou o Secret Manager (prod) com a nova chave
4. Reinicie o backend

---

## Resumo de variáveis

| Variável | Onde | Obrigatória | Descrição |
|---|---|---|---|
| `GCP_CLIENT_ID` | `config.js` | Para GCP direto | OAuth2 Client ID do Google |
| `HUAWEI_ACCESS_KEY` | `config.js` | Para Huawei direto | AK da Huawei Cloud |
| `HUAWEI_SECRET_KEY` | `config.js` | Para Huawei direto | SK da Huawei Cloud |
| `HUAWEI_PROJECT_ID` | `config.js` | Para Huawei direto | Project ID da Huawei |
| `GEMINI_API_KEY` | `config.js` | Para IA | Chave da Gemini API |
| `BACKEND_URL` | `config.js` | Para modo backend | URL do backend proxy |
| `SUPABASE_URL` | `backend/.env` | Sim | URL do projeto Supabase |
| `SUPABASE_ANON_KEY` | `backend/.env` | Sim | Chave pública do Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | `backend/.env` / Secret Manager | Sim | Chave de serviço (bypass RLS) |
| `CORPORATE_DOMAIN` | `backend/.env` | Sim | Domínio corporativo para auth |
| `GCP_PROJECT_ID` | `backend/.env` | Sim | Projeto GCP do backend |
| `GOOGLE_CLIENT_ID` | `backend/.env` | Sim | OAuth2 Client ID (backend) |
