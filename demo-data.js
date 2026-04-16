/**
 * FinOps Dashboard — Demo Data Generator
 * Provides realistic demo data for GCP and Huawei Cloud providers.
 * Used as fallback when no real provider is configured.
 */

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

  // Huawei Cloud demo projects
  const huaweiProjects = [
    { id: 'hw-ecs-prod-001', name: 'ECS Produção', env: 'production', service: 'ECS' },
    { id: 'hw-obs-storage-002', name: 'OBS Storage', env: 'production', service: 'OBS' },
    { id: 'hw-rds-database-003', name: 'RDS Database', env: 'production', service: 'RDS' },
    { id: 'hw-cce-cluster-004', name: 'CCE Kubernetes', env: 'production', service: 'CCE' },
    { id: 'hw-dev-sandbox-005', name: 'Dev Sandbox HW', env: 'development', service: 'ECS' }
  ];

  const huaweiServices = ['ECS', 'OBS', 'RDS', 'CCE', 'VPC', 'ELB', 'DCS', 'DMS'];
  const huaweiRegions = ['la-south-2', 'sa-brazil-1', 'ap-southeast-1', 'cn-north-4'];

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
    // ── GCP data ──────────────────────────────────────────────────────────────
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
        provider: 'gcp',
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

    // ── Huawei Cloud data ─────────────────────────────────────────────────────
    const hwTotalBase = 18500;
    const hwPrevTotal = hwTotalBase * rand(0.88, 0.95);
    const hwCurrTotal = hwTotalBase * rand(1.02, 1.12);

    const hwShares = [0.35, 0.20, 0.22, 0.15, 0.08];
    const huaweiProjectData = huaweiProjects.map((p, i) => {
      const curr = hwCurrTotal * hwShares[i] * rand(0.9, 1.1);
      const prev = curr * rand(0.85, 1.15);
      const budget = curr * rand(1.05, 1.4);
      return {
        ...p,
        provider: 'huawei',
        currentCost: Math.round(curr),
        previousCost: Math.round(prev),
        budget: Math.round(budget),
        change: ((curr - prev) / prev * 100).toFixed(1),
        services: huaweiServices.slice(0, randInt(1, 4)).map(s => ({
          name: s,
          cost: Math.round(curr * rand(0.05, 0.4))
        })),
        timeSeries: generateTimeSeries(days, curr / days * rand(0.8, 1.2))
      };
    });

    const huaweiTimeline = generateTimeSeries(days, hwCurrTotal / days);

    // ── Waste items ───────────────────────────────────────────────────────────
    const wasteItems = [
      {
        category: 'Instâncias Ociosas',
        icon: '🖥️',
        color: 'red',
        totalWaste: 8420,
        items: [
          { name: 'n2-standard-8 (prod-ecommerce)', project: 'prod-ecommerce-441', provider: 'gcp', cost: 2840, reason: 'CPU < 2% por 30 dias', action: 'Desligar' },
          { name: 'n1-highmem-16 (data-analytics)', project: 'data-analytics-882', provider: 'gcp', cost: 2100, reason: 'Sem tráfego há 45 dias', action: 'Desligar' },
          { name: 'e2-standard-4 (dev-sandbox)', project: 'dev-sandbox-773', provider: 'gcp', cost: 1840, reason: 'Ambiente de dev parado', action: 'Desligar' },
          { name: 'n2-standard-4 (staging)', project: 'staging-env-667', provider: 'gcp', cost: 1640, reason: 'CPU < 1% por 60 dias', action: 'Desligar' }
        ]
      },
      {
        category: 'Discos Não Utilizados',
        icon: '💾',
        color: 'yellow',
        totalWaste: 3180,
        items: [
          { name: 'disk-backup-prod-01 (500GB)', project: 'prod-ecommerce-441', provider: 'gcp', cost: 1200, reason: 'Não anexado a nenhuma VM', action: 'Excluir' },
          { name: 'disk-old-migration (1TB)', project: 'legacy-migration-990', provider: 'gcp', cost: 980, reason: 'Snapshot de 8 meses atrás', action: 'Excluir' },
          { name: 'disk-staging-data (250GB)', project: 'staging-env-667', provider: 'gcp', cost: 600, reason: 'Projeto inativo', action: 'Excluir' },
          { name: 'disk-ml-training (200GB)', project: 'ml-platform-219', provider: 'gcp', cost: 400, reason: 'Dados de treino antigos', action: 'Arquivar' }
        ]
      },
      {
        category: 'IPs Estáticos Não Usados',
        icon: '🌐',
        color: 'orange',
        totalWaste: 1260,
        items: [
          { name: '34.95.112.44 (us-central1)', project: 'prod-ecommerce-441', provider: 'gcp', cost: 420, reason: 'IP reservado sem VM', action: 'Liberar' },
          { name: '35.198.44.12 (europe-west1)', project: 'infra-shared-115', provider: 'gcp', cost: 420, reason: 'IP reservado sem VM', action: 'Liberar' },
          { name: '34.83.22.91 (us-east1)', project: 'marketing-tools-334', provider: 'gcp', cost: 420, reason: 'IP reservado sem VM', action: 'Liberar' }
        ]
      },
      {
        category: 'Cloud SQL Superdimensionado',
        icon: '🗄️',
        color: 'red',
        totalWaste: 5640,
        items: [
          { name: 'prod-mysql-db1 (db-n1-standard-8)', project: 'prod-ecommerce-441', provider: 'gcp', cost: 2800, reason: 'Uso médio de CPU: 8%', action: 'Redimensionar' },
          { name: 'analytics-postgres (db-n1-highmem-4)', project: 'data-analytics-882', provider: 'gcp', cost: 1840, reason: 'Uso médio de CPU: 12%', action: 'Redimensionar' },
          { name: 'staging-mysql (db-n1-standard-4)', project: 'staging-env-667', provider: 'gcp', cost: 1000, reason: 'Uso médio de CPU: 5%', action: 'Redimensionar' }
        ]
      },
      {
        category: 'Snapshots Antigos',
        icon: '📸',
        color: 'yellow',
        totalWaste: 2100,
        items: [
          { name: 'snapshot-prod-2024-01 (800GB)', project: 'prod-ecommerce-441', provider: 'gcp', cost: 960, reason: 'Snapshot com +180 dias', action: 'Excluir' },
          { name: 'snapshot-ml-data (600GB)', project: 'ml-platform-219', provider: 'gcp', cost: 720, reason: 'Snapshot com +90 dias', action: 'Excluir' },
          { name: 'snapshot-legacy (350GB)', project: 'legacy-migration-990', provider: 'gcp', cost: 420, reason: 'Projeto encerrado', action: 'Excluir' }
        ]
      },
      {
        category: 'Load Balancers Ociosos',
        icon: '⚖️',
        color: 'orange',
        totalWaste: 1440,
        items: [
          { name: 'lb-old-api-gateway', project: 'legacy-migration-990', provider: 'gcp', cost: 720, reason: 'Zero requisições há 60 dias', action: 'Remover' },
          { name: 'lb-staging-frontend', project: 'staging-env-667', provider: 'gcp', cost: 720, reason: 'Zero requisições há 45 dias', action: 'Remover' }
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
    const combinedTotal = Math.round(currTotal + hwCurrTotal);

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
        activeServices: services.length,
        byProvider: {
          gcp: {
            currentMonthCost: Math.round(currTotal),
            previousMonthCost: Math.round(prevTotal),
            projectedCost: Math.round(currTotal * rand(1.03, 1.08)),
            activeProjects: projects.length
          },
          huawei: {
            currentMonthCost: Math.round(hwCurrTotal),
            previousMonthCost: Math.round(hwPrevTotal),
            projectedCost: Math.round(hwCurrTotal * rand(1.03, 1.08)),
            activeProjects: huaweiProjects.length
          }
        }
      },
      projects: projectData,
      services: serviceBreakdown,
      regions: regionBreakdown,
      timeline,
      waste: wasteItems,
      recommendations,
      huaweiProjects: huaweiProjectData,
      huaweiTimeline,
      user: { name: 'Demo User', email: 'demo@empresa.com.br', org: 'Empresa Demo Ltda', picture: null }
    };
  }

  return { generate };
})();
