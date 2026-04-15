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

  return {
    signIn,
    signOut,
    handleRedirectCallback,
    getUserInfo,
    isAuthenticated,
    getBillingAccounts,
    getProjects,
    getCostData,
    getRecommendations,
    getBudgets,
    get currentUser() { return currentUser; },
    get hasClientId() { return !!CLIENT_ID; }
  };
})();

// ── DEMO DATA GENERATOR ──────────────────────────────────────────────────────
const DEMO_DATA = (() => {
  const projects = [
    { id: 'prod-ecommerce-441', name: 'E-Commerce Produção', env: 'production' },
    { id: 'data-analytics-882', name: 'Data Analytics', env: 'production' },
    { id: 'ml-platform-219', name: 'ML Platform', env: 'production' },
    { id: 'dev-sandbox-773', name: 'Dev Sandbox', env: 'development' },
    { id: 'infra-shared-115', name: 'Infra Compartilhada', env: 'shared' },
    { id: 'marketing-tools-334', name: 'Marketing Tools', env: 'production' },
    { id: 'staging-env-667', name: 'Staging Environment', env: 'staging' },
    { id: 'legacy-migration-990', name: 'Legacy Migration', env: 'development' }
  ];

  const services = ['Compute Engine', 'Cloud Storage', 'BigQuery', 'Cloud SQL', 'Kubernetes Engine', 'Cloud Run', 'Pub/Sub', 'Cloud Functions', 'Networking', 'Cloud Spanner'];
  const regions = ['us-central1', 'us-east1', 'europe-west1', 'asia-east1', 'southamerica-east1'];

  function rand(min, max) { return Math.random() * (max - min) + min; }
  function randInt(min, max) { return Math.floor(rand(min, max)); }

  function generateTimeSeries(days, baseCost, trend = 0.02) {
    const series = [];
    let cost = baseCost;
    const now = new Date();
    for (let i = days; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      cost = cost * (1 + trend * (Math.random() - 0.4)) + rand(-50, 50);
      cost = Math.max(cost, baseCost * 0.5);
      series.push({ date: date.toISOString().split('T')[0], cost: Math.round(cost * 100) / 100 });
    }
    return series;
  }

  function generate(days = 30) {
    const totalBase = 48500;
    const prevTotal = totalBase * rand(0.88, 0.95);
    const currTotal = totalBase * rand(1.02, 1.12);

    const projectData = projects.map((p, i) => {
      const share = [0.28, 0.22, 0.18, 0.08, 0.09, 0.07, 0.05, 0.03][i];
      const curr = currTotal * share * rand(0.9, 1.1);
      const prev = curr * rand(0.85, 1.15);
      const budget = curr * rand(1.05, 1.4);
      return {
        ...p,
        currentCost: Math.round(curr),
        previousCost: Math.round(prev),
        budget: Math.round(budget),
        change: ((curr - prev) / prev * 100).toFixed(1),
        services: services.slice(0, randInt(2, 6)).map(s => ({
          name: s,
          cost: Math.round(curr * rand(0.05, 0.4))
        })),
        timeSeries: generateTimeSeries(days, curr / days * rand(0.8, 1.2))
      };
    });

    const serviceBreakdown = services.map(s => ({
      name: s,
      cost: Math.round(currTotal * rand(0.03, 0.22))
    })).sort((a, b) => b.cost - a.cost);

    const regionBreakdown = regions.map(r => ({
      name: r,
      cost: Math.round(currTotal * rand(0.05, 0.35))
    })).sort((a, b) => b.cost - a.cost);

    const timeline = generateTimeSeries(days, currTotal / days);

    const wasteItems = [
      {
        category: 'Instâncias Ociosas',
        icon: '🖥️',
        color: 'red',
        totalWaste: 8420,
        items: [
          { name: 'n2-standard-8 (prod-ecommerce)', project: 'prod-ecommerce-441', cost: 2840, reason: 'CPU < 2% por 30 dias', action: 'Desligar' },
          { name: 'n1-highmem-16 (data-analytics)', project: 'data-analytics-882', cost: 2100, reason: 'Sem tráfego há 45 dias', action: 'Desligar' },
          { name: 'e2-standard-4 (dev-sandbox)', project: 'dev-sandbox-773', cost: 1840, reason: 'Ambiente de dev parado', action: 'Desligar' },
          { name: 'n2-standard-4 (staging)', project: 'staging-env-667', cost: 1640, reason: 'CPU < 1% por 60 dias', action: 'Desligar' }
        ]
      },
      {
        category: 'Discos Não Utilizados',
        icon: '💾',
        color: 'yellow',
        totalWaste: 3180,
        items: [
          { name: 'disk-backup-prod-01 (500GB)', project: 'prod-ecommerce-441', cost: 1200, reason: 'Não anexado a nenhuma VM', action: 'Excluir' },
          { name: 'disk-old-migration (1TB)', project: 'legacy-migration-990', cost: 980, reason: 'Snapshot de 8 meses atrás', action: 'Excluir' },
          { name: 'disk-staging-data (250GB)', project: 'staging-env-667', cost: 600, reason: 'Projeto inativo', action: 'Excluir' },
          { name: 'disk-ml-training (200GB)', project: 'ml-platform-219', cost: 400, reason: 'Dados de treino antigos', action: 'Arquivar' }
        ]
      },
      {
        category: 'IPs Estáticos Não Usados',
        icon: '🌐',
        color: 'orange',
        totalWaste: 1260,
        items: [
          { name: '34.95.112.44 (us-central1)', project: 'prod-ecommerce-441', cost: 420, reason: 'IP reservado sem VM', action: 'Liberar' },
          { name: '35.198.44.12 (europe-west1)', project: 'infra-shared-115', cost: 420, reason: 'IP reservado sem VM', action: 'Liberar' },
          { name: '34.83.22.91 (us-east1)', project: 'marketing-tools-334', cost: 420, reason: 'IP reservado sem VM', action: 'Liberar' }
        ]
      },
      {
        category: 'Cloud SQL Superdimensionado',
        icon: '🗄️',
        color: 'red',
        totalWaste: 5640,
        items: [
          { name: 'prod-mysql-db1 (db-n1-standard-8)', project: 'prod-ecommerce-441', cost: 2800, reason: 'Uso médio de CPU: 8%', action: 'Redimensionar' },
          { name: 'analytics-postgres (db-n1-highmem-4)', project: 'data-analytics-882', cost: 1840, reason: 'Uso médio de CPU: 12%', action: 'Redimensionar' },
          { name: 'staging-mysql (db-n1-standard-4)', project: 'staging-env-667', cost: 1000, reason: 'Uso médio de CPU: 5%', action: 'Redimensionar' }
        ]
      },
      {
        category: 'Snapshots Antigos',
        icon: '📸',
        color: 'yellow',
        totalWaste: 2100,
        items: [
          { name: 'snapshot-prod-2024-01 (800GB)', project: 'prod-ecommerce-441', cost: 960, reason: 'Snapshot com +180 dias', action: 'Excluir' },
          { name: 'snapshot-ml-data (600GB)', project: 'ml-platform-219', cost: 720, reason: 'Snapshot com +90 dias', action: 'Excluir' },
          { name: 'snapshot-legacy (350GB)', project: 'legacy-migration-990', cost: 420, reason: 'Projeto encerrado', action: 'Excluir' }
        ]
      },
      {
        category: 'Load Balancers Ociosos',
        icon: '⚖️',
        color: 'orange',
        totalWaste: 1440,
        items: [
          { name: 'lb-old-api-gateway', project: 'legacy-migration-990', cost: 720, reason: 'Zero requisições há 60 dias', action: 'Remover' },
          { name: 'lb-staging-frontend', project: 'staging-env-667', cost: 720, reason: 'Zero requisições há 45 dias', action: 'Remover' }
        ]
      }
    ];

    const recommendations = [
      { id: 1, priority: 'critical', category: 'compute', title: 'Redimensionar instâncias superdimensionadas', description: 'Identificamos 12 instâncias Compute Engine com utilização de CPU abaixo de 10% nos últimos 30 dias. Redimensionar para tipos menores pode gerar economia imediata.', saving: 6840, effort: 'Baixo', impact: 'Alto', projects: ['prod-ecommerce-441', 'data-analytics-882'], timeToImplement: '1-2 dias' },
      { id: 2, priority: 'critical', category: 'database', title: 'Otimizar instâncias Cloud SQL', description: '3 instâncias Cloud SQL estão superdimensionadas com uso médio de CPU abaixo de 15%. Migrar para tipos menores ou usar Cloud SQL serverless.', saving: 5640, effort: 'Médio', impact: 'Alto', projects: ['prod-ecommerce-441', 'data-analytics-882'], timeToImplement: '2-4 dias' },
      { id: 3, priority: 'high', category: 'compute', title: 'Desligar instâncias completamente ociosas', description: '4 instâncias VM não recebem tráfego há mais de 30 dias. Recomendamos desligamento imediato ou conversão para instâncias preemptivas.', saving: 8420, effort: 'Baixo', impact: 'Alto', projects: ['prod-ecommerce-441', 'dev-sandbox-773'], timeToImplement: '< 1 dia' },
      { id: 4, priority: 'high', category: 'storage', title: 'Implementar políticas de lifecycle no Cloud Storage', description: 'Buckets sem política de lifecycle configurada estão acumulando dados antigos em classes de armazenamento caras. Mover para Nearline/Coldline pode reduzir custos em 70%.', saving: 3200, effort: 'Baixo', impact: 'Médio', projects: ['data-analytics-882', 'ml-platform-219'], timeToImplement: '< 1 dia' },
      { id: 5, priority: 'high', category: 'compute', title: 'Usar Committed Use Discounts (CUD)', description: 'Com base no uso histórico, comprometer-se com 1 ano de uso para as principais instâncias pode gerar desconto de até 37% nos custos de Compute Engine.', saving: 12400, effort: 'Baixo', impact: 'Alto', projects: ['prod-ecommerce-441', 'ml-platform-219', 'data-analytics-882'], timeToImplement: '< 1 dia' },
      { id: 6, priority: 'medium', category: 'network', title: 'Otimizar transferência de dados entre regiões', description: 'Alto volume de tráfego entre regiões detectado. Considere replicar dados críticos para reduzir latência e custos de egress.', saving: 2800, effort: 'Alto', impact: 'Médio', projects: ['infra-shared-115'], timeToImplement: '1-2 semanas' },
      { id: 7, priority: 'medium', category: 'compute', title: 'Migrar workloads para Spot VMs', description: 'Workloads de batch e ML podem ser executados em Spot VMs com economia de até 80%. Identificamos 5 jobs elegíveis.', saving: 4200, effort: 'Médio', impact: 'Alto', projects: ['ml-platform-219', 'data-analytics-882'], timeToImplement: '3-5 dias' },
      { id: 8, priority: 'medium', category: 'storage', title: 'Excluir snapshots e discos não utilizados', description: 'Encontramos 7 discos persistentes não anexados e 3 snapshots com mais de 90 dias que podem ser removidos com segurança.', saving: 5280, effort: 'Baixo', impact: 'Médio', projects: ['prod-ecommerce-441', 'legacy-migration-990'], timeToImplement: '< 1 dia' },
      { id: 9, priority: 'low', category: 'other', title: 'Consolidar projetos de desenvolvimento', description: 'Os projetos dev-sandbox e staging-env têm padrões de uso similares. Consolidar em um único ambiente pode reduzir overhead operacional e custos.', saving: 1800, effort: 'Alto', impact: 'Baixo', projects: ['dev-sandbox-773', 'staging-env-667'], timeToImplement: '2-4 semanas' },
      { id: 10, priority: 'low', category: 'network', title: 'Liberar IPs estáticos não utilizados', description: '3 endereços IP estáticos estão reservados sem uso. Cada IP custa ~$7.20/mês quando não associado a recursos.', saving: 1260, effort: 'Baixo', impact: 'Baixo', projects: ['prod-ecommerce-441', 'infra-shared-115'], timeToImplement: '< 1 dia' }
    ];

    const totalWaste = wasteItems.reduce((s, w) => s + w.totalWaste, 0);
    const totalSaving = recommendations.reduce((s, r) => s + r.saving, 0);

    return {
      summary: {
        currentMonthCost: Math.round(currTotal),
        previousMonthCost: Math.round(prevTotal),
        projectedCost: Math.round(currTotal * rand(1.03, 1.08)),
        totalBudget: Math.round(currTotal * rand(1.1, 1.3)),
        totalWaste,
        potentialSaving: totalSaving,
        wastePercent: ((totalWaste / currTotal) * 100).toFixed(1),
        savingPercent: ((totalSaving / currTotal) * 100).toFixed(1),
        activeProjects: projects.length,
        activeServices: services.length
      },
      projects: projectData,
      services: serviceBreakdown,
      regions: regionBreakdown,
      timeline,
      waste: wasteItems,
      recommendations,
      user: { name: 'Demo User', email: 'demo@empresa.com.br', org: 'Empresa Demo Ltda', picture: null }
    };
  }

  return { generate };
})();
