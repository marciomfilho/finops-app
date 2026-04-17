/**
 * Converte resposta da GCP Cloud Billing API para o formato ProviderData.
 * Requirements: 2.3, 4.2
 */

/**
 * Normaliza a resposta da GCP Cloud Billing API para o formato ProviderData.
 * @param {Object} gcpResponse - Resposta bruta da API
 * @param {string} periodStart - ISO 8601
 * @param {string} periodEnd - ISO 8601
 * @returns {import('../types').ProviderData}
 */
export function normalizeGCP(gcpResponse, periodStart, periodEnd) {
  const projects = {};

  for (const row of (gcpResponse.rows || [])) {
    const projectId =
      row.dimensions?.find((d) => d.key === 'project.id')?.value || 'unknown';
    const projectName =
      row.dimensions?.find((d) => d.key === 'project.name')?.value || projectId;
    const service =
      row.dimensions?.find((d) => d.key === 'service.description')?.value || 'Other';
    const region =
      row.dimensions?.find((d) => d.key === 'location.region')?.value || 'global';
    const cost = parseFloat(
      row.metrics?.[0]?.values?.[0]?.moneyValue?.units || '0'
    );

    if (!projects[projectId]) {
      projects[projectId] = {
        id: projectId,
        name: projectName,
        provider: 'gcp',
        currentCost: 0,
        services: [],
        region,
      };
    }
    projects[projectId].currentCost += cost;
    projects[projectId].services.push({ name: service, cost });
  }

  const projectList = Object.values(projects);
  const totalCost = projectList.reduce((s, p) => s + p.currentCost, 0);

  return {
    provider: 'gcp',
    period_start: periodStart,
    period_end: periodEnd,
    summary: {
      currentCost: totalCost,
      previousCost: 0,
      budget: 0,
      totalWaste: 0,
      potentialSaving: 0,
    },
    projects: projectList,
    services: aggregateServices(projectList),
    regions: aggregateRegions(projectList),
    timeline: [],
    waste: [],
    recommendations: [],
  };
}

/**
 * Agrega serviços de todos os projetos, somando custos por nome de serviço.
 * @param {Array} projects
 * @returns {{ name: string, cost: number }[]}
 */
export function aggregateServices(projects) {
  const map = {};
  for (const p of projects) {
    for (const s of p.services || []) {
      map[s.name] = (map[s.name] || 0) + s.cost;
    }
  }
  return Object.entries(map)
    .map(([name, cost]) => ({ name, cost }))
    .sort((a, b) => b.cost - a.cost);
}

/**
 * Agrega regiões de todos os projetos, somando custos por região.
 * @param {Array} projects
 * @returns {{ region: string, cost: number }[]}
 */
export function aggregateRegions(projects) {
  const map = {};
  for (const p of projects) {
    map[p.region] = (map[p.region] || 0) + p.currentCost;
  }
  return Object.entries(map).map(([region, cost]) => ({ region, cost }));
}
