/**
 * Aplica a migration 001 diretamente no Supabase via conexão PostgreSQL.
 * Uso: node backend/migrations/apply.mjs
 */

import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

// Conexão direta ao PostgreSQL do Supabase
// Host: db.<project-ref>.supabase.co  Port: 5432
const client = new Client({
  host: 'db.bpvrkrfjwmlwurfihoku.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'Ex@F1n0ps@2026',
  ssl: { rejectUnauthorized: false }
});

async function main() {
  console.log('🔌 Conectando ao Supabase PostgreSQL...');
  await client.connect();
  console.log('✅ Conectado!\n');

  const sqlPath = join(__dirname, '001_initial_schema.sql');
  const sql = readFileSync(sqlPath, 'utf8');

  console.log('🚀 Executando migration 001_initial_schema.sql...\n');

  try {
    await client.query(sql);
    console.log('✅ Migration executada com sucesso!\n');
  } catch (err) {
    console.error('❌ Erro na migration:', err.message);
    console.log('\nTentando executar statement por statement...\n');
    await runByStatements(sql);
  }

  await verifyTables();
  await client.end();
}

async function runByStatements(sql) {
  // Remove comentários de linha e divide por ;
  const statements = sql
    .replace(/--[^\n]*/g, '')
    .split(/;\s*\n/)
    .map(s => s.trim())
    .filter(s => s.length > 3);

  let ok = 0;
  let skip = 0;

  for (const stmt of statements) {
    try {
      await client.query(stmt);
      ok++;
    } catch (err) {
      if (err.message.includes('already exists') || err.message.includes('duplicate')) {
        skip++;
      } else {
        console.warn(`  ⚠️  ${err.message.slice(0, 80)}`);
      }
    }
  }

  console.log(`  ✅ ${ok} statements executados, ${skip} já existiam\n`);
}

async function verifyTables() {
  console.log('📋 Verificando tabelas criadas:\n');

  const tables = [
    'billing_records',
    'cost_summaries',
    'recommendations',
    'financial_embeddings',
    'audit_log'
  ];

  for (const table of tables) {
    try {
      const res = await client.query(
        `SELECT COUNT(*) FROM information_schema.tables 
         WHERE table_schema = 'public' AND table_name = $1`,
        [table]
      );
      const exists = parseInt(res.rows[0].count) > 0;
      console.log(`  ${exists ? '✅' : '❌'} ${table}`);
    } catch (err) {
      console.log(`  ❌ ${table} — ${err.message}`);
    }
  }

  // Verifica função de busca vetorial
  try {
    const res = await client.query(
      `SELECT COUNT(*) FROM information_schema.routines 
       WHERE routine_schema = 'public' AND routine_name = 'search_financial_context'`
    );
    const exists = parseInt(res.rows[0].count) > 0;
    console.log(`  ${exists ? '✅' : '❌'} search_financial_context (função)`);
  } catch (err) {
    console.log(`  ❌ search_financial_context — ${err.message}`);
  }

  // Verifica extensões
  console.log('\n🔌 Extensões:\n');
  const extensions = ['vector', 'pg_cron', 'uuid-ossp'];
  for (const ext of extensions) {
    try {
      const res = await client.query(
        `SELECT COUNT(*) FROM pg_extension WHERE extname = $1`, [ext]
      );
      const exists = parseInt(res.rows[0].count) > 0;
      console.log(`  ${exists ? '✅' : '⚠️ '} ${ext}`);
    } catch (err) {
      console.log(`  ❌ ${ext} — ${err.message}`);
    }
  }
}

main().catch(err => {
  console.error('Erro fatal:', err.message);
  process.exit(1);
});
