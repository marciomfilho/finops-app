/**
 * GCP FinOps Dashboard — Configuration
 *
 * Para usar com dados reais da GCP:
 * 1. Crie um projeto no Google Cloud Console
 * 2. Ative as APIs: Cloud Billing API, Recommender API, Cloud Billing Budget API
 * 3. Configure o OAuth2 consent screen (External ou Internal)
 * 4. Crie credenciais OAuth2 (Web application)
 * 5. Adicione o domínio de origem autorizado
 * 6. Substitua YOUR_GOOGLE_CLIENT_ID abaixo
 */

// Cole aqui o Client ID gerado no Google Cloud Console
// Formato: 123456789-abcdefg.apps.googleusercontent.com
window.GCP_CLIENT_ID = 'SEU_CLIENT_ID_AQUI.apps.googleusercontent.com';

// Opcional: ID da conta de faturamento padrão
// window.GCP_BILLING_ACCOUNT = 'billingAccounts/XXXXXX-XXXXXX-XXXXXX';
