#!/bin/bash
# Cria os segredos no Google Secret Manager.
# Uso: ./scripts/setup-secrets.sh SEU_PROJECT_ID
# Os valores são lidos de variáveis de ambiente para não ficarem no histórico do shell.

set -e

PROJECT_ID=${1:?'Informe o PROJECT_ID'}

echo "🔐 Criando segredos no Secret Manager (projeto: ${PROJECT_ID})"
echo "   Defina as variáveis de ambiente antes de rodar este script:"
echo ""
echo "   export HUAWEI_AK=..."
echo "   export HUAWEI_SK=..."
echo "   export GCP_SA_JSON=\$(cat service-account.json)"
echo "   export SUPABASE_SERVICE_ROLE_KEY=eyJ..."
echo "   export GEMINI_API_KEY=..."
echo "   export GOOGLE_CLIENT_SECRET=..."
echo ""

create_secret() {
  local NAME=$1
  local VALUE=$2
  if [ -z "${VALUE}" ]; then
    echo "⚠️  ${NAME} não definido — pulando"
    return
  fi
  echo -n "${VALUE}" | gcloud secrets create "${NAME}" \
    --data-file=- --project="${PROJECT_ID}" --quiet 2>/dev/null \
  || echo -n "${VALUE}" | gcloud secrets versions add "${NAME}" \
    --data-file=- --project="${PROJECT_ID}" --quiet
  echo "   ✓ ${NAME}"
}

create_secret "huawei-ak"               "${HUAWEI_AK}"
create_secret "huawei-sk"               "${HUAWEI_SK}"
create_secret "gcp-service-account-json" "${GCP_SA_JSON}"
create_secret "supabase-service-role-key" "${SUPABASE_SERVICE_ROLE_KEY}"
create_secret "gemini-api-key"          "${GEMINI_API_KEY}"
create_secret "google-client-secret"    "${GOOGLE_CLIENT_SECRET}"

echo ""
echo "✅ Segredos configurados no Secret Manager"
