#!/bin/bash
# Aplica todos os manifests Kubernetes no cluster.
# Uso: ./scripts/deploy.sh SEU_PROJECT_ID [TAG]

set -e

PROJECT_ID=${1:?'Informe o PROJECT_ID'}
TAG=${2:-latest}

echo "🚀 Deploy FinOps V3 → projeto: ${PROJECT_ID}, tag: ${TAG}"

# Substitui PROJECT_ID nos manifests base
find ../k8s/base -name "*.yaml" -exec \
  sed -i.bak "s/PROJECT_ID/${PROJECT_ID}/g" {} \;

# Substitui no overlay de produção
sed -i.bak "s/SEU_PROJECT_ID/${PROJECT_ID}/g" \
  ../k8s/overlays/production/kustomization.yaml

# Aplica via kustomize
kubectl apply -k ../k8s/overlays/production

echo ""
echo "⏳ Aguardando pods ficarem prontos..."
kubectl rollout status deployment/api-gateway    -n finops --timeout=120s
kubectl rollout status deployment/auth-service   -n finops --timeout=120s
kubectl rollout status deployment/billing-service -n finops --timeout=120s
kubectl rollout status deployment/chat-service   -n finops --timeout=120s
kubectl rollout status deployment/frontend       -n finops --timeout=120s

echo ""
echo "✅ Deploy concluído!"
echo ""
kubectl get pods -n finops
echo ""
kubectl get ingress -n finops
echo ""
echo "🌐 Acesse: https://finops.suaempresa.com.br"
echo "   (O certificado TLS pode levar até 15 minutos para provisionar)"
