/**
 * Converte resposta da Huawei BSS API para o formato ProviderData.
 * Requirements: 2.3, 4.3
 */

/**
 * Normaliza a resposta da Huawei BSS API para o formato ProviderData.
 * @param {Object} huaweiResponse - Resposta bruta da BSS API
 * @param {string} periodStart - ISO 8601
 * @param {string} periodEnd - ISO 8601
 * @returns {import('../types').ProviderData}
 */
export function normalizeHuawei(huaweiResponse, periodStart, periodEnd) {
  const billSums = huaweiResponse.bill_sums || [];
  const projects = {};

  for (const bill of billSums) {
    const projectId = bill.enterprise_project_id || 'default';
    const projectName = bill.enterprise_project_name || 'Default Project';
    const service =
      bill.cloud_service_type_name || bill.cloud_service_type || 'Other';
    const cost = parseFloat(bill.consume_amount || '0');
    const region = bill.region || 'cn-north-4';

    if (!projects[projectId]) {
      projects[projectId] = {
        id: projectId,
        name: projectName,
        provider: 'huawei',
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
    provider: 'huawei',
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
