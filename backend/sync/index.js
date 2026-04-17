/**
 * Entry point do Sync Job.
 * Orquestra a execução sequencial dos módulos de sincronização:
 * gcpSync → huaweiSync → embeddingSync → summarySync
 * Registra início e fim no audit_log com totais de registros e erros.
 * Requirements: 3.3, 4.1, 10.4, 12.4
 */

import { loadAllSecrets } from '../src/config/secrets.js';
import { getSupabaseServiceClient } from '../src/services/supabase.js';
import { runGCPSync } from './gcpSync.js';
import { runHuaweiSync } from './huaweiSync.js';
import { runEmbeddingSync } from './embeddingSync.js';
import { runSummarySync } from './summarySync.js';

async function logAudit(supabase, action, payload) {
  const { error } = await supabase.from('audit_log').insert({
    user_email: 'sync-job@system',
    action,
    payload,
    ip_address: null,
    created_at: new Date().toISOString(),
  });
  if (error) {
    console.error(`[SyncJob] Falha ao registrar audit_log (${action}):`, error.message);
  }
}

async function main() {
  // 1. Carregar segredos — encerra com erro se falhar
  try {
    await loadAllSecrets();
  } catch (err) {
    console.error('[SyncJob] Falha ao carregar segredos:', err.message);
    process.exit(1);
  }

  const supabase = await getSupabaseServiceClient();
  const startedAt = new Date().toISOString();

  await logAudit(supabase, 'sync:start', { started_at: startedAt });

  const steps = [
    { name: 'gcpSync',       run: runGCPSync },
    { name: 'huaweiSync',    run: runHuaweiSync },
    { name: 'embeddingSync', run: runEmbeddingSync },
    { name: 'summarySync',   run: runSummarySync },
  ];

  const results = [];
  let totalProcessed = 0;
  let totalErrors = 0;

  // 2. Execução sequencial
  for (const step of steps) {
    console.log(`[SyncJob] Iniciando ${step.name}...`);
    try {
      const { processed, errors } = await step.run();
      console.log(`[SyncJob] ${step.name} concluído — processed: ${processed}, errors: ${errors}`);
      results.push({ step: step.name, processed, errors });
      totalProcessed += processed;
      totalErrors += errors;
    } catch (err) {
      console.error(`[SyncJob] ${step.name} falhou com exceção:`, err.message);
      results.push({ step: step.name, processed: 0, errors: 1, exception: err.message });
      totalErrors += 1;
    }
  }

  const finishedAt = new Date().toISOString();

  // 3. Registrar fim no audit_log
  await logAudit(supabase, 'sync:end', {
    started_at: startedAt,
    finished_at: finishedAt,
    total_processed: totalProcessed,
    total_errors: totalErrors,
    steps: results,
  });

  console.log(
    `[SyncJob] Concluído — total processados: ${totalProcessed}, total erros: ${totalErrors}`
  );

  // Encerra com código de erro se houve falhas
  if (totalErrors > 0) {
    process.exit(1);
  }
}

main();
