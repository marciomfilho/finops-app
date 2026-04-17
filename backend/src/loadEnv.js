/**
 * Carrega variáveis do arquivo .env antes de qualquer outro módulo.
 * Deve ser o primeiro import em server.js via --import flag ou import direto.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

if (process.env.NODE_ENV !== 'production') {
  try {
    const envPath = resolve(__dirname, '../../.env');
    const envContent = readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
    console.log('[loadEnv] .env carregado com sucesso');
  } catch {
    // .env não encontrado — ignora silenciosamente em produção
  }
}
