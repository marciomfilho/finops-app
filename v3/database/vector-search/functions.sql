-- FinOps V3 — Funções de busca vetorial com pgvector
-- Executar após 001_schema.sql

-- ── search_financial_context ──────────────────────────────────────────────────
-- Busca os N chunks mais similares ao embedding da query.
-- Usa distância cosine (<=>): menor distância = maior similaridade.
-- Retorna apenas chunks acima do threshold de similaridade.
CREATE OR REPLACE FUNCTION search_financial_context(
  query_embedding  VECTOR(768),
  match_threshold  FLOAT   DEFAULT 0.75,
  match_count      INT     DEFAULT 10
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
    -- Converte distância cosine em similaridade (0-1)
    (1 - (fe.embedding <=> query_embedding))::FLOAT AS similarity
  FROM financial_embeddings fe
  WHERE (1 - (fe.embedding <=> query_embedding)) >= match_threshold
  ORDER BY fe.embedding <=> query_embedding   -- menor distância primeiro
  LIMIT match_count;
END;
$$;

-- ── search_by_project ─────────────────────────────────────────────────────────
-- Busca embeddings de um projeto específico por similaridade.
CREATE OR REPLACE FUNCTION search_by_project(
  query_embedding  VECTOR(768),
  p_project_id     TEXT,
  match_threshold  FLOAT DEFAULT 0.70,
  match_count      INT   DEFAULT 5
)
RETURNS TABLE (
  id         UUID,
  content    TEXT,
  metadata   JSONB,
  similarity FLOAT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    fe.id,
    fe.content,
    fe.metadata,
    (1 - (fe.embedding <=> query_embedding))::FLOAT AS similarity
  FROM financial_embeddings fe
  WHERE
    (fe.metadata->>'project_id') = p_project_id
    AND (1 - (fe.embedding <=> query_embedding)) >= match_threshold
  ORDER BY fe.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ── get_billing_records_without_embeddings ────────────────────────────────────
-- Retorna billing_records que ainda não têm embedding gerado.
-- Usado pelo sync-job para processar apenas registros novos.
CREATE OR REPLACE FUNCTION get_billing_records_without_embeddings()
RETURNS SETOF billing_records
LANGUAGE sql AS $$
  SELECT br.*
  FROM billing_records br
  WHERE NOT EXISTS (
    SELECT 1 FROM financial_embeddings fe
    WHERE fe.record_type = 'billing_record'
      AND fe.record_id = br.id
  )
  ORDER BY br.synced_at DESC
  LIMIT 1000;
$$;

-- ── embedding_coverage_stats ──────────────────────────────────────────────────
-- Retorna estatísticas de cobertura de embeddings por provider.
CREATE OR REPLACE FUNCTION embedding_coverage_stats()
RETURNS TABLE (
  provider        TEXT,
  total_records   BIGINT,
  embedded        BIGINT,
  coverage_pct    NUMERIC
)
LANGUAGE sql AS $$
  SELECT
    br.provider,
    COUNT(br.id)                                                    AS total_records,
    COUNT(fe.record_id)                                             AS embedded,
    ROUND(COUNT(fe.record_id)::NUMERIC / NULLIF(COUNT(br.id), 0) * 100, 1) AS coverage_pct
  FROM billing_records br
  LEFT JOIN financial_embeddings fe
    ON fe.record_type = 'billing_record' AND fe.record_id = br.id
  GROUP BY br.provider;
$$;
