/**
 * FinOps Dashboard V2 — Configuration
 *
 * Para usar com dados reais da GCP:
 * 1. Crie um projeto no Google Cloud Console
 * 2. Ative as APIs: Cloud Billing API, Recommender API, Cloud Billing Budget API
 * 3. Configure o OAuth2 consent screen (External ou Internal)
 * 4. Crie credenciais OAuth2 (Web application)
 * 5. Adicione o domínio de origem autorizado
 * 6. Substitua YOUR_GOOGLE_CLIENT_ID abaixo
 *
 * Para usar com dados reais da Huawei Cloud:
 * 1. Acesse o IAM da Huawei Cloud e crie um usuário com permissão de leitura no BSS
 * 2. Gere um par de chaves AK/SK (Access Key / Secret Key)
 * 3. Preencha as variáveis HUAWEI_* abaixo
 *
 * Para usar o Agente de IA (Gemini):
 * 1. Acesse https://aistudio.google.com/app/apikey e gere uma chave
 * 2. Preencha GEMINI_API_KEY abaixo
 */

// ── Google Cloud Platform ────────────────────────────────────────────────────
// Cole aqui o Client ID gerado no Google Cloud Console
// Formato: 123456789-abcdefg.apps.googleusercontent.com
window.GCP_CLIENT_ID = '1032791868270-2foclg2vcfpuc7pvjfggf8rp1ngtk6t3.apps.googleusercontent.com';

// Opcional: ID da conta de faturamento padrão
// window.GCP_BILLING_ACCOUNT = 'billingAccounts/XXXXXX-XXXXXX-XXXXXX';

// ── Huawei Cloud ─────────────────────────────────────────────────────────────
// Access Key e Secret Key gerados no IAM da Huawei Cloud
window.HUAWEI_ACCESS_KEY = '';
window.HUAWEI_SECRET_KEY = '';

// ID do projeto Huawei Cloud (encontrado em "My Credentials" no console)
window.HUAWEI_PROJECT_ID = '';

// Região padrão da Huawei Cloud (ex: la-south-2, sa-brazil-1)
window.HUAWEI_REGION = 'la-south-2';

// ── Google Gemini AI ─────────────────────────────────────────────────────────
// Chave da API Gemini — obtenha em https://aistudio.google.com/app/apikey
window.GEMINI_API_KEY = '';

// ── Backend Proxy ─────────────────────────────────────────────────────────────
// URL do backend proxy (Cloud Run). Deixe vazio para usar apenas dados demo/diretos.
// Exemplo: 'https://finops-backend-XXXX-uc.a.run.app'
window.BACKEND_URL = 'http://localhost:8080';
