-- FinOps V3 — Schema completo com pgvector
-- Executar no Supabase SQL Editor ou via psql

-- ── Extensões ─────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgvector";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_cron";

-- ── Enums ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE recommendation_source AS ENUM ('gcp_recommender', 'huawei', 'gemini_ai');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE recommendation_status AS ENUM ('open', 'in_progress', 'done', 'dismissed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── billing_records ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS billing_records (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider     TEXT        NOT NULL CHECK (provider IN ('gcp', 'huawei')),
  project_id   TEXT        NOT NULL,
  project_name TEXT        NOT NULL,
  service      TEXT,
  cost         NUMERIC(14,4) NOT NULL DEFAULT 0,
  currency     TEXT        NOT NULL DEFAULT 'BRL',
  period_start TIMESTAMPTZ NOT NULL,
  period_end   TIMESTAMPTZ NOT NULL,
  region       TEXT,
  tags         JSONB       DEFAULT '{}',
  raw_payload  JSONB,
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, project_id, service, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_billing_provider_period ON billing_records (provider, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_billing_project         ON billing_records (project_id);
CREATE INDEX IF NOT EXISTS idx_billing_tags            ON billing_records USING gin (tags);

-- ── cost_summaries ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cost_summaries (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider         TEXT        NOT NULL,
  period_start     TIMESTAMPTZ NOT NULL,
  period_end       TIMESTAMPTZ NOT NULL,
  total_cost       NUMERIC(14,4) NOT NULL DEFAULT 0,
  total_waste      NUMERIC(14,4) NOT NULL DEFAULT 0,
  potential_saving NUMERIC(14,4) NOT NULL DEFAULT 0,
  active_projects  INTEGER     NOT NULL DEFAULT 0,
  payload          JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_summaries_provider_period ON cost_summaries (provider, period_start DESC);

-- ── recommendations ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recommendations (
  id          UUID                   PRIMARY KEY DEFAULT uuid_generate_v4(),
  source      recommendation_source  NOT NULL,
  provider    TEXT                   NOT NULL,
  title       TEXT                   NOT NULL,
  description TEXT,
  saving      NUMERIC(14,4)          NOT NULL DEFAULT 0,
  priority    TEXT CHECK (priority IN ('critical','high','medium','low')) DEFAULT 'medium',
  status      recommendation_status  NOT NULL DEFAULT 'open',
  created_at  TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ            NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rec_provider_status ON recommendations (provider, status);

-- ── financial_embeddings (banco vetorizado) ───────────────────────────────────
-- Armazena vetores de 768 dimensões gerados pelo Gemini text-embedding-004.
-- Índice HNSW para busca por similaridade cosine em O(log n).
CREATE TABLE IF NOT EXISTS financial_embeddings (
  id          UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  record_type TEXT    NOT NULL,                    -- 'billing_record' | 'summary' | 'recommendation'
  record_id   UUID    NOT NULL,
  content     TEXT    NOT NULL,                    -- texto descritivo usado para gerar o embedding
  embedding   VECTOR(768) NOT NULL,               -- vetor Gemini text-embedding-004
  metadata    JSONB   DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice HNSW: busca aproximada por vizinhos mais próximos (cosine similarity)
-- m=16: número de conexões por nó; ef_construction=64: qualidade do índice
CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw ON financial_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_embeddings_record ON financial_embeddings (record_type, record_id);

-- ── audit_log (append-only) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_email TEXT,
  action     TEXT        NOT NULL,
  payload    JSONB       DEFAULT '{}',
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user_created ON audit_log (user_email, created_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE billing_records      ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_summaries       ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log            ENABLE ROW LEVEL SECURITY;

-- Leitura para usuários autenticados
CREATE POLICY "billing_read"    ON billing_records      FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "summaries_read"  ON cost_summaries       FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "rec_read"        ON recommendations      FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "embeddings_read" ON financial_embeddings FOR SELECT USING (auth.role() = 'authenticated');

-- audit_log: leitura só admin, insert livre (service role), imutável
CREATE POLICY "audit_admin_read" ON audit_log FOR SELECT USING (auth.jwt() ->> 'role' = 'admin');
CREATE POLICY "audit_insert"     ON audit_log FOR INSERT WITH CHECK (true);
CREATE POLICY "audit_no_update"  ON audit_log FOR UPDATE USING (false);
CREATE POLICY "audit_no_delete"  ON audit_log FOR DELETE USING (false);
