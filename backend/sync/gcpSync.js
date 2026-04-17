/**
 * Sync Job — coleta e upsert de billing GCP.
 * Busca dados da GCP Cloud Billing API, normaliza e persiste em billing_records
 * usando upsert pela chave composta (provider, project_id, service, period_start, period_end).
 * Suporta até 100.000 registros com paginação; processa em chunks de 1.000.
 * Requirements: 4.2, 4.4, 4.8
 */

import { ENV } from '../src/config/env.js';
import { fetchBillingData } from '../src/services/gcpBilling.js';
import { getSupabaseServiceClient } from '../src/services/supabase.js';
import { normalizeGCP } from '../src/normalizers/gcpNormalizer.js';

const CHUNK_SIZE = 1_000;
const MAX_RECORDS = 100_000;

/**
 * Calcula o período padrão: últimos N dias.
 * @param {number} days - Número de dias (padrão: 30)
 * @returns {{ periodStart: string, periodEnd: string }}
 */
function getDefaultPeriod(days = 30) {
  const now = new Date();
  const start = new Date(now.getTime() - days * 86_400_000);
  return {
    periodStart: start.toISOString(),
    periodEnd: now.toISOString(),
  };
}

/**
 * Converte um projeto normalizado + serviço em um registro de billing_records.
 * @param {Object} project - Projeto normalizado
 * @param {{ name: string, cost: number }} service - Serviço do projeto
 * @param {string} periodStart
 * @param {string} periodEnd
 * @returns {Object}
 */
function buildBillingRecord(project, service, periodStart, periodEnd) {
  return {
    provider: 'gcp',
    project_id: project.id,
    project_name: project.name,
    service: service.name,
    cost: service.cost,
    currency: 'USD',
    period_start: periodStart,
    period_end: periodEnd,
    region: project.region || 'global',
    tags: {},
    synced_at: new Date().toISOString(),
  };
}

/**
 * Faz upsert de um chunk de registros em billing_records.
 * Usa a chave composta (provider, project_id, service, period_start, period_end).
 * @param {Object} supabase - Cliente Supabase
 * @param {Object[]} records - Registros a inserir/atualizar
 * @returns {Promise<number>} Número de erros no chunk
 */
async function upsertChunk(supabase, records) {
  const { error } = await supabase
    .from('billing_records')
    .upsert(records, {
      onConflict: 'provider,project_id,service,period_start,period_end',
      ignoreDuplicates: false,
    });

  if (error) {
    console.error('[GCPSync] Erro no upsert do chunk:', error.message);
    return records.length;
  }
  return 0;
}

/**
 * Executa a sincronização de billing GCP.
 * Pagina chamadas à API para suportar até 100.000 registros.
 * Processa upserts em chunks de 1.000.
 * @param {{ periodDays?: number }} [options]
 * @returns {Promise<{ processed: number, errors: number }>}
 */
export async function runGCPSync({ periodDays = 30 } = {}) {
  const { periodStart, periodEnd } = getDefaultPeriod(periodDays);
  const billingAccountId = ENV.GCP_PROJECT_ID;

  console.log(
    `[GCPSync] Iniciando sync — período: ${periodStart} → ${periodEnd}, projeto: ${billingAccountId}`
  );

  const supabase = await getSupabaseServiceClient();

  let processed = 0;
  let errors = 0;
  let allRecords = [];

  // ── Coleta paginada ──────────────────────────────────────────────────────────
  // A GCP Billing API pode retornar dados paginados via nextPageToken.
  // Continuamos buscando até não haver mais páginas ou atingir MAX_RECORDS.
  let pageToken = undefined;
  let pageCount = 0;

  do {
    pageCount++;
    console.log(`[GCPSync] Buscando página ${pageCount}...`);

    let rawResponse;
    try {
      rawResponse = await fetchBillingData(billingAccountId, periodStart, periodEnd, pageToken);
    } catch (err) {
      console.error(`[GCPSync] Falha ao buscar dados da API (página ${pageCount}):`, err.message);
      errors++;
      break;
    }

    const normalized = normalizeGCP(rawResponse, periodStart, periodEnd);

    // Expande projetos × serviços em registros individuais
    for (const project of normalized.projects) {
      for (const service of project.services || []) {
        allRecords.push(buildBillingRecord(project, service, periodStart, periodEnd));
      }
    }

    pageToken = rawResponse.nextPageToken;

    if (allRecords.length >= MAX_RECORDS) {
      console.warn(
        `[GCPSync] Limite de ${MAX_RECORDS} registros atingido — interrompendo paginação.`
      );
      allRecords = allRecords.slice(0, MAX_RECORDS);
      break;
    }
  } while (pageToken);

  console.log(`[GCPSync] Total de registros coletados: ${allRecords.length}`);

  // ── Upsert em chunks de 1.000 ────────────────────────────────────────────────
  for (let i = 0; i < allRecords.length; i += CHUNK_SIZE) {
    const chunk = allRecords.slice(i, i + CHUNK_SIZE);
    const chunkErrors = await upsertChunk(supabase, chunk);

    if (chunkErrors === 0) {
      processed += chunk.length;
    } else {
      errors += chunkErrors;
    }

    console.log(
      `[GCPSync] Chunk ${Math.floor(i / CHUNK_SIZE) + 1} — ` +
        `processados: ${processed}, erros acumulados: ${errors}`
    );
  }

  console.log(`[GCPSync] Concluído — processed: ${processed}, errors: ${errors}`);
  return { processed, errors };
}
