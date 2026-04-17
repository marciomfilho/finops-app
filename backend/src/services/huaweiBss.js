/**
 * Cliente Huawei BSS API com autenticação HMAC-SHA256 (AK/SK).
 * Em DEV: retorna mock data sem exigir credenciais reais.
 * Em PROD: obtém AK/SK do Secret Manager.
 * Requirements: 2.2, 4.4, 11.1
 */

import { createHmac, createHash } from 'crypto';
import { ENV } from '../config/env.js';
import { getSecret } from '../config/secrets.js';

const IS_DEV = ENV.NODE_ENV !== 'production';

const HUAWEI_BSS_HOST = 'bss.myhuaweicloud.com';
const HUAWEI_BSS_ENDPOINT = `https://${HUAWEI_BSS_HOST}`;
const PAGE_SIZE = 100;

/**
 * Utilitário de retry com backoff exponencial.
 * Tenta novamente em erros 5xx e timeouts.
 * @param {Function} fn
 * @param {number} maxAttempts
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
        `[HuaweiBSS] Tentativa ${attempt}/${maxAttempts} falhou: ${err.message}. Aguardando ${delay}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Faz uma requisição autenticada à Huawei BSS API usando HMAC-SHA256.
 * @param {string} ak - Access Key
 * @param {string} sk - Secret Key
 * @param {string} method - HTTP method
 * @param {string} path - URL path
 * @param {Object} queryParams - Query parameters
 * @param {Object|null} body - Request body
 * @returns {Promise<Object>}
 */
async function huaweiRequest(ak, sk, method, path, queryParams = {}, body = null) {
  const now = new Date();
  // Format: yyyyMMddTHHmmssZ
  const datetime = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const date = datetime.slice(0, 8);

  const bodyStr = body ? JSON.stringify(body) : '';
  const hashedPayload = createHash('sha256').update(bodyStr).digest('hex');

  // Canonical query string (sorted by key)
  const sortedQuery = Object.keys(queryParams)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
    .join('&');

  const canonicalHeaders =
    `content-type:application/json\n` +
    `host:${HUAWEI_BSS_HOST}\n` +
    `x-sdk-date:${datetime}\n`;
  const signedHeaders = 'content-type;host;x-sdk-date';

  const canonicalRequest = [
    method.toUpperCase(),
    path,
    sortedQuery,
    canonicalHeaders,
    signedHeaders,
    hashedPayload,
  ].join('\n');

  const stringToSign = [
    'SDK-HMAC-SHA256',
    datetime,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const signingKey = createHmac('sha256', sk).update(date).digest();
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authorization = `SDK-HMAC-SHA256 Access=${ak}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const queryString = sortedQuery ? `?${sortedQuery}` : '';
  const url = `${HUAWEI_BSS_ENDPOINT}${path}${queryString}`;

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Host: HUAWEI_BSS_HOST,
      'X-Sdk-Date': datetime,
      Authorization: authorization,
    },
    ...(bodyStr ? { body: bodyStr } : {}),
  });

  if (!res.ok) {
    const err = new Error(`Huawei BSS API error: ${res.status} ${res.statusText}`);
    err.status = res.status;
    throw err;
  }

  return res.json();
}

/**
 * Busca dados de billing da Huawei BSS API com paginação.
 * @param {string} startDate - Formato YYYY-MM
 * @param {string} endDate - Formato YYYY-MM (não usado diretamente pela API, mas aceito para compatibilidade)
 * @param {string} [region] - Região Huawei (opcional)
 * @returns {Promise<Object>} { bill_sums: [] }
 */
export async function fetchBills(startDate, endDate, region) {
  if (IS_DEV) {
    console.warn(
      '[HuaweiBSS] Modo DEV: retornando mock data. Configure AK/SK para dados reais.'
    );
    return { bill_sums: [] };
  }

  return withRetry(async () => {
    const ak = await getSecret('huawei-ak');
    const sk = await getSecret('huawei-sk');

    const allBillSums = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const queryParams = {
        bill_cycle: startDate,
        offset: String(offset),
        limit: String(PAGE_SIZE),
      };

      if (region) queryParams.region = region;

      const data = await huaweiRequest(
        ak,
        sk,
        'GET',
        '/v2/bills/monthly-bills/res-summary',
        queryParams
      );

      const billSums = data.bill_sums || [];
      allBillSums.push(...billSums);

      // Verifica se há mais páginas
      const total = data.total_count ?? billSums.length;
      offset += billSums.length;
      hasMore = billSums.length === PAGE_SIZE && offset < total;
    }

    return { bill_sums: allBillSums };
  });
}
