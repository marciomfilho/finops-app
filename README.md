# GCP FinOps Dashboard

Painel executivo de controle de custos e otimização para Google Cloud Platform.

## Funcionalidades

- **Visão Geral** — KPIs de custo, gasto por serviço, top projetos, regiões e orçamento
- **Projetos** — Detalhamento por projeto com comparativo mês a mês
- **Desperdícios** — Instâncias ociosas, discos não usados, IPs reservados, SQL superdimensionado
- **Recomendações** — Ações priorizadas com economia estimada (mensal e anual)
- **Tendências** — Projeção de gastos, crescimento MoM e heatmap de uso

## Como usar

### Modo Demonstração
Abra `index.html` no navegador e clique em **"Usar dados de demonstração"**.

### Modo Real (GCP)

1. Crie um projeto no [Google Cloud Console](https://console.cloud.google.com)
2. Ative as APIs:
   - Cloud Billing API
   - Recommender API
   - Cloud Billing Budget API
3. Configure o OAuth2 Consent Screen
4. Crie credenciais OAuth2 → Web Application
5. Edite `config.js` e substitua `YOUR_GOOGLE_CLIENT_ID`
6. Sirva os arquivos via HTTPS (ex: `npx serve .`)

## Estrutura

```
├── index.html      # Estrutura HTML
├── styles.css      # Estilos (dark theme executivo)
├── config.js       # Configuração do Client ID
├── gcp-api.js      # Integração GCP + dados de demo
├── charts.js       # Todos os gráficos (Chart.js)
└── app.js          # Lógica principal da aplicação
```

## APIs utilizadas

| API | Uso |
|-----|-----|
| Cloud Billing API v1 | Contas, projetos, dados de custo |
| Recommender API v1 | Recomendações de otimização |
| Cloud Billing Budget API v1 | Orçamentos configurados |
| Google OAuth2 | Autenticação |
