/**
 * Configuração de variáveis de ambiente não sensíveis.
 * Valida variáveis obrigatórias na inicialização e exporta objeto ENV com defaults.
 * Requirements: 12.2, 3.6
 */

const REQUIRED_VARS = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'GCP_PROJECT_ID',
  'GOOGLE_CLIENT_ID',
];

function validateEnv() {
  const missing = REQUIRED_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Variáveis de ambiente obrigatórias ausentes: ${missing.join(', ')}. ` +
        'Configure essas variáveis antes de iniciar o servidor.'
    );
  }
}

validateEnv();

export const ENV = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '8080', 10),
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',
  CORPORATE_DOMAIN: process.env.CORPORATE_DOMAIN || 'exa.com.br',
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  GCP_PROJECT_ID: process.env.GCP_PROJECT_ID,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:8080/auth/callback',
  RAG_SIMILARITY_THRESHOLD: parseFloat(process.env.RAG_SIMILARITY_THRESHOLD || '0.75'),
  RAG_MAX_CHUNKS: parseInt(process.env.RAG_MAX_CHUNKS || '10', 10),
  RAG_MAX_TOKENS: parseInt(process.env.RAG_MAX_TOKENS || '8000', 10),
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX || '60', 10),
};
