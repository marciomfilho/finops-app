/**
 * FinOps Dashboard V2 — Huawei Cloud Adapter
 * Authenticates via AK/SK (HMAC-SHA256) and fetches billing data from Huawei BSS API.
 * Exposes a DataProvider interface compatible with DataBus.
 */

const HUAWEI_API = (() => {
  // ── Credentials (closure — never written to storage) ─────────────────────
  let _accessKey = (typeof window !== 'undefined' && window.HUAWEI_ACCESS_KEY) || '';
  let _secretKey = (typeof window !== 'undefined' && window.HUAWEI_SECRET_KEY) || '';
  let _projectId = (typeof window !== 'undefined' && window.HUAWEI_PROJECT_ID) || '';
  let _region    = (typeof window !== 'undefined' && window.HUAWEI_REGION)     || 'la-south-2';

  // ── Public id for DataBus ─────────────────────────────────────────────────
  const id = 'huawei';

  // ── Configuration ─────────────────────────────────────────────────────────

  /**
   * Stores credentials in closure variables only — never in localStorage/sessionStorage/cookies.
   * @param {{ accessKey, secretKey, projectId, region }} config
   */
  function configure({ accessKey, secretKey, projectId, region } = {}) {
    _accessKey = accessKey || '';
    _secretKey = secretKey || '';
    _projectId = projectId || '';
    _region    = region    || 'la-south-2';
  }

  /**
   * Returns true if both accessKey and secretKey are non-empty strings.
   * @returns {boolean}
   */
  function isConfigured() {
    return typeof _accessKey === 'string' && _accessKey.length > 0 &&
           typeof _secretKey === 'string' && _secretKey.length > 0;
  }

  // ── Web Crypto helpers ────────────────────────────────────────────────────

  async function sha256Hex(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function hmacSha256(key, message) {
    const keyMaterial = typeof key === 'string'
      ? await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      : await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', keyMaterial, new TextEncoder().encode(message));
    return new Uint8Array(sig);
  }

  async function hmacHex(key, message) {
    const bytes = await hmacSha256(key, message);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function deriveSigningKey(secretKey, dateStamp, region) {
    const kDate    = await hmacSha256('SDK' + secretKey, dateStamp);
    const kRegion  = await hmacSha256(kDate, region);
    const kService = await hmacSha256(kRegion, 'bss');
    return await hmacSha256(kService, 'sdk_request');
  }

  // ── Request signing ───────────────────────────────────────────────────────

  /**
   * Signs a request using Huawei Cloud SDK-HMAC-SHA256 scheme.
   * @param {string} method  HTTP method (GET, POST, …)
   * @param {string} url     Full URL including query string
   * @param {string} [body]  Request body (empty string if none)
   * @returns {Promise<{ 'X-Sdk-Date': string, 'Authorization': string, 'Content-Type': string }>}
   */
  async function signRequest(method, url, body) {
    const date      = new Date().toISOString().replace(/[:-]/g, '').replace(/\.\d{3}/, '') + 'Z';
    const dateStamp = date.slice(0, 8);

    const parsedUrl      = new URL(url);
    const canonicalUri   = parsedUrl.pathname;
    const canonicalQuery = parsedUrl.searchParams.toString();
    const payloadHash    = await sha256Hex(body || '');

    const canonicalHeaders = `content-type:application/json\nhost:${parsedUrl.host}\nx-sdk-date:${date}\n`;
    const signedHeaders    = 'content-type;host;x-sdk-date';

    const canonicalRequest = [
      method.toUpperCase(),
      canonicalUri,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      payloadHash
    ].join('\n');

    const credentialScope = `${dateStamp}/${_region}/bss/sdk_request`;
    const stringToSign    = `SDK-HMAC-SHA256\n${date}\n${credentialScope}\n${await sha256Hex(canonicalRequest)}`;
    const signingKey      = await deriveSigningKey(_secretKey, dateStamp, _region);
    const signature       = await hmacHex(signingKey, stringToSign);

    return {
      'X-Sdk-Date':    date,
      'Authorization': `SDK-HMAC-SHA256 Credential=${_accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'Content-Type':  'application/json'
    };
  }

  // ── Toast helpers ─────────────────────────────────────────────────────────

  function _showToast(message, type = 'warning') {
    const container = document.getElementById('toast-container');
    if (!container) { console.warn('[HUAWEI_API]', message); return; }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 6000);
  }

  function _showAuthError() {
    _showToast(
      'Huawei Cloud: credenciais inválidas (AK/SK). Verifique sua configuração. ' +
      'Documentação: https://support.huaweicloud.com/intl/en-us/devg-apisign/api-sign-provide.html',
      'error'
    );
  }

  function _showCorsWarning() {
    _showToast(
      'Huawei Cloud: requisição bloqueada por CORS. ' +
      'Considere importar os dados via CSV como alternativa.',
      'warning'
    );
  }

  // ── Fetch with retry ──────────────────────────────────────────────────────

  async function _fetchWithRetry(url, options, retries = 3, delays = [1000, 2000, 4000]) {
    for (let attempt = 0; attempt < retries; attempt++) {
      let response;
      try {
        response = await fetch(url, options);
      } catch (err) {
        // TypeError from fetch usually means CORS or network error
        if (err instanceof TypeError) {
          _showCorsWarning();
          return [];
        }
        throw err;
      }

      if (response.status === 429) {
        if (attempt < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, delays[attempt]));
          continue;
        }
        throw new Error('HUAWEI_RATE_LIMIT');
      }

      if (response.status === 401 || response.status === 403) {
        throw new Error('HUAWEI_AUTH_ERROR');
      }

      if (!response.ok) {
        throw new Error(`HUAWEI_HTTP_ERROR_${response.status}`);
      }

      return response.json();
    }
  }

  // ── API calls ─────────────────────────────────────────────────────────────

  /**
   * Fetches monthly billing data from Huawei BSS API.
   * @param {string} startDate  Bill cycle start (YYYY-MM)
   * @param {string} endDate    Bill cycle end (YYYY-MM) — currently unused by BSS v2
   * @returns {Promise<Array>}  Array of bill_sums entries
   */
  async function fetchBills(startDate, endDate) {
    const url = `https://bss.${_region}.myhuaweicloud.com/v2/bills/monthly-bills?bill_cycle=${startDate}&limit=100`;
    const headers = await signRequest('GET', url, '');
    const data = await _fetchWithRetry(url, { method: 'GET', headers });
    if (Array.isArray(data)) return data; // CORS fallback returned []
    return data?.bill_sums ?? [];
  }

  /**
   * Fetches metrics from Huawei CES API.
   * @param {string} projectId
   * @returns {Promise<Array>}
   */
  async function fetchMetrics(projectId) {
    const url = `https://ces.${_region}.myhuaweicloud.com/V1.0/${projectId}/metrics`;
    const headers = await signRequest('GET', url, '');
    try {
      const data = await _fetchWithRetry(url, { method: 'GET', headers });
      if (Array.isArray(data)) return data;
      return data?.metrics ?? [];
    } catch (err) {
      console.warn('[HUAWEI_API] fetchMetrics error:', err.message);
      return [];
    }
  }

  // ── Date helpers ──────────────────────────────────────────────────────────

  function _billCycleFromDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  // ── fetchData — normalises to ProviderData ────────────────────────────────

  /**
   * Fetches and normalises Huawei Cloud billing data for the given period.
   * Falls back to Huawei demo data on authentication errors.
   * @param {number} period  Number of days
   * @returns {Promise<Object>} ProviderData
   */
  async function fetchData(period = 30) {
    const endDate   = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - period);

    const startCycle = _billCycleFromDate(startDate);
    const endCycle   = _billCycleFromDate(endDate);

    try {
      const bills = await fetchBills(startCycle, endCycle);

      const projects = (Array.isArray(bills) ? bills : []).map(bill => ({
        id:           bill.resource_id || bill.cloud_service_type || `hw-${Math.random().toString(36).slice(2)}`,
        name:         bill.cloud_service_type_name || bill.resource_name || 'Serviço Huawei',
        provider:     'huawei',
        currentCost:  bill.consume_amount || 0,
        previousCost: 0,
        budget:       0,
        change:       '0.0',
        services:     [{ name: bill.cloud_service_type_name || bill.resource_name, cost: bill.consume_amount || 0 }],
        timeSeries:   []
      }));

      const currentCost = projects.reduce((sum, p) => sum + p.currentCost, 0);

      return {
        id:       'huawei',
        provider: 'huawei',
        projects,
        services:        projects.flatMap(p => p.services),
        regions:         [],
        timeline:        [],
        waste:           [],
        recommendations: [],
        budgets:         [],
        summary: {
          currentCost,
          previousCost:   0,
          budget:         0,
          totalWaste:     0,
          potentialSaving: 0,
          provider:       'huawei'
        }
      };

    } catch (err) {
      if (err && err.message === 'HUAWEI_AUTH_ERROR') {
        _showAuthError();
      } else {
        console.error('[HUAWEI_API] fetchData error:', err);
      }
      return _demoFallback(period);
    }
  }

  // ── Demo fallback ─────────────────────────────────────────────────────────

  function _demoFallback(period) {
    if (typeof DEMO_DATA !== 'undefined') {
      const demo = DEMO_DATA.generate(period);
      const hwProjects = (demo.huaweiProjects || []).map(p => ({ ...p, provider: 'huawei' }));
      const currentCost = hwProjects.reduce((s, p) => s + (p.currentCost || 0), 0);
      const previousCost = hwProjects.reduce((s, p) => s + (p.previousCost || 0), 0);
      return {
        id:       'huawei',
        provider: 'huawei',
        projects: hwProjects,
        services: hwProjects.flatMap(p => p.services || []),
        regions:  [],
        timeline: demo.huaweiTimeline || [],
        waste:    [],
        recommendations: [],
        budgets:  [],
        summary: {
          currentCost,
          previousCost,
          budget:          Math.round(currentCost * 1.2),
          totalWaste:      0,
          potentialSaving: 0,
          provider:        'huawei'
        }
      };
    }

    // Minimal fallback if DEMO_DATA is not available
    return {
      id: 'huawei', provider: 'huawei',
      projects: [], services: [], regions: [], timeline: [],
      waste: [], recommendations: [], budgets: [],
      summary: { currentCost: 0, previousCost: 0, budget: 0, totalWaste: 0, potentialSaving: 0, provider: 'huawei' }
    };
  }

  // ── Public API ────────────────────────────────────────────────────────────
  return {
    id,
    configure,
    isConfigured,
    signRequest,
    fetchBills,
    fetchMetrics,
    fetchData,
    _showAuthError,
    _showCorsWarning,
    // Expose crypto helpers for testing
    _sha256Hex:        sha256Hex,
    _hmacSha256:       hmacSha256,
    _hmacHex:          hmacHex,
    _deriveSigningKey: deriveSigningKey
  };
})();
