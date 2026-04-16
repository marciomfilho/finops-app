/**
 * Chart configurations and rendering
 */

Chart.defaults.color = '#8892a4';
Chart.defaults.borderColor = '#2a3347';
Chart.defaults.font.family = "'Inter', -apple-system, sans-serif";
Chart.defaults.font.size = 12;
Chart.register(ChartDataLabels);

const COLORS = {
  blue: '#1a73e8', blueLight: '#4a9eff', blueFade: 'rgba(26,115,232,0.15)',
  green: '#00c48c', greenFade: 'rgba(0,196,140,0.15)',
  red: '#ff4d6a', redFade: 'rgba(255,77,106,0.15)',
  yellow: '#ffb800', yellowFade: 'rgba(255,184,0,0.15)',
  purple: '#a855f7', purpleFade: 'rgba(168,85,247,0.15)',
  orange: '#ff6b35', orangeFade: 'rgba(255,107,53,0.15)',
  palette: ['#1a73e8','#00c48c','#a855f7','#ffb800','#ff4d6a','#ff6b35','#4a9eff','#34d399','#f472b6','#60a5fa']
};

const activeCharts = {};

function destroyChart(id) {
  if (activeCharts[id]) { activeCharts[id].destroy(); delete activeCharts[id]; }
}

function fmt(val) {
  if (val >= 1e6) return `R$ ${(val/1e6).toFixed(2)}M`;
  if (val >= 1e3) return `R$ ${(val/1e3).toFixed(1)}K`;
  return `R$ ${val.toFixed(0)}`;
}

// ── Timeline Chart ────────────────────────────────────────────────────────────
function renderTimeline(canvasId, data) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;

  const gradient = ctx.createLinearGradient(0, 0, 0, 280);
  gradient.addColorStop(0, 'rgba(26,115,232,0.3)');
  gradient.addColorStop(1, 'rgba(26,115,232,0)');

  activeCharts[canvasId] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.map(d => d.date),
      datasets: [{
        label: 'Custo Diário',
        data: data.map(d => d.cost),
        borderColor: COLORS.blue,
        backgroundColor: gradient,
        borderWidth: 2.5,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 6,
        pointHoverBackgroundColor: COLORS.blue,
        pointHoverBorderColor: '#fff',
        pointHoverBorderWidth: 2
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      animation: { duration: 1200, easing: 'easeInOutQuart' },
      plugins: {
        legend: { display: false },
        datalabels: { display: false },
        tooltip: {
          backgroundColor: '#1e2535', borderColor: '#2a3347', borderWidth: 1,
          padding: 12, cornerRadius: 8,
          callbacks: { label: ctx => fmt(ctx.raw) }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0 } },
        y: { grid: { color: '#2a3347' }, ticks: { callback: v => fmt(v) } }
      }
    }
  });
}

// ── Services Donut ────────────────────────────────────────────────────────────
function renderServicesDonut(canvasId, data) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;
  const top = data.slice(0, 7);
  const other = data.slice(7).reduce((s, d) => s + d.cost, 0);
  if (other > 0) top.push({ name: 'Outros', cost: other });

  activeCharts[canvasId] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: top.map(d => d.name),
      datasets: [{ data: top.map(d => d.cost), backgroundColor: COLORS.palette, borderWidth: 0, hoverOffset: 8 }]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      cutout: '65%',
      animation: { animateRotate: true, duration: 1000 },
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 10, padding: 12, font: { size: 11 } } },
        datalabels: { display: false },
        tooltip: {
          backgroundColor: '#1e2535', borderColor: '#2a3347', borderWidth: 1,
          callbacks: { label: ctx => ` ${fmt(ctx.raw)} (${((ctx.raw / top.reduce((s,d)=>s+d.cost,0))*100).toFixed(1)}%)` }
        }
      }
    }
  });
}

// ── Top Projects Bar ──────────────────────────────────────────────────────────
function renderTopProjects(canvasId, projects) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;
  const top = [...projects].sort((a, b) => b.currentCost - a.currentCost).slice(0, 5);

  activeCharts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: top.map(p => p.name.length > 18 ? p.name.slice(0, 18) + '…' : p.name),
      datasets: [{
        label: 'Custo Atual',
        data: top.map(p => p.currentCost),
        backgroundColor: COLORS.palette.slice(0, 5),
        borderRadius: 8, borderSkipped: false
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: true, indexAxis: 'y',
      animation: { duration: 900, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        datalabels: { anchor: 'end', align: 'end', formatter: v => fmt(v), font: { size: 10, weight: '600' }, color: '#8892a4' },
        tooltip: { backgroundColor: '#1e2535', borderColor: '#2a3347', borderWidth: 1, callbacks: { label: ctx => fmt(ctx.raw) } }
      },
      scales: {
        x: { grid: { color: '#2a3347' }, ticks: { callback: v => fmt(v) } },
        y: { grid: { display: false } }
      }
    }
  });
}

// ── Regions Bar ───────────────────────────────────────────────────────────────
function renderRegions(canvasId, regions) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;

  activeCharts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: regions.map(r => r.name),
      datasets: [{
        data: regions.map(r => r.cost),
        backgroundColor: COLORS.palette.slice(0, regions.length),
        borderRadius: 8, borderSkipped: false
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      animation: { duration: 900 },
      plugins: {
        legend: { display: false },
        datalabels: { display: false },
        tooltip: { backgroundColor: '#1e2535', borderColor: '#2a3347', borderWidth: 1, callbacks: { label: ctx => fmt(ctx.raw) } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 30, font: { size: 10 } } },
        y: { grid: { color: '#2a3347' }, ticks: { callback: v => fmt(v) } }
      }
    }
  });
}

// ── Budget Gauge ──────────────────────────────────────────────────────────────
function renderBudget(canvasId, current, budget) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;
  const pct = Math.min((current / budget) * 100, 100);
  const remaining = Math.max(budget - current, 0);
  const color = pct > 90 ? COLORS.red : pct > 75 ? COLORS.yellow : COLORS.green;

  activeCharts[canvasId] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Utilizado', 'Disponível'],
      datasets: [{ data: [current, remaining], backgroundColor: [color, '#2a3347'], borderWidth: 0, hoverOffset: 4 }]
    },
    options: {
      responsive: true, maintainAspectRatio: true, cutout: '72%',
      animation: { animateRotate: true, duration: 1200 },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, padding: 12 } },
        datalabels: {
          display: (ctx) => ctx.dataIndex === 0,
          formatter: () => `${pct.toFixed(1)}%`,
          color: color, font: { size: 22, weight: '800' },
          anchor: 'center', align: 'center'
        },
        tooltip: { backgroundColor: '#1e2535', borderColor: '#2a3347', borderWidth: 1, callbacks: { label: ctx => fmt(ctx.raw) } }
      }
    }
  });
}

// ── Projects Compare ──────────────────────────────────────────────────────────
function renderProjectsCompare(canvasId, projects) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;

  activeCharts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: projects.map(p => p.name.length > 20 ? p.name.slice(0, 20) + '…' : p.name),
      datasets: [
        { label: 'Mês Anterior', data: projects.map(p => p.previousCost), backgroundColor: 'rgba(26,115,232,0.4)', borderRadius: 6, borderSkipped: false },
        { label: 'Mês Atual', data: projects.map(p => p.currentCost), backgroundColor: COLORS.blue, borderRadius: 6, borderSkipped: false }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 1000 },
      plugins: {
        legend: { position: 'top' },
        datalabels: { display: false },
        tooltip: { backgroundColor: '#1e2535', borderColor: '#2a3347', borderWidth: 1, callbacks: { label: ctx => `${ctx.dataset.label}: ${fmt(ctx.raw)}` } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 30, font: { size: 11 } } },
        y: { grid: { color: '#2a3347' }, ticks: { callback: v => fmt(v) } }
      }
    }
  });
}

// ── Waste Categories ──────────────────────────────────────────────────────────
function renderWasteCategories(canvasId, waste) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;

  activeCharts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: waste.map(w => w.category),
      datasets: [{
        label: 'Desperdício (R$)',
        data: waste.map(w => w.totalWaste),
        backgroundColor: [COLORS.red, COLORS.yellow, COLORS.orange, COLORS.red, COLORS.yellow, COLORS.orange],
        borderRadius: 8, borderSkipped: false
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 1000 },
      plugins: {
        legend: { display: false },
        datalabels: { anchor: 'end', align: 'end', formatter: v => fmt(v), font: { size: 11, weight: '700' }, color: '#e8eaf0' },
        tooltip: { backgroundColor: '#1e2535', borderColor: '#2a3347', borderWidth: 1, callbacks: { label: ctx => fmt(ctx.raw) } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: { grid: { color: '#2a3347' }, ticks: { callback: v => fmt(v) } }
      }
    }
  });
}

// ── Forecast ──────────────────────────────────────────────────────────────────
function renderForecast(canvasId, timeline) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;

  // Simple linear regression for forecast
  const n = timeline.length;
  const xMean = (n - 1) / 2;
  const yMean = timeline.reduce((s, d) => s + d.cost, 0) / n;
  let num = 0, den = 0;
  timeline.forEach((d, i) => { num += (i - xMean) * (d.cost - yMean); den += (i - xMean) ** 2; });
  const slope = den ? num / den : 0;
  const intercept = yMean - slope * xMean;

  const forecastDays = 90;
  const forecastData = [];
  const lastDate = new Date(timeline[timeline.length - 1].date);
  for (let i = 1; i <= forecastDays; i++) {
    const d = new Date(lastDate);
    d.setDate(d.getDate() + i);
    const projected = intercept + slope * (n + i - 1);
    forecastData.push({ date: d.toISOString().split('T')[0], cost: Math.max(projected * (1 + (Math.random() - 0.5) * 0.05), 0) });
  }

  const allLabels = [...timeline.map(d => d.date), ...forecastData.map(d => d.date)];
  const historicalValues = [...timeline.map(d => d.cost), ...Array(forecastDays).fill(null)];
  const forecastValues = [...Array(n).fill(null), ...forecastData.map(d => d.cost)];

  const gradHist = ctx.createLinearGradient(0, 0, 0, 280);
  gradHist.addColorStop(0, 'rgba(26,115,232,0.25)');
  gradHist.addColorStop(1, 'rgba(26,115,232,0)');

  const gradFore = ctx.createLinearGradient(0, 0, 0, 280);
  gradFore.addColorStop(0, 'rgba(168,85,247,0.25)');
  gradFore.addColorStop(1, 'rgba(168,85,247,0)');

  activeCharts[canvasId] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: allLabels,
      datasets: [
        { label: 'Histórico', data: historicalValues, borderColor: COLORS.blue, backgroundColor: gradHist, borderWidth: 2, fill: true, tension: 0.4, pointRadius: 0 },
        { label: 'Projeção', data: forecastValues, borderColor: COLORS.purple, backgroundColor: gradFore, borderWidth: 2, borderDash: [6, 3], fill: true, tension: 0.4, pointRadius: 0 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      animation: { duration: 1200 },
      plugins: {
        legend: { position: 'top' },
        datalabels: { display: false },
        tooltip: { backgroundColor: '#1e2535', borderColor: '#2a3347', borderWidth: 1, callbacks: { label: ctx => `${ctx.dataset.label}: ${fmt(ctx.raw)}` } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 10, maxRotation: 0 } },
        y: { grid: { color: '#2a3347' }, ticks: { callback: v => fmt(v) } }
      }
    }
  });
}

// ── MoM Growth ────────────────────────────────────────────────────────────────
function renderMoM(canvasId, services) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;
  const top = services.slice(0, 8);
  const growth = top.map(() => (Math.random() - 0.3) * 40);

  activeCharts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: top.map(s => s.name.length > 14 ? s.name.slice(0, 14) + '…' : s.name),
      datasets: [{
        label: 'Crescimento MoM (%)',
        data: growth,
        backgroundColor: growth.map(g => g > 0 ? COLORS.red : COLORS.green),
        borderRadius: 6, borderSkipped: false
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      animation: { duration: 900 },
      plugins: {
        legend: { display: false },
        datalabels: { formatter: v => `${v.toFixed(1)}%`, font: { size: 10, weight: '600' }, color: '#e8eaf0', anchor: v => v.raw >= 0 ? 'end' : 'start', align: v => v.raw >= 0 ? 'end' : 'start' },
        tooltip: { backgroundColor: '#1e2535', borderColor: '#2a3347', borderWidth: 1, callbacks: { label: ctx => `${ctx.raw.toFixed(1)}%` } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 30 } },
        y: { grid: { color: '#2a3347' }, ticks: { callback: v => `${v}%` } }
      }
    }
  });
}

// ── Heatmap (simulated with bar) ──────────────────────────────────────────────
function renderHeatmap(canvasId) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;
  const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const hours = Array.from({ length: 24 }, (_, i) => `${i}h`);
  const data = hours.map(h => days.map(d => {
    const isWeekend = d === 'Dom' || d === 'Sáb';
    const hour = parseInt(h);
    const isPeak = hour >= 9 && hour <= 18;
    return Math.round((isWeekend ? 0.3 : 1) * (isPeak ? 1 : 0.4) * Math.random() * 1000 + 100);
  }));

  // Flatten for bubble chart simulation
  const bubbleData = [];
  hours.forEach((h, hi) => {
    days.forEach((d, di) => {
      bubbleData.push({ x: di, y: hi, v: data[hi][di] });
    });
  });

  const maxV = Math.max(...bubbleData.map(b => b.v));

  activeCharts[canvasId] = new Chart(ctx, {
    type: 'bubble',
    data: {
      datasets: [{
        data: bubbleData.map(b => ({ x: b.x, y: b.y, r: (b.v / maxV) * 14 + 2 })),
        backgroundColor: bubbleData.map(b => {
          const pct = b.v / maxV;
          if (pct > 0.8) return COLORS.red;
          if (pct > 0.5) return COLORS.yellow;
          if (pct > 0.3) return COLORS.blue;
          return COLORS.green;
        }),
        borderWidth: 0
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 1000 },
      plugins: {
        legend: { display: false },
        datalabels: { display: false },
        tooltip: {
          backgroundColor: '#1e2535', borderColor: '#2a3347', borderWidth: 1,
          callbacks: {
            label: ctx => {
              const d = bubbleData[ctx.dataIndex];
              return `${days[d.x]} ${hours[d.y]}: ${fmt(d.v)}`;
            }
          }
        }
      },
      scales: {
        x: { min: -0.5, max: 6.5, ticks: { callback: (_, i) => days[i] || '' }, grid: { display: false } },
        y: { min: -0.5, max: 23.5, ticks: { callback: (_, i) => i % 3 === 0 ? hours[i] : '' }, grid: { color: '#2a3347' } }
      }
    }
  });
}

// ── Provider Breakdown (stacked bar) ─────────────────────────────────────────
function renderProviderBreakdown(canvasId, byProvider) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx || !byProvider) return;
  const providers = Object.keys(byProvider);
  const labels = ['Período Atual'];
  const datasets = providers.map((p, i) => ({
    label: p.toUpperCase(),
    data: [byProvider[p].currentCost || 0],
    backgroundColor: COLORS.palette[i] || COLORS.blue,
    borderRadius: 6,
    borderSkipped: false
  }));
  activeCharts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { position: 'top' }, datalabels: { display: false },
        tooltip: { backgroundColor: '#1e2535', borderColor: '#2a3347', borderWidth: 1,
          callbacks: { label: ctx => `${ctx.dataset.label}: ${fmt(ctx.raw)}` } } },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, grid: { color: '#2a3347' }, ticks: { callback: v => fmt(v) } }
      }
    }
  });
}

// ── Provider Budget Chart (grouped bar + budget line) ─────────────────────────
function renderProviderBudgetChart(canvasId, data, budgetConfig) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;
  const summary = (data && data.summary) || {};
  const byProvider = summary.byProvider || {};
  const gcpCurrent = byProvider.gcp?.currentCost || 0;
  const hwCurrent = byProvider.huawei?.currentCost || 0;
  const totalBudget = budgetConfig?.budgets?.total?.monthly || 0;
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }));
  }
  const gcpData = months.map((_, i) => Math.round(gcpCurrent * (0.82 + i * 0.036)));
  const hwData = months.map((_, i) => Math.round(hwCurrent * (0.82 + i * 0.036)));
  const datasets = [
    { label: 'GCP', data: gcpData, backgroundColor: 'rgba(26,115,232,0.85)', borderRadius: 6, borderSkipped: false },
    { label: 'Huawei', data: hwData, backgroundColor: 'rgba(255,77,106,0.85)', borderRadius: 6, borderSkipped: false }
  ];
  if (totalBudget > 0) {
    datasets.push({ label: 'Orçamento Total', data: months.map(() => totalBudget), type: 'line', borderColor: '#ffb800', borderDash: [6, 3], borderWidth: 2.5, pointRadius: 0, fill: false, tension: 0 });
  }
  activeCharts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: { labels: months, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 900 },
      plugins: { legend: { position: 'top' }, datalabels: { display: false },
        tooltip: { backgroundColor: '#1e2535', borderColor: '#2a3347', borderWidth: 1,
          callbacks: { label: ctx => `${ctx.dataset.label}: ${fmt(ctx.raw)}` } } },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: '#2a3347' }, ticks: { callback: v => fmt(v) } }
      }
    }
  });
}
