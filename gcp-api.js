/**
 * GCP Billing API Integration
 * Handles OAuth2 + Cloud Billing API + Recommender API
 */

const GCP_API = (() => {
  const CLIENT_ID = (window.GCP_CLIENT_ID && window.GCP_CLIENT_ID !== 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com')
    ? window.GCP_CLIENT_ID : null;

  const SCOPES = [
    'https://www.googleapis.com/auth/cloud-billing.readonly',
    'https://www.googleapis.com/auth/cloud-platform.read-only',
    'https://www.googleapis.com/auth/recommender.readonly',
    'profile', 'email'
  ].join(' ');

  let accessToken = null;
  let tokenExpiry = null;
  let currentUser = null;

  // ── OAuth2 — implicit flow via redirect ──────────────────────────────────
  function signIn() {
    if (!CLIENT_ID) {
      return Promise.reject(new Error('CLIENT_ID não configurado. Edite config.js com seu Google Client ID.'));
    }
    // Salva a página atual para retornar após auth
    sessionStorage.setItem('finops_return', window.location.href);

    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: window.location.origin + window.location.pathname,
      response_type: 'token',
      scope: SCOPES,
      prompt: 'select_account'
    });
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    // Retorna uma promise que nunca resolve (página vai redirecionar)
    return new Promise(() => {});
  }

  // Chame isso no carregamento da página para capturar o token do redirect
  function handleRedirectCallback() {
    const hash = window.location.hash;
    if (!hash.includes('access_token')) return false;
    const params = new URLSearchParams(hash.slice(1));
    accessToken = params.get('access_token');
    const expiresIn = parseInt(params.get('expires_in') || '3600');
    tokenExpiry = Date.now() + expiresIn * 1000;
    // Limpa o hash da URL
    history.replaceState(null, '', window.location.pathname);
    return true;
  }

  async function getUserInfo() {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) throw new Error('Falha ao obter informações do usuário');
    currentUser = await res.json();
    return currentUser;
  }

  function signOut() {
    accessToken = null;
    tokenExpiry = null;
    currentUser = null;
  }

  function isAuthenticated() {
    return !!(accessToken && Date.now() < tokenExpiry);
  }

  // ── Billing API ─────────────────────────────────────────────────────────────
  async function apiFetch(url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`API Error ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async function getBillingAccounts() {
    const data = await apiFetch('https://cloudbilling.googleapis.com/v1/billingAccounts');
    return data.billingAccounts || [];
  }

  async function getProjects(billingAccountId) {
    const data = await apiFetch(
      `https://cloudbilling.googleapis.com/v1/${billingAccountId}/projects`
    );
    return data.projectBillingInfo || [];
  }

  async function getCostData(billingAccountId, startDate, endDate) {
    const body = {
      query: {
        dateRange: {
          startDate: { year: startDate.getFullYear(), month: startDate.getMonth() + 1, day: startDate.getDate() },
          endDate:   { year: endDate.getFullYear(),   month: endDate.getMonth() + 1,   day: endDate.getDate() }
        },
        groupBy: ['PROJECT_ID', 'SERVICE_DESCRIPTION', 'SKU_DESCRIPTION']
      }
    };
    const res = await fetch(
      `https://cloudbilling.googleapis.com/v1beta/${billingAccountId}:queryBillingData`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    );
    if (!res.ok) throw new Error(`Billing query error: ${res.status}`);
    return res.json();
  }

  async function getRecommendations(projectId) {
    const recommenders = [
      'google.compute.instance.MachineTypeRecommender',
      'google.compute.disk.IdleResourceRecommender',
      'google.compute.instance.IdleResourceRecommender',
      'google.cloudsql.instance.IdleRecommender',
      'google.cloudsql.instance.OverprovisionedRecommender'
    ];
    const results = [];
    for (const rec of recommenders) {
      try {
        const data = await apiFetch(
          `https://recommender.googleapis.com/v1/projects/${projectId}/locations/-/recommenders/${rec}/recommendations`
        );
        if (data.recommendations) results.push(...data.recommendations);
      } catch (e) { console.warn('Recommender skip:', e.message); }
    }
    return results;
  }

  async function getBudgets(billingAccountId) {
    const data = await apiFetch(
      `https://billingbudgets.googleapis.com/v1/${billingAccountId}/budgets`
    );
    return data.budgets || [];
  }

  // ── DataProvider interface ──────────────────────────────────────────────────

  function isConfigured() {
    // True if CLIENT_ID configured + authenticated, OR if no CLIENT_ID but token exists (compatibility)
    return isAuthenticated();
  }

  async function fetchData(period = 30) {
    if (!isAuthenticated()) {
      return _gcpDemoFallback(period);
    }
    try {
      const accounts = await getBillingAccounts();
      if (!accounts.length) return _gcpDemoFallback(period);

      const billingId = accounts[0].name;
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - period);

      const [costData, budgets] = await Promise.all([
        getCostData(billingId, startDate, endDate),
        getBudgets(billingId)
      ]);

      return _normalizeToProviderData(costData, budgets, period);
    } catch (err) {
      console.error('[GCP_API] fetchData error:', err);
      return _gcpDemoFallback(period);
    }
  }

  function _normalizeToProviderData(costData, budgets, period) {
    const rows = costData.rows || [];
    if (!rows.length) return _gcpDemoFallback(period);

    const projectMap = new Map();
    for (const row of rows) {
      const projectId = row.project_id || row.dimensions?.project_id || 'unknown';
      const cost = parseFloat(row.cost || row.amount || 0);
      if (!projectMap.has(projectId)) {
        projectMap.set(projectId, { id: projectId, name: projectId, provider: 'gcp', currentCost: 0, previousCost: 0, budget: 0 });
      }
      projectMap.get(projectId).currentCost += cost;
    }

    const projects = Array.from(projectMap.values()).map(p => ({
      ...p,
      currentCost: Math.round(p.currentCost),
      change: '0.0',
      services: [],
      timeSeries: []
    }));

    const currentCost = projects.reduce((s, p) => s + (p.currentCost || 0), 0);

    return {
      id: 'gcp',
      provider: 'gcp',
      projects,
      services: [],
      regions: [],
      timeline: [],
      waste: [],
      recommendations: [],
      budgets: budgets || [],
      summary: {
        currentCost,
        previousCost: 0,
        budget: 0,
        totalWaste: 0,
        potentialSaving: 0,
        provider: 'gcp'
      }
    };
  }

  function _gcpDemoFallback(period) {
    if (typeof DEMO_DATA !== 'undefined') {
      const demo = DEMO_DATA.generate(period);
      const gcpProjects = (demo.projects || []).map(p => ({ ...p, provider: 'gcp' }));
      const currentCost = gcpProjects.reduce((s, p) => s + (p.currentCost || 0), 0);
      return {
        id: 'gcp', provider: 'gcp',
        projects: gcpProjects,
        services: demo.services || [],
        regions: demo.regions || [],
        timeline: demo.timeline || [],
        waste: demo.waste || [],
        recommendations: demo.recommendations || [],
        budgets: [],
        summary: {
          currentCost,
          previousCost: demo.summary?.previousMonthCost || 0,
          budget: demo.summary?.totalBudget || 0,
          totalWaste: demo.summary?.totalWaste || 0,
          potentialSaving: demo.summary?.potentialSaving || 0,
          provider: 'gcp'
        }
      };
    }
    return {
      id: 'gcp', provider: 'gcp',
      projects: [], services: [], regions: [], timeline: [], waste: [], recommendations: [], budgets: [],
      summary: { currentCost: 0, previousCost: 0, budget: 0, totalWaste: 0, potentialSaving: 0, provider: 'gcp' }
    };
  }

  return {
    id: 'gcp',
    signIn,
    signOut,
    handleRedirectCallback,
    getUserInfo,
    isAuthenticated,
    isConfigured,
    fetchData,
    getBillingAccounts,
    getProjects,
    getCostData,
    getRecommendations,
    getBudgets,
    get currentUser() { return currentUser; },
    get hasClientId() { return !!CLIENT_ID; }
  };
})();



