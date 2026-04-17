/**
 * Sync Job — geração e armazenamento de embeddings para billing_records.
 * Busca registros sem embedding correspondente em financial_embeddings,
 * gera texto descritivo, chama Gemini text-embedding-004 e insere o resultado.
 * Processa em chunks de 100 para respeitar rate limits da Gemini Embedding API.
 * Requirements: 4.7
 */

import { getSupabaseServiceClient } from '../src/services/supabase.js';
import { generateEmbedding } from '../src/services/geminiEmbedding.js';

const CHUNK_SIZE = 100;

/**
 * Gera texto descritivo de um registro de billing para uso como input do embedding.
 * @param {Object} record - Registro de billing_records
 * @returns {string}
 */
function buildDescriptiveText(record) {
  return (
    `Provider: ${record.provider ?? 'unknown'}, ` +
    `Project: ${record.project_name ?? record.project_id ?? 'unknown'}, ` +
    `Service: ${record.service ?? 'unknown'}, ` +
    `Cost: ${record.cost ?? 0} ${record.currency ?? 'USD'}, ` +
    `Period: ${record.period_start ?? ''} to ${record.period_end ?? ''}, ` +
    `Region: ${record.region ?? 'global'}`
  );
}

/**
 * Busca registros de billing_records que ainda não possuem embedding em financial_embeddings.
 * @param {Object} supabase - Cliente Supabase
 * @returns {Promise<Array>}
 */
async function fetchRecordsWithoutEmbeddings(supabase) {
  const { data, error } = await supabase.rpc('get_billing_records_without_embeddings');

  // Fallback: se a RPC não existir, usa query direta via from()
  if (error) {
    console.warn(
      '[EmbeddingSync] RPC não disponível, usando query alternativa:',
      error.message
    );
    return fetchRecordsWithoutEmbeddingsFallback(supabase);
  }

  return data || [];
}

/**
 * Fallback: busca registros sem embedding usando query direta.
 * Usa NOT IN sobre os record_ids já presentes em financial_embeddings.
 * @param {Object} supabase - Cliente Supabase
 * @returns {Promise<Array>}
 */
async function fetchRecordsWithoutEmbeddingsFallback(supabase) {
  // Busca todos os record_ids já embedados para billing_record
  const { data: embedded, error: embError } = await supabase
    .from('financial_embeddings')
    .select('record_id')
    .eq('record_type', 'billing_record');

  if (embError) {
    throw new Error(`[EmbeddingSync] Erro ao buscar embeddings existentes: ${embError.message}`);
  }

  const embeddedIds = (embedded || []).map((e) => e.record_id);

  let query = supabase.from('billing_records').select('*');

  if (embeddedIds.length > 0) {
    query = query.not('id', 'in', `(${embeddedIds.join(',')})`);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`[EmbeddingSync] Erro ao buscar billing_records: ${error.message}`);
  }

  return data || [];
}

/**
 * Insere um embedding em financial_embeddings.
 * @param {Object} supabase - Cliente Supabase
 * @param {Object} record - Registro de billing_records
 * @param {string} content - Texto descritivo gerado
 * @param {number[]} embedding - Vetor de 768 floats
 * @returns {Promise<boolean>} true se inserido com sucesso
 */
async function insertEmbedding(supabase, record, content, embedding) {
  const { error } = await supabase.from('financial_embeddings').insert({
    record_type: 'billing_record',
    record_id: record.id,
    content,
    embedding,
    metadata: {
      provider: record.provider,
      project_id: record.project_id,
      project_name: record.project_name,
      service: record.service,
      cost: record.cost,
      currency: record.currency,
      period_start: record.period_start,
      period_end: record.period_end,
      region: record.region,
    },
  });

  if (error) {
    console.error(
      `[EmbeddingSync] Erro ao inserir embedding para record ${record.id}:`,
      error.message
    );
    return false;
  }

  return true;
}

/**
 * Processa um chunk de registros: gera embeddings e insere em financial_embeddings.
 * @param {Object} supabase - Cliente Supabase
 * @param {Object[]} chunk - Registros a processar
 * @returns {Promise<{ processed: number, errors: number }>}
 */
async function processChunk(supabase, chunk) {
  let processed = 0;
  let errors = 0;

  for (const record of chunk) {
    const content = buildDescriptiveText(record);

    let embedding;
    try {
      embedding = await generateEmbedding(content);
    } catch (err) {
      console.error(
        `[EmbeddingSync] Falha ao gerar embedding para record ${record.id}:`,
        err.message
      );
      errors++;
      continue;
    }

    const ok = await insertEmbedding(supabase, record, content, embedding);
    if (ok) {
      processed++;
    } else {
      errors++;
    }
  }

  return { processed, errors };
}

/**
 * Executa a sincronização de embeddings para billing_records.
 * Processa em chunks de 100 para respeitar rate limits da Gemini Embedding API.
 * @returns {Promise<{ processed: number, errors: number }>}
 */
export async function runEmbeddingSync() {
  console.log('[EmbeddingSync] Iniciando geração de embeddings...');

  const supabase = await getSupabaseServiceClient();

  let records;
  try {
    records = await fetchRecordsWithoutEmbeddings(supabase);
  } catch (err) {
    console.error('[EmbeddingSync] Erro ao buscar registros:', err.message);
    return { processed: 0, errors: 1 };
  }

  console.log(`[EmbeddingSync] Registros sem embedding: ${records.length}`);

  if (records.length === 0) {
    console.log('[EmbeddingSync] Nenhum registro pendente. Concluído.');
    return { processed: 0, errors: 0 };
  }

  let totalProcessed = 0;
  let totalErrors = 0;

  for (let i = 0; i < records.length; i += CHUNK_SIZE) {
    const chunk = records.slice(i, i + CHUNK_SIZE);
    const chunkIndex = Math.floor(i / CHUNK_SIZE) + 1;
    const totalChunks = Math.ceil(records.length / CHUNK_SIZE);

    console.log(`[EmbeddingSync] Processando chunk ${chunkIndex}/${totalChunks} (${chunk.length} registros)...`);

    const { processed, errors } = await processChunk(supabase, chunk);
    totalProcessed += processed;
    totalErrors += errors;

    console.log(
      `[EmbeddingSync] Chunk ${chunkIndex} concluído — ` +
        `processados: ${totalProcessed}, erros acumulados: ${totalErrors}`
    );
  }

  console.log(
    `[EmbeddingSync] Concluído — processed: ${totalProcessed}, errors: ${totalErrors}`
  );

  return { processed: totalProcessed, errors: totalErrors };
}
