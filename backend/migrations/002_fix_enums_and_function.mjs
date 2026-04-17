/**
 * Corrige enums e função search_financial_context que falharam na migration 001.
 */

import pg from 'pg';
const { Client } = pg;

const client = new Client({
  host: 'db.bpvrkrfjwmlwurfihoku.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'Ex@F1n0ps@2026',
  ssl: { rejectUnauthorized: false }
});

const statements = [
  // Enums (sem DO $$ para evitar problema de parsing)
  `CREATE TYPE recommendation_source AS ENUM ('gcp_recommender', 'huawei', 'gemini_ai')`,
  `CREATE TYPE recommendation_status AS ENUM ('open', 'in_progress', 'done', 'dismissed')`,

  // Tabela recommendations (depende dos enums)
  `CREATE TABLE IF NOT EXISTS recommendations (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source      recommendation_source NOT NULL,
    provider    TEXT NOT NULL,
    title       TEXT NOT NULL,
    description TEXT,
    saving      NUMERIC(14, 4) NOT NULL DEFAULT 0,
    priority    TEXT CHECK (priority IN ('critical', 'high', 'medium', 'low')) DEFAULT 'medium',
    status      recommendation_status NOT NULL DEFAULT 'open',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE INDEX IF NOT EXISTS idx_rec_provider_status ON recommendations (provider, status)`,

  `ALTER TABLE recommendations ENABLE ROW LEVEL SECURITY`,

  `CREATE POLICY "rec_read" ON recommendations FOR SELECT USING (auth.role() = 'authenticated')`,

  // Função de busca vetorial (usando $func$ como delimitador alternativo)
  `CREATE OR REPLACE FUNCTION search_financial_context(
    query_embedding VECTOR(768),
    match_threshold FLOAT DEFAULT 0.75,
    match_count     INT   DEFAULT 10
  )
  RETURNS TABLE (
    id          UUID,
    record_type TEXT,
    record_id   UUID,
    content     TEXT,
    metadata    JSONB,
    similarity  FLOAT
  )
  LANGUAGE plpgsql AS $func$
  BEGIN
    RETURN QUERY
    SELECT
      fe.id,
      fe.record_type,
      fe.record_id,
      fe.content,
      fe.metadata,
      1 - (fe.embedding <=> query_embedding) AS similarity
    FROM financial_embeddings fe
    WHERE 1 - (fe.embedding <=> query_embedding) >= match_threshold
    ORDER BY fe.embedding <=> query_embedding
    LIMIT match_count;
  END;
  $func$`
];

async function main() {
  console.log('🔌 Conectando...');
  await client.connect();
  console.log('✅ Conectado!\n');

  for (const stmt of statements) {
    const preview = stmt.trim().slice(0, 60).replace(/\n/g, ' ');
    try {
      await client.query(stmt);
      console.log(`✅ ${preview}...`);
    } catch (err) {
      if (err.message.includes('already exists')) {
        console.log(`⏭️  ${preview}... (já existe)`);
      } else {
        console.log(`❌ ${preview}...\n   → ${err.message}`);
      }
    }
  }

  // Verificação final
  console.log('\n📋 Verificação final:\n');
  const tables = ['billing_records', 'cost_summaries', 'recommendations', 'financial_embeddings', 'audit_log'];
  for (const t of tables) {
    const res = await client.query(
      `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [t]
    );
    console.log(`  ${parseInt(res.rows[0].count) > 0 ? '✅' : '❌'} ${t}`);
  }

  const fnRes = await client.query(
    `SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema='public' AND routine_name='search_financial_context'`
  );
  console.log(`  ${parseInt(fnRes.rows[0].count) > 0 ? '✅' : '❌'} search_financial_context`);

  await client.end();
  console.log('\n🎉 Pronto!');
}

main().catch(err => {
  console.error('Erro:', err.message);
  process.exit(1);
});
