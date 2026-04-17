/**
 * Cliente GCP Cloud Billing API.
 * Em DEV: retorna mock data sem exigir credenciais reais.
 * Em PROD: autentica com service account JSON do Secret Manager.
 * Requirements: 2.2, 11.1
 */

import { ENV } from '../config/env.js';
import { getSecret } from '../config/secrets.js';

const IS_DEV = ENV.NODE_ENV !== 'production';

/**
 * Utilitário de retry com backoff exponencial.
 * Tenta novamente em erros 5xx e timeouts.
 * @param {Function} fn - Função assíncrona a executar
 * @param {number} maxAttempts - Número máximo de tentativas (padrão: 5)
 * @returns {Promise<any>}
 */
export async function withRetry(fn, maxAttempts = 5) {
  const delays = [1000, 2000, 4000, 8000, 16000];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRetryable =
        (err.status !== undefined && err.status >= 500) ||
        err.code === 'ETIMEDOUT' ||
        err.code === 'ECONNRESET' ||
        err.message?.includes('timeout') ||
        err.message?.includes('ETIMEDOUT');

      if (!isRetryable || attempt === maxAttempts) {
        throw err;
      }

      const delay = delays[attempt - 1] ?? 16000;
      console.warn(
        `[GCPBilling] Tentativa ${attempt}/${maxAttempts} falhou: ${err.message}. Aguardando ${delay}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Busca dados de billing da GCP Cloud Billing API.
 * @param {string} billingAccountId - ID da conta de billing GCP
 * @param {string} periodStart - ISO 8601
 * @param {string} periodEnd - ISO 8601
 * @returns {Promise<Object>} Resposta da API no formato { rows: [] }
 */
export async function fetchBillingData(billingAccountId, periodStart, periodEnd) {
  if (IS_DEV) {
    console.warn(
      '[GCPBilling] Modo DEV: retornando mock data. Configure credenciais GCP para dados reais.'
    );
    return { rows: [] };
  }

  return withRetry(async () => {
    const saJson = await getSecret('gcp-service-account-json');
    const serviceAccount = JSON.parse(saJson);

    // Obtém access token via JWT do service account
    const accessToken = await getGCPAccessToken(serviceAccount);

    const url =
      `https://cloudbilling.googleapis.com/v1/billingAccounts/${billingAccountId}/` +
      `skus?startTime=${encodeURIComponent(periodStart)}&endTime=${encodeURIComponent(periodEnd)}`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const err = new Error(`GCP Billing API error: ${res.status} ${res.statusText}`);
      err.status = res.status;
      throw err;
    }

    return res.json();
  });
}

/**
 * Obtém access token do GCP usando service account JWT.
 * @param {Object} serviceAccount - Objeto JSON do service account
 * @returns {Promise<string>} Access token
 */
async function getGCPAccessToken(serviceAccount) {
  const { createSign } = await import('crypto');

  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-billing.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  ).toString('base64url');

  const signingInput = `${header}.${payload}`;
  const sign = createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = sign.sign(serviceAccount.private_key, 'base64url');

  const jwt = `${signingInput}.${signature}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!tokenRes.ok) {
    const err = new Error(`GCP token error: ${tokenRes.status}`);
    err.status = tokenRes.status;
    throw err;
  }

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}
