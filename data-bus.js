/**
 * FinOps Dashboard V2 — DataBus
 * Central data aggregator for multi-provider (GCP, Huawei, CSV, Demo) data.
 * Exposes a unified interface for UI modules.
 */

const DataBus = (() => {
  // ── Internal state ──────────────────────────────────────────────────────────
  let providers = [];
  let cache = null;
  let lastFetch = 0;
  let updateCallbacks = [];
  let csvOverrides = {};
  const CACHE_TTL = 300000; // 5 minutes

  // ── Provider registration ───────────────────────────────────────────────────

  /**
   * Registers a data provider.
   * @param {Object} provider - Must implement { id, isConfigured(), fetchData(period) }
   */
  function registerProvider(provider) {
    providers.push(provider);
  }

  // ── Cache ───────────────────────────────────────────────────────────────────

  /**
   * Returns cached data if still valid (within TTL), otherwise null.
   * @returns {Object|null}
   */
  function getData() {
    if (cache && Date.now() < lastFetch + CACHE_TTL) {
      return cache;
    }
    return null;
  }

  // ── Update callbacks ────────────────────────────────────────────────────────

  /**
   * Registers a callback to be called whenever data is updated.
   * @param {Function} callback - Receives UnifiedData as argument
   */
  function onUpdate(callback) {
    updateCallbacks.push(callback);
  }

  function _fireCallbacks(data) {
    updateCallbacks.forEach(cb => {
      try { cb(data); } catch (e) { console.error('[DataBus] onUpdate callback error:', e); }
    });
  }

  // ── Load ────────────────────────────────────────────────────────────────────

  /**
   * Loads data from all configured providers.
   * Falls back to DEMO_DATA if no provider succeeds.
   * @param {number} period - Number of days
   * @returns {Promise<Object>} UnifiedData
   */
  async function load(period = 30) {
    const configuredProviders = providers.filter(p => p.isConfigured());

    // If a priority provider (id: 'backend') is configured, use it exclusively
    // to avoid double-counting data that the backend already aggregates.
    const backendProvider = configuredProviders.find(p => p.id === 'backend');
    const activeProviders = backendProvider ? [backendProvider] : configuredProviders;

    const results = await Promise.allSettled(
      activeProviders.map(p => p.fetchData(period))
    );

    const successfulData = results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);

    let unified;
    let isDemo = false;

    if (successfulData.length === 0) {
      // Fallback to demo data
      const demoRaw = DEMO_DATA.generate(period);
      unified = _buildUnifiedFromDemo(demoRaw, period);
      isDemo = true;
    } else {
      unified = aggregate(successfulData);
    }

    unified.isDemo = isDemo;

    // Apply any CSV overrides
    if (Object.keys(csvOverrides).length > 0) {
      unified = _applyCSVOverrides(unified);
    }

    cache = unified;
    lastFetch = Date.now();

    _fireCallbacks(unified);
    return unified;
  }

  // ── Aggregate ───────────────────────────────────────────────────────────────

  /**
   * Aggregates data from multiple providers into a UnifiedData object.
   * @param {Array} providerDataList - Array of ProviderData objects
   * @returns {Object} UnifiedData
   */
  function aggregate(providerDataList) {
    const allProjects = providerDataList.flatMap(pd => pd.projects || []);
    const allServices = providerDataList.flatMap(pd => pd.services || []);
    const allRegions = providerDataList.flatMap(pd => pd.regions || []);
    const allWaste = providerDataList.flatMap(pd => pd.waste || []);
    const allRecommendations = providerDataList.flatMap(pd => pd.recommendations || []);
    const allBudgets = providerDataList.flatMap(pd => pd.budgets || []);

    const totalCurrentCost = providerDataList.reduce((s, pd) => s + (pd.summary?.currentCost || 0), 0);
    const totalPreviousCost = providerDataList.reduce((s, pd) => s + (pd.summary?.previousCost || 0), 0);
    const totalBudget = providerDataList.reduce((s, pd) => s + (pd.summary?.budget || 0), 0);
    const totalWaste = providerDataList.reduce((s, pd) => s + (pd.summary?.totalWaste || 0), 0);
    const potentialSaving = providerDataList.reduce((s, pd) => s + (pd.summary?.potentialSaving || 0), 0);

    const wastePercent = totalCurrentCost > 0
      ? ((totalWaste / totalCurrentCost) * 100).toFixed(1)
      : '0.0';
    const savingPercent = totalCurrentCost > 0
      ? ((potentialSaving / totalCurrentCost) * 100).toFixed(1)
      : '0.0';

    const activeProviders = providerDataList.map(pd => pd.provider || pd.id).filter(Boolean);

    const byProvider = {};
    providerDataList.forEach(pd => {
      const key = pd.provider || pd.id;
      if (key) {
        byProvider[key] = {
          currentCost: pd.summary?.currentCost || 0,
          previousCost: pd.summary?.previousCost || 0,
          budget: pd.summary?.budget || 0,
          utilizationPct: pd.summary?.budget > 0
            ? ((pd.summary.currentCost / pd.summary.budget) * 100)
            : 0
        };
      }
    });

    const allTimelines = providerDataList.map(pd => pd.timeline || []);
    const mergedTimeline = mergeTimelines(allTimelines);

    return {
      providers: providerDataList,
      summary: {
        totalCurrentCost,
        totalPreviousCost,
        totalBudget,
        totalWaste,
        potentialSaving,
        wastePercent,
        savingPercent,
        activeProjects: allProjects.length,
        activeProviders,
        byProvider,
        // V1 compatibility fields
        currentMonthCost: totalCurrentCost,
        previousMonthCost: totalPreviousCost,
        projectedCost: Math.round(totalCurrentCost * 1.05)
      },
      projects: allProjects,
      services: allServices,
      regions: allRegions,
      timeline: mergedTimeline,
      waste: allWaste,
      recommendations: allRecommendations,
      budgets: allBudgets,
      isDemo: false,
      lastUpdated: new Date()
    };
  }

  /**
   * Merges multiple provider timelines into a single sorted timeline.
   * Sums costs for the same date across all providers.
   * @param {Array<Array>} timelines - Array of timeline arrays [{ date, cost }]
   * @returns {Array} Sorted array of { date, cost }
   */
  function mergeTimelines(timelines) {
    const dateMap = new Map();

    for (const timeline of timelines) {
      for (const point of (timeline || [])) {
        const existing = dateMap.get(point.date) || 0;
        dateMap.set(point.date, existing + (point.cost || 0));
      }
    }

    return Array.from(dateMap.entries())
      .map(([date, cost]) => ({ date, cost }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  // ── Demo fallback builder ───────────────────────────────────────────────────

  /**
   * Converts raw DEMO_DATA output into a UnifiedData structure.
   * Merges GCP and Huawei demo projects into a single projects array.
   */
  function _buildUnifiedFromDemo(demoRaw, period) {
    const gcpProjects = (demoRaw.projects || []).map(p => ({ ...p, provider: 'gcp' }));
    const hwProjects = (demoRaw.huaweiProjects || []).map(p => ({ ...p, provider: 'huawei' }));
    const allProjects = [...gcpProjects, ...hwProjects];

    const gcpCurrent = demoRaw.summary?.byProvider?.gcp?.currentMonthCost || demoRaw.summary?.currentMonthCost || 0;
    const gcpPrevious = demoRaw.summary?.byProvider?.gcp?.previousMonthCost || demoRaw.summary?.previousMonthCost || 0;
    const hwCurrent = demoRaw.summary?.byProvider?.huawei?.currentMonthCost || 0;
    const hwPrevious = demoRaw.summary?.byProvider?.huawei?.previousMonthCost || 0;

    const totalCurrentCost = gcpCurrent + hwCurrent;
    const totalPreviousCost = gcpPrevious + hwPrevious;
    const totalBudget = demoRaw.summary?.totalBudget || Math.round(totalCurrentCost * 1.2);
    const totalWaste = demoRaw.summary?.totalWaste || 0;
    const potentialSaving = demoRaw.summary?.potentialSaving || 0;

    const wastePercent = totalCurrentCost > 0
      ? ((totalWaste / totalCurrentCost) * 100).toFixed(1)
      : '0.0';
    const savingPercent = totalCurrentCost > 0
      ? ((potentialSaving / totalCurrentCost) * 100).toFixed(1)
      : '0.0';

    const gcpTimeline = demoRaw.timeline || [];
    const hwTimeline = demoRaw.huaweiTimeline || [];
    const mergedTimeline = mergeTimelines([gcpTimeline, hwTimeline]);

    const byProvider = {
      gcp: {
        currentCost: gcpCurrent,
        previousCost: gcpPrevious,
        budget: Math.round(gcpCurrent * 1.2),
        utilizationPct: gcpCurrent > 0 ? ((gcpCurrent / (gcpCurrent * 1.2)) * 100) : 0
      },
      huawei: {
        currentCost: hwCurrent,
        previousCost: hwPrevious,
        budget: Math.round(hwCurrent * 1.2),
        utilizationPct: hwCurrent > 0 ? ((hwCurrent / (hwCurrent * 1.2)) * 100) : 0
      }
    };

    return {
      providers: [
        { id: 'gcp', provider: 'gcp', summary: { currentCost: gcpCurrent, previousCost: gcpPrevious }, projects: gcpProjects, timeline: gcpTimeline },
        { id: 'huawei', provider: 'huawei', summary: { currentCost: hwCurrent, previousCost: hwPrevious }, projects: hwProjects, timeline: hwTimeline }
      ],
      summary: {
        totalCurrentCost,
        totalPreviousCost,
        totalBudget,
        totalWaste,
        potentialSaving,
        wastePercent,
        savingPercent,
        activeProjects: allProjects.length,
        activeProviders: ['gcp', 'huawei'],
        byProvider,
        // V1 compatibility
        currentMonthCost: totalCurrentCost,
        previousMonthCost: totalPreviousCost,
        projectedCost: demoRaw.summary?.byProvider?.gcp?.projectedCost
          ? demoRaw.summary.byProvider.gcp.projectedCost + (demoRaw.summary.byProvider.huawei?.projectedCost || 0)
          : Math.round(totalCurrentCost * 1.05)
      },
      projects: allProjects,
      services: demoRaw.services || [],
      regions: demoRaw.regions || [],
      timeline: mergedTimeline,
      waste: demoRaw.waste || [],
      recommendations: demoRaw.recommendations || [],
      budgets: [],
      isDemo: true,
      lastUpdated: new Date()
    };
  }

  // ── CSV injection ───────────────────────────────────────────────────────────

  /**
   * Injects CSV-imported data for a given category, merges with cache, and fires callbacks.
   * @param {string} category - 'projects' | 'waste' | 'recommendations' | 'costs'
   * @param {Array} normalizedData - Normalized data array from CSVImporter
   */
  function injectCSVData(category, normalizedData) {
    csvOverrides[category] = normalizedData;

    if (cache) {
      cache = _applyCSVOverrides(cache);
      lastFetch = Date.now(); // refresh TTL
      _fireCallbacks(cache);
    }
  }

  /**
   * Applies stored CSV overrides to a UnifiedData object.
   * @param {Object} unified - UnifiedData
   * @returns {Object} Updated UnifiedData
   */
  function _applyCSVOverrides(unified) {
    const updated = { ...unified };

    if (csvOverrides.projects) {
      const csvProjects = csvOverrides.projects.map(p => ({ ...p, provider: 'csv' }));
      updated.projects = [...(unified.projects || []), ...csvProjects];
      updated.summary = {
        ...unified.summary,
        activeProjects: updated.projects.length
      };
    }

    if (csvOverrides.waste) {
      updated.waste = [...(unified.waste || []), ...csvOverrides.waste];
    }

    if (csvOverrides.recommendations) {
      updated.recommendations = [...(unified.recommendations || []), ...csvOverrides.recommendations];
    }

    if (csvOverrides.costs) {
      const csvTimeline = csvOverrides.costs.map(c => ({ date: c.date, cost: c.cost || 0 }));
      updated.timeline = mergeTimelines([unified.timeline || [], csvTimeline]);
    }

    updated.lastUpdated = new Date();
    return updated;
  }

  // ── Public API ──────────────────────────────────────────────────────────────
  return {
    registerProvider,
    getData,
    load,
    onUpdate,
    aggregate,
    mergeTimelines,
    injectCSVData
  };
})();


// ── BackendProvider ─────────────────────────────────────────────────────────

/**
 * BackendProvider — fetches billing data from the backend proxy.
 * JWT is stored only in memory (never in localStorage or cookies).
 * Implements the DataBus provider interface: { id, isConfigured(), fetchData(period) }
 */
const BackendProvider = (() => {
  let _jwt = null;

  const BACKEND_URL = (() => {
    if (typeof window !== 'undefined' && window.BACKEND_URL) return window.BACKEND_URL;
    return '';
  })();

  // ── JWT management ──────────────────────────────────────────────────────────

  function setJWT(token) {
    _jwt = token;
  }

  function clearJWT() {
    _jwt = null;
  }

  function hasJWT() {
    return _jwt !== null && _jwt !== undefined && _jwt !== '';
  }

  function isConfigured() {
    return hasJWT() && BACKEND_URL !== '';
  }

  // ── Internal fetch helper ───────────────────────────────────────────────────

  async function _apiFetch(url) {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${_jwt}`,
        'Content-Type': 'application/json'
      }
    });

    if (res.status === 401) {
      clearJWT();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('auth:expired'));
      }
      throw new Error('[BackendProvider] JWT expired — auth:expired dispatched');
    }

    if (!res.ok) {
      throw new Error(`[BackendProvider] HTTP ${res.status} from ${url}`);
    }

    return res.json();
  }

  // ── Data fetching ───────────────────────────────────────────────────────────

  /**
   * Fetches billing data for all providers from the backend.
   * Maps to GET /api/billing/all?period=<period>
   * @param {number} period - Number of days
   * @returns {Promise<Object>} ProviderData compatible with DataBus
   */
  async function fetchData(period = 30) {
    const url = `${BACKEND_URL}/api/billing/all?period=${period}`;
    return _apiFetch(url);
  }

  /**
   * Fetches cost summaries from the backend.
   * Maps to GET /api/summaries?period=<period>
   * @param {number} period - Number of days
   * @returns {Promise<Object>} UnifiedSummary
   */
  async function fetchSummaries(period = 30) {
    const url = `${BACKEND_URL}/api/summaries?period=${period}`;
    return _apiFetch(url);
  }

  return {
    id: 'backend',
    setJWT,
    clearJWT,
    hasJWT,
    getJWT: () => _jwt,
    isConfigured,
    fetchData,
    fetchSummaries
  };
})();

// Register BackendProvider in DataBus with priority over GCP/Huawei direct providers.
// DataBus.load() will use BackendProvider exclusively when it is configured (JWT present),
// falling back to direct GCP/Huawei providers when BackendProvider is not configured.
DataBus.registerProvider(BackendProvider);
