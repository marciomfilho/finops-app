#!/bin/bash
# Cria o cluster GKE e configura Workload Identity.
# Uso: ./scripts/create-cluster.sh SEU_PROJECT_ID

set -e

PROJECT_ID=${1:?'Informe o PROJECT_ID'}
CLUSTER_NAME="finops-cluster"
REGION="us-central1"
GSA_NAME="finops-sa"
GSA_EMAIL="${GSA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "🚀 Criando cluster GKE: ${CLUSTER_NAME} em ${REGION}"

gcloud config set project "${PROJECT_ID}"

# Habilita APIs necessárias
gcloud services enable \
  container.googleapis.com \
  secretmanager.googleapis.com \
  cloudbilling.googleapis.com \
  artifactregistry.googleapis.com \
  --quiet

# Cria cluster com Workload Identity habilitado
gcloud container clusters create "${CLUSTER_NAME}" \
  --region="${REGION}" \
  --num-nodes=2 \
  --machine-type=e2-standard-2 \
  --workload-pool="${PROJECT_ID}.svc.id.goog" \
  --enable-autoscaling \
  --min-nodes=2 \
  --max-nodes=6 \
  --enable-autorepair \
  --enable-autoupgrade \
  --quiet

# Obtém credenciais
gcloud container clusters get-credentials "${CLUSTER_NAME}" --region="${REGION}"

# Cria Google Service Account para os pods
gcloud iam service-accounts create "${GSA_NAME}" \
  --display-name="FinOps Service Account" \
  --quiet 2>/dev/null || echo "GSA já existe"

# Permissões: Secret Manager + Billing
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${GSA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor" --quiet

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${GSA_EMAIL}" \
  --role="roles/billing.viewer" --quiet

# Vincula KSA → GSA (Workload Identity)
gcloud iam service-accounts add-iam-policy-binding "${GSA_EMAIL}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="serviceAccount:${PROJECT_ID}.svc.id.goog[finops/finops-sa]" --quiet

# IP estático para o Ingress
gcloud compute addresses create finops-ip \
  --global --quiet 2>/dev/null || echo "IP já existe"

STATIC_IP=$(gcloud compute addresses describe finops-ip --global --format='value(address)')
echo ""
echo "✅ Cluster criado com sucesso!"
echo "   IP estático: ${STATIC_IP}"
echo "   Configure o DNS: finops.suaempresa.com.br → ${STATIC_IP}"
echo ""
echo "Próximo passo:"
echo "  ./scripts/deploy.sh ${PROJECT_ID}"
