#!/bin/bash
# Build e push de todas as imagens Docker para o GCR.
# Uso: ./scripts/build-push.sh SEU_PROJECT_ID [TAG]

set -e

PROJECT_ID=${1:?'Informe o PROJECT_ID: ./build-push.sh SEU_PROJECT_ID'}
TAG=${2:-latest}
REGISTRY="gcr.io/${PROJECT_ID}"

SERVICES=(
  "api-gateway"
  "auth-service"
  "billing-service"
  "chat-service"
  "sync-job"
)

echo "🔨 Build e push para ${REGISTRY} (tag: ${TAG})"

# Configura Docker para usar o GCR
gcloud auth configure-docker --quiet

# Build e push de cada serviço
for SERVICE in "${SERVICES[@]}"; do
  IMAGE="${REGISTRY}/finops-${SERVICE}:${TAG}"
  echo ""
  echo "▶ ${SERVICE} → ${IMAGE}"
  docker build -t "${IMAGE}" "services/${SERVICE}/"
  docker push "${IMAGE}"
done

# Frontend — build a partir da raiz do projeto (assets estáticos)
echo ""
echo "▶ frontend → ${REGISTRY}/finops-frontend:${TAG}"
docker build -t "${REGISTRY}/finops-frontend:${TAG}" \
  -f frontend/Dockerfile \
  ../../   # raiz do projeto onde estão index.html, styles.css, etc.
docker push "${REGISTRY}/finops-frontend:${TAG}"

echo ""
echo "✅ Todas as imagens publicadas com tag '${TAG}'"
echo ""
echo "Próximo passo:"
echo "  ./scripts/deploy.sh ${PROJECT_ID} ${TAG}"
