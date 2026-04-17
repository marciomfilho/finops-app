/**
 * Sync Job — agregação de cost_summaries a partir de billing_records.
 * Agrega totais por (provider, period_start, period_end) e faz upsert
 * em cost_summaries pela chave composta.
 * Requirements: 4.6
 */

import { getSupabaseServiceClient } from '../src/services/supabase.js';

async function fetchDistinctPeriods(supabase) {
  const { data, error } = await supabase
    .from('billing_records')
    .select('provider, period_start, period_end');

  if (error) throw new Error(`[SummarySync] Erro ao buscar períodos: ${error.message}`);

  const seen = new Map();
  for (const row of data || []) {
    const key = `${row.provider}|${row.period_start}|${row.period_end}`;
    if (!seen.has(key)) {
      seen.set(key, { provider: row.provider, period_start: row.period_start, period_end: row.period_end });
    }
  }
  return Array.from(seen.values());
}

async function aggregatePeriod(supabase, provider, periodStart, periodEnd) {
  const { data, error } = await supabase
    .from('billing_records')
    .select('cost, project_id')
    .eq('provider', provider)
    .eq('period_start', periodStart)
    .eq('period_end', periodEnd);

  if (error) throw new Error(`[SummarySync] Erro ao agregar ${provider}: ${error.message}`);

  const records = data || [];
  const totalCost = records.reduce((sum, r) => sum + (r.cost || 0), 0);
  const activeProjects = new Set(records.map((r) => r.project_id)).size;
  return { total_cost: totalCost, active_projects: activeProjects };
}

/**
 * Executa a sincronização de cost_summaries.
 * @returns {Promise<{ processed: number, errors: number }>}
 */
export async function runSummarySync() {
  console.log('[SummarySync] Iniciando agregação de cost_summaries...');

  const supabase = await getSupabaseServiceClient();
  let processed = 0;
  let errors = 0;

  let periods;
  try {
    periods = await fetchDistinctPeriods(supabase);
  } catch (err) {
    console.error('[SummarySync] Falha ao buscar períodos:', err.message);
    return { processed: 0, errors: 1 };
  }

  console.log(`[SummarySync] ${periods.length} combinações encontradas.`);

  for (const { provider, period_start, period_end } of periods) {
    try {
      const { total_cost, active_projects } = await aggregatePeriod(supabase, provider, period_start, period_end);

      const { error: upsertError } = await supabase
        .from('cost_summaries')
        .upsert(
          { provider, period_start, period_end, total_cost, total_waste: 0, potential_saving: 0, active_projects, payload: {} },
          { onConflict: 'provider,period_start,period_end', ignoreDuplicates: false }
        );

      if (upsertError) {
        console.error(`[SummarySync] Erro no upsert de ${provider}:`, upsertError.message);
        errors++;
      } else {
        processed++;
      }
    } catch (err) {
      console.error(`[SummarySync] Erro ao processar ${provider} ${period_start}:`, err.message);
      errors++;
    }
  }

  console.log(`[SummarySync] Concluído — processed: ${processed}, errors: ${errors}`);
  return { processed, errors };
}
