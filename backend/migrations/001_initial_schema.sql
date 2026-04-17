-- FinOps Dashboard V2 — EXA
-- Migration 001: Schema inicial
-- Executar no Supabase SQL Editor

-- ─── Extensões ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgvector";
CREATE EXTENSION IF NOT EXISTS "pg_cron";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Enums ────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE recommendation_source AS ENUM ('gcp_recommender', 'huawei', 'gemini_ai');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE recommendation_status AS ENUM ('open', 'in_progress', 'done', 'dismissed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── billing_records ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS billing_records (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider      TEXT NOT NULL CHECK (provider IN ('gcp', 'huawei')),
  project_id    TEXT NOT NULL,
  project_name  TEXT NOT NULL,
  service       TEXT,
  cost          NUMERIC(14, 4) NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'BRL',
  period_start  TIMESTAMPTZ NOT NULL,
  period_end    TIMESTAMPTZ NOT NULL,
  region        TEXT,
  tags          JSONB DEFAULT '{}',
  raw_payload   JSONB,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, project_id, service, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_billing_provider_period ON billing_records (provider, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_billing_project         ON billing_records (project_id);

-- ─── cost_summaries ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cost_summaries (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider         TEXT NOT NULL,
  period_start     TIMESTAMPTZ NOT NULL,
  period_end       TIMESTAMPTZ NOT NULL,
  total_cost       NUMERIC(14, 4) NOT NULL DEFAULT 0,
  total_waste      NUMERIC(14, 4) NOT NULL DEFAULT 0,
  potential_saving NUMERIC(14, 4) NOT NULL DEFAULT 0,
  active_projects  INTEGER NOT NULL DEFAULT 0,
  payload          JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_summaries_provider_period ON cost_summaries (provider, period_start DESC);

-- ─── recommendations ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recommendations (
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
);

CREATE INDEX IF NOT EXISTS idx_rec_provider_status ON recommendations (provider, status);

-- ─── financial_embeddings ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS financial_embeddings (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  record_type TEXT NOT NULL,
  record_id   UUID NOT NULL,
  content     TEXT NOT NULL,
  embedding   VECTOR(768) NOT NULL,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice HNSW para busca vetorial eficiente (cosine similarity)
CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw ON financial_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ─── audit_log (append-only) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_email  TEXT,
  action      TEXT NOT NULL,
  payload     JSONB DEFAULT '{}',
  ip_address  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user_created ON audit_log (user_email, created_at DESC);

-- ─── RLS: habilitar em todas as tabelas ───────────────────────────────────────
ALTER TABLE billing_records      ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_summaries       ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log            ENABLE ROW LEVEL SECURITY;

-- ─── Políticas RLS ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "billing_read"     ON billing_records;
DROP POLICY IF EXISTS "summaries_read"   ON cost_summaries;
DROP POLICY IF EXISTS "rec_read"         ON recommendations;
DROP POLICY IF EXISTS "embeddings_read"  ON financial_embeddings;
DROP POLICY IF EXISTS "audit_admin_read" ON audit_log;
DROP POLICY IF EXISTS "audit_insert"     ON audit_log;
DROP POLICY IF EXISTS "audit_no_update"  ON audit_log;
DROP POLICY IF EXISTS "audit_no_delete"  ON audit_log;

CREATE POLICY "billing_read"     ON billing_records      FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "summaries_read"   ON cost_summaries       FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "rec_read"         ON recommendations      FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "embeddings_read"  ON financial_embeddings FOR SELECT USING (auth.role() = 'authenticated');

-- audit_log: leitura só para admin
CREATE POLICY "audit_admin_read" ON audit_log
  FOR SELECT USING (auth.jwt() ->> 'role' = 'admin');

-- audit_log: INSERT permitido (service role do backend)
CREATE POLICY "audit_insert" ON audit_log
  FOR INSERT WITH CHECK (true);

-- audit_log: imutabilidade — bloqueia UPDATE e DELETE para todos
CREATE POLICY "audit_no_update" ON audit_log FOR UPDATE USING (false);
CREATE POLICY "audit_no_delete" ON audit_log FOR DELETE USING (false);

-- ─── Função: busca vetorial por similaridade ──────────────────────────────────
CREATE OR REPLACE FUNCTION search_financial_context(
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
LANGUAGE plpgsql AS $$
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
$$;
