# FinOps Dashboard V3 — Microserviços GKE

## Arquitetura

```
Internet
    │
    ▼
┌─────────────────────────────────────────────────────┐
│  GKE Ingress (HTTPS / Cloud Load Balancer)          │
│  finops.suaempresa.com.br                           │
└──────────┬──────────────────────────────────────────┘
           │
    ┌──────▼──────┐
    │ api-gateway │  :8080  (roteamento + rate limit + CORS)
    └──┬──┬──┬───┘
       │  │  │
  ┌────┘  │  └────────────────┐
  │       │                   │
  ▼       ▼                   ▼
┌──────┐ ┌───────────────┐ ┌──────────────┐
│ auth │ │billing-service│ │ chat-service │
│ :3001│ │    :3002      │ │    :3003     │
└──────┘ └───────┬───────┘ └──────┬───────┘
                 │                │
                 ▼                ▼
         ┌───────────────────────────────┐
         │   PostgreSQL + pgvector       │
         │   (Cloud SQL / Supabase)      │
         └───────────────────────────────┘
                 ▲
         ┌───────┴───────┐
         │   sync-job    │  (CronJob K8s — diário 02:00)
         │   :3004       │  gcp → huawei → embeddings → summaries
         └───────────────┘

Frontend: Nginx container servindo HTML/CSS/JS estático
```

## Microserviços

| Serviço | Porta | Responsabilidade |
|---|---|---|
| `api-gateway` | 8080 | Roteamento, rate limit, CORS, health |
| `auth-service` | 3001 | Google OAuth2, JWT, Supabase auth |
| `billing-service` | 3002 | Billing GCP/Huawei, summaries, recommendations |
| `chat-service` | 3003 | RAG pipeline, embeddings, Gemini |
| `sync-job` | — | CronJob: coleta GCP/Huawei → pgvector |
| `frontend` | 80 | Nginx servindo assets estáticos |

## Deploy rápido

```bash
# 1. Build e push de todas as imagens
./scripts/build-push.sh PROJECT_ID

# 2. Criar cluster GKE (se não existir)
./scripts/create-cluster.sh

# 3. Aplicar todos os manifests
kubectl apply -k k8s/overlays/production

# 4. Verificar
kubectl get pods -n finops
kubectl get ingress -n finops
```

## Banco de dados vetorizado

O banco usa PostgreSQL com extensão `pgvector` para busca semântica.
A tabela `financial_embeddings` armazena vetores de 768 dimensões (Gemini text-embedding-004)
com índice HNSW para busca por similaridade cosine.

Ver `database/` para migrations e funções de busca vetorial.
