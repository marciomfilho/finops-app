/**
 * Sync Job — coleta e upsert de billing Huawei.
 * Busca dados da Huawei BSS API para o mês atual e o mês anterior,
 * normaliza e persiste em billing_records usando upsert pela chave composta
 * (provider, project_id, service, period_start, period_end).
 * Processa em chunks de 1.000; retry com backoff exponencial (5x) para falhas de API.
 * Requirements: 4.3, 4.5, 4.8
 */

import { fetchBills } from '../src/services/huaweiBss.js';
import { getSupabaseServiceClient } from '../src/services/supabase.js';
import { normalizeHuawei } from '../src/normalizers/huaweiNormalizer.js';

const CHUNK_SIZE = 1_000;

/**
 * Retorna os bill_cycles a sincronizar: mês atual e mês anterior.
 * Formato YYYY-MM conforme exigido pela Huawei BSS API.
 */
function getBillCycles() {
  const now = new Date();
  const cycles = [];

  for (const offset of [0, 1]) {
    const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const billCycle = `${year}-${month}`;
    const periodStart = new Date(year, d.getMonth(), 1).toISOString();
    const periodEnd = new Date(year, d.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();
    cycles.push({ billCycle, periodStart, periodEnd });
  }

  return cycles;
}

async function withRetry(fn, maxAttempts = 5) {
  const delays = [1000, 2000, 4000, 8000, 16000];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRetryable =
        (err.status !== undefined && err.status >= 500) ||
        err.code === 'ETIMEDOUT' ||
        err.code === 'ECONNRESET' ||
        err.message?.includes('timeout');
      if (!isRetryable || attempt === maxAttempts) throw err;
      const delay = delays[attempt - 1] ?? 16000;
      console.warn(`[HuaweiSync] Tentativa ${attempt}/${maxAttempts} falhou. Aguardando ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

function buildBillingRecord(project, service, periodStart, periodEnd) {
  return {
    provider: 'huawei',
    project_id: project.id,
    project_name: project.name,
    service: service.name,
    cost: service.cost,
    currency: 'CNY',
    period_start: periodStart,
    period_end: periodEnd,
    region: project.region || 'cn-north-4',
    tags: {},
    synced_at: new Date().toISOString(),
  };
}

async function upsertChunk(supabase, records) {
  const { error } = await supabase
    .from('billing_records')
    .upsert(records, {
      onConflict: 'provider,project_id,service,period_start,period_end',
      ignoreDuplicates: false,
    });
  if (error) {
    console.error('[HuaweiSync] Erro no upsert do chunk:', error.message);
    return records.length;
  }
  return 0;
}

/**
 * Executa a sincronização de billing Huawei.
 * @returns {Promise<{ processed: number, errors: number }>}
 */
export async function runHuaweiSync() {
  const cycles = getBillCycles();
  console.log(`[HuaweiSync] Iniciando sync — ciclos: ${cycles.map((c) => c.billCycle).join(', ')}`);

  const supabase = await getSupabaseServiceClient();
  let processed = 0;
  let errors = 0;

  for (const { billCycle, periodStart, periodEnd } of cycles) {
    console.log(`[HuaweiSync] Buscando ciclo ${billCycle}...`);

    let rawResponse;
    try {
      rawResponse = await withRetry(() => fetchBills(billCycle, billCycle));
    } catch (err) {
      console.error(`[HuaweiSync] Falha ao buscar ciclo ${billCycle}: ${err.message}`);
      errors++;
      continue;
    }

    const normalized = normalizeHuawei(rawResponse, periodStart, periodEnd);
    const records = [];
    for (const project of normalized.projects) {
      for (const service of project.services || []) {
        records.push(buildBillingRecord(project, service, periodStart, periodEnd));
      }
    }

    console.log(`[HuaweiSync] Ciclo ${billCycle} — ${records.length} registros coletados.`);

    for (let i = 0; i < records.length; i += CHUNK_SIZE) {
      const chunk = records.slice(i, i + CHUNK_SIZE);
      const chunkErrors = await upsertChunk(supabase, chunk);
      if (chunkErrors === 0) {
        processed += chunk.length;
      } else {
        errors += chunkErrors;
      }
    }
  }

  console.log(`[HuaweiSync] Concluído — processed: ${processed}, errors: ${errors}`);
  return { processed, errors };
}
