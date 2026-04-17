/**
 * Cliente Supabase com service role key (bypass RLS).
 * Usado apenas pelo backend — nunca exposto ao frontend.
 * Requirements: 5.1, 5.2, 7.2
 */

import { createClient } from '@supabase/supabase-js';
import { ENV } from '../config/env.js';
import { getSecret } from '../config/secrets.js';

let _serviceClient = null;

/**
 * Retorna cliente Supabase com service role key (singleton lazy).
 * Obtém a chave via getSecret (Secret Manager em PROD, env var em DEV).
 */
export async function getSupabaseServiceClient() {
  if (_serviceClient) return _serviceClient;

  const serviceKey = await getSecret('supabase-service-role-key');
  _serviceClient = createClient(ENV.SUPABASE_URL, serviceKey);
  return _serviceClient;
}

/**
 * Busca resumos de custo por período.
 * @param {number} periodDays
 * @returns {Promise<Array>}
 */
export async function getCostSummaries(periodDays) {
  const supabase = await getSupabaseServiceClient();
  const since = new Date(Date.now() - periodDays * 86400000).toISOString();

  const { data, error } = await supabase
    .from('cost_summaries')
    .select('*')
    .gte('period_start', since)
    .order('period_start', { ascending: false });

  if (error) throw new Error(`[Supabase] getCostSummaries: ${error.message}`);
  return data;
}

/**
 * Busca registros de billing por provider e período.
 * @param {string} provider - 'gcp' | 'huawei' | 'all'
 * @param {number} periodDays
 * @returns {Promise<Array>}
 */
export async function getBillingRecords(provider, periodDays) {
  const supabase = await getSupabaseServiceClient();
  const since = new Date(Date.now() - periodDays * 86400000).toISOString();

  let query = supabase
    .from('billing_records')
    .select('*')
    .gte('period_start', since)
    .order('cost', { ascending: false });

  if (provider !== 'all') query = query.eq('provider', provider);

  const { data, error } = await query;
  if (error) throw new Error(`[Supabase] getBillingRecords: ${error.message}`);
  return data;
}

/**
 * Busca chunks por similaridade vetorial via RPC search_financial_context.
 * @param {number[]} embedding - Vetor de 768 dimensões
 * @param {number} limit - Número máximo de chunks
 * @param {number} threshold - Similaridade mínima (0-1)
 * @returns {Promise<Array>}
 */
export async function searchFinancialContext(embedding, limit = 10, threshold = 0.75) {
  const supabase = await getSupabaseServiceClient();
  const { data, error } = await supabase.rpc('search_financial_context', {
    query_embedding: embedding,
    match_threshold: threshold,
    match_count: limit,
  });
  if (error) throw new Error(`[Supabase] searchFinancialContext: ${error.message}`);
  return data || [];
}
