/**
 * FinOps Dashboard V2 — Trends Page
 * Uses DataBus.getData() for unified multi-provider timeline data.
 * Requirements: 3.2
 */

const TrendsPage = (() => {
  function render() {
    const data = DataBus.getData();
    if (!data) return;

    // Use the unified timeline already merged by DataBus (Requirement 3.2)
    const timeline = data.timeline || [];

    setTimeout(() => {
      renderForecast('chart-forecast', timeline);
      renderMoM('chart-mom', data.services || []);
      renderHeatmap('chart-heatmap');
      _renderProviderTimeline('chart-provider-timeline', data.providers || []);
      renderProviderBreakdown('chart-provider-breakdown', data.summary?.byProvider || {});
    }, 100);
  }

  // Renders a multi-line chart showing cost over time per provider.
  function _renderProviderTimeline(canvasId, providers) {
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx || !providers.length) return;

    const providerColors = {
      gcp: COLORS.blue,
      huawei: COLORS.red,
      csv: COLORS.green,
      demo: COLORS.purple
    };

    const activePds = providers.filter(pd => pd.timeline && pd.timeline.length > 0);
    if (!activePds.length) return;

    // Use the longest timeline as the common x-axis labels
    const longestPd = activePds.reduce((a, b) => (a.timeline.length >= b.timeline.length ? a : b));
    const labels = longestPd.timeline.map(p => p.date);

    const datasets = activePds.map((pd, i) => {
      const key = pd.provider || pd.id || `provider-${i}`;
      const color = providerColors[key] || COLORS.palette[i % COLORS.palette.length];
      const dateMap = new Map((pd.timeline || []).map(p => [p.date, p.cost]));
      return {
        label: key.toUpperCase(),
        data: labels.map(date => dateMap.get(date) ?? null),
        borderColor: color,
        backgroundColor: 'transparent',
        borderWidth: 2,
        fill: false,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 5
      };
    });

    activeCharts[canvasId] = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        animation: { duration: 1000 },
        plugins: {
          legend: { position: 'top' },
          datalabels: { display: false },
          tooltip: {
            backgroundColor: '#1e2535',
            borderColor: '#2a3347',
            borderWidth: 1,
            callbacks: { label: c => `${c.dataset.label}: ${fmt(c.raw)}` }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0 } },
          y: { grid: { color: '#2a3347' }, ticks: { callback: v => fmt(v) } }
        }
      }
    });
  }

  return { render };
})();
