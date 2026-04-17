/**
 * Gerenciamento de segredos via Google Secret Manager (produção)
 * ou variáveis de ambiente (desenvolvimento).
 * Requirements: 3.1, 3.2, 3.4, 3.5
 */

const IS_DEV = process.env.NODE_ENV !== 'production';

/** Mapeamento de nome do segredo → variável de ambiente para modo DEV */
const DEV_ENV_MAP = {
  'huawei-ak': 'HUAWEI_AK',
  'huawei-sk': 'HUAWEI_SK',
  'gcp-service-account-json': 'GCP_SA_JSON',
  'supabase-service-role-key': 'SUPABASE_SERVICE_ROLE_KEY',
  'gemini-api-key': 'GEMINI_API_KEY',
  'google-client-secret': 'GOOGLE_CLIENT_SECRET',
};

const REQUIRED_SECRETS = Object.keys(DEV_ENV_MAP);

/** Cache em memória — nunca loga os valores */
const secretCache = new Map();

let secretManagerClient = null;

async function getSecretManagerClient() {
  if (!secretManagerClient) {
    const { SecretManagerServiceClient } = await import('@google-cloud/secret-manager');
    secretManagerClient = new SecretManagerServiceClient();
  }
  return secretManagerClient;
}

/**
 * Retorna o valor de um segredo pelo nome.
 * Em DEV: lê de process.env. Em PROD: lê do Secret Manager.
 * Usa cache em Map — nunca registra o valor em logs.
 *
 * @param {string} secretName
 * @returns {Promise<string>}
 */
export async function getSecret(secretName) {
  if (secretCache.has(secretName)) {
    return secretCache.get(secretName);
  }

  let value;

  if (IS_DEV) {
    const envVar = DEV_ENV_MAP[secretName];
    if (!envVar) {
      throw new Error(`Segredo desconhecido: ${secretName}`);
    }
    value = process.env[envVar];
    if (!value) {
      throw new Error(
        `Segredo "${secretName}" não encontrado. ` +
          `Configure a variável de ambiente ${envVar} para desenvolvimento local.`
      );
    }
  } else {
    const projectId = process.env.GCP_PROJECT_ID;
    if (!projectId) {
      throw new Error('GCP_PROJECT_ID é obrigatório para acessar o Secret Manager em produção.');
    }
    const client = await getSecretManagerClient();
    const name = `projects/${projectId}/secrets/${secretName}/versions/latest`;
    const [version] = await client.accessSecretVersion({ name });
    value = version.payload.data.toString('utf8');
  }

  secretCache.set(secretName, value);
  return value;
}

/**
 * Carrega todos os 6 segredos obrigatórios na inicialização.
 * Falha explicitamente se qualquer segredo estiver ausente.
 *
 * @returns {Promise<void>}
 */
export async function loadAllSecrets() {
  const errors = [];

  for (const secretName of REQUIRED_SECRETS) {
    try {
      await getSecret(secretName);
    } catch (err) {
      errors.push(`"${secretName}": ${err.message}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Falha ao carregar segredos obrigatórios:\n${errors.join('\n')}`
    );
  }

  console.log('[Secrets] Todos os segredos carregados com sucesso');
}
