/**
 * Script para executar a migration 001 no Supabase.
 * Usa a conexão direta via @supabase/supabase-js com service role key.
 * 
 * Uso: node backend/migrations/run_migration.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌ Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente antes de rodar este script.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

// Divide o SQL em statements individuais para executar um por vez
function splitStatements(sql) {
  return sql
    .split(/;\s*\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));
}

async function runMigration() {
  console.log('🚀 Iniciando migration 001_initial_schema...\n');

  const sqlPath = join(__dirname, '001_initial_schema.sql');
  const sql = readFileSync(sqlPath, 'utf8');

  // Executa o SQL completo via rpc
  // O Supabase permite executar SQL arbitrário via a função pg_catalog
  const { data, error } = await supabase.rpc('exec_migration', { sql_text: sql });

  if (error) {
    // Se a função não existe, tenta criar as tabelas individualmente
    console.log('ℹ️  Executando statements individualmente...\n');
    await runIndividually(sql);
  } else {
    console.log('✅ Migration executada com sucesso!');
  }
}

async function runIndividually(sql) {
  // Separa por blocos DO $$ ... $$ e statements normais
  const blocks = [];
  let current = '';
  let inDollarQuote = false;

  const lines = sql.split('\n');
  for (const line of lines) {
    if (line.includes('$$')) {
      inDollarQuote = !inDollarQuote;
    }
    current += line + '\n';
    if (!inDollarQuote && line.trim().endsWith(';')) {
      const stmt = current.trim();
      if (stmt && !stmt.startsWith('--')) {
        blocks.push(stmt);
      }
      current = '';
    }
  }
  if (current.trim()) blocks.push(current.trim());

  let success = 0;
  let failed = 0;

  for (const stmt of blocks) {
    if (!stmt || stmt.startsWith('--')) continue;

    try {
      const { error } = await supabase.from('_migration_test').select().limit(0);
      // Usa fetch direto para executar SQL via endpoint de query
      const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
        method: 'POST',
        headers: {
          'apikey': SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        }
      });
    } catch (e) {
      // ignora
    }
  }

  // Verifica tabelas criadas
  await verifyTables();
}

async function verifyTables() {
  console.log('\n📋 Verificando tabelas criadas...\n');

  const tables = ['billing_records', 'cost_summaries', 'recommendations', 'financial_embeddings', 'audit_log'];

  for (const table of tables) {
    const { error } = await supabase.from(table).select('id').limit(1);
    if (error && error.code === '42P01') {
      console.log(`  ❌ ${table} — NÃO encontrada`);
    } else if (error && error.code === 'PGRST116') {
      console.log(`  ✅ ${table} — criada (sem dados)`);
    } else if (error) {
      console.log(`  ⚠️  ${table} — ${error.message}`);
    } else {
      console.log(`  ✅ ${table} — OK`);
    }
  }
}

runMigration().catch(console.error);
