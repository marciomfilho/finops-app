/**
 * Rota de billing: GET /api/billing/:provider
 * Requirements: 2.1, 2.3, 2.5
 */

import { Router } from 'express';
import { getBillingRecords } from '../services/supabase.js';

const router = Router();

const VALID_PROVIDERS = ['gcp', 'huawei', 'all'];
const DEFAULT_PERIOD = 30;
const MAX_PERIOD = 365;

/**
 * Transforma registros brutos de billing_records em formato ProviderData
 * compatível com o DataBus do frontend.
 * @param {string} provider
 * @param {Array} records
 * @param {number} periodDays
 * @returns {Object} ProviderData
 */
function toProviderData(provider, records, periodDays) {
  const now = new Date();
  const periodStart = new Date(now - periodDays * 86400000).toISOString();
  const periodEnd = now.toISOString();

  // Agrupa por projeto
  const projectsMap = {};
  for (const rec of records) {
    const pid = rec.project_id || 'unknown';
    if (!projectsMap[pid]) {
      projectsMap[pid] = {
        id: pid,
        name: rec.project_name || pid,
        provider: rec.provider,
        currentCost: 0,
        services: [],
        region: rec.region || null,
      };
    }
    projectsMap[pid].currentCost += parseFloat(rec.cost || 0);
    if (rec.service) {
      projectsMap[pid].services.push({ name: rec.service, cost: parseFloat(rec.cost || 0) });
    }
  }

  const projects = Object.values(projectsMap);
  const totalCost = projects.reduce((s, p) => s + p.currentCost, 0);

  // Agrega serviços
  const servicesMap = {};
  for (const rec of records) {
    if (rec.service) {
      servicesMap[rec.service] = (servicesMap[rec.service] || 0) + parseFloat(rec.cost || 0);
    }
  }
  const services = Object.entries(servicesMap)
    .map(([name, cost]) => ({ name, cost }))
    .sort((a, b) => b.cost - a.cost);

  // Agrega regiões
  const regionsMap = {};
  for (const rec of records) {
    if (rec.region) {
      regionsMap[rec.region] = (regionsMap[rec.region] || 0) + parseFloat(rec.cost || 0);
    }
  }
  const regions = Object.entries(regionsMap).map(([region, cost]) => ({ region, cost }));

  // synced_at: usa o mais recente synced_at dos registros
  const syncedAt = records.length > 0
    ? records.reduce((latest, r) => (r.synced_at > latest ? r.synced_at : latest), records[0].synced_at)
    : now.toISOString();

  return {
    provider,
    period_start: periodStart,
    period_end: periodEnd,
    summary: {
      currentCost: totalCost,
      previousCost: 0,
      budget: 0,
      totalWaste: 0,
      potentialSaving: 0,
    },
    projects,
    services,
    regions,
    timeline: [],
    waste: [],
    recommendations: [],
    synced_at: syncedAt,
  };
}

/**
 * GET /api/billing/:provider?period=30
 * Retorna dados de billing no formato ProviderData compatível com o DataBus.
 */
router.get('/:provider', async (req, res, next) => {
  try {
    const { provider } = req.params;

    if (!VALID_PROVIDERS.includes(provider)) {
      return res.status(400).json({
        error: `Provider inválido. Use: ${VALID_PROVIDERS.join(', ')}`,
      });
    }

    const rawPeriod = parseInt(req.query.period, 10);
    const period = Number.isNaN(rawPeriod)
      ? DEFAULT_PERIOD
      : Math.min(Math.max(rawPeriod, 1), MAX_PERIOD);

    const records = await getBillingRecords(provider, period);

    if (provider === 'all') {
      // Retorna dados separados por provider
      const gcpRecords = records.filter((r) => r.provider === 'gcp');
      const huaweiRecords = records.filter((r) => r.provider === 'huawei');
      return res.json({
        provider: 'all',
        gcp: toProviderData('gcp', gcpRecords, period),
        huawei: toProviderData('huawei', huaweiRecords, period),
        synced_at: records.length > 0
          ? records.reduce((l, r) => (r.synced_at > l ? r.synced_at : l), records[0].synced_at)
          : new Date().toISOString(),
      });
    }

    return res.json(toProviderData(provider, records, period));
  } catch (err) {
    next(err);
  }
});

export default router;
