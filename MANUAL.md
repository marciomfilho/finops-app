# FinOps Dashboard — Manual de Uso

## O que é

O FinOps Dashboard é uma ferramenta de gestão de custos cloud multi-provider. Ele consolida dados de GCP e Huawei Cloud em um único painel, com análise de desperdícios, recomendações de economia, controle de orçamento e um assistente de IA para perguntas sobre seus custos.

---

## Modos de operação

O dashboard funciona em três modos, detectados automaticamente:

| Modo | Quando ativa | O que mostra |
|---|---|---|
| **Demo** | Nenhuma credencial configurada | Dados simulados com banner "🎭 Modo Demo" |
| **Direto** | Credenciais no `config.js` | Dados reais via API GCP/Huawei direto do browser |
| **Backend** | `BACKEND_URL` + JWT configurados | Dados via backend proxy com Supabase |

---

## Navegação

O dashboard tem 7 seções acessíveis pelo menu lateral:

### Visão Geral
Painel principal com os KPIs do período:
- **Gasto no Período** — custo total realizado com variação vs período anterior
- **Desperdício Identificado** — valor e percentual de recursos ociosos
- **Economia Potencial** — quanto pode ser economizado aplicando as recomendações
- **Orçamento Total** — utilização do orçamento configurado
- **Projetos Ativos** — quantidade de projetos monitorados
- **Providers Ativos** — breakdown de custo por provider (GCP, Huawei)

Abaixo dos KPIs há quatro gráficos: evolução de custos no tempo, distribuição por serviço, top projetos e distribuição por região.

### Projetos
Lista todos os projetos de todos os providers com custo atual, variação e serviços associados. Projetos importados via Cloud8 mostram tags de reconciliação.

### Tendências
Gráficos de evolução histórica de custos por provider e por serviço.

### Desperdícios
Recursos identificados como ociosos ou superdimensionados, agrupados por categoria. Cada item mostra o custo mensal desperdiçado e a ação recomendada. Exibe também a projeção de economia anual.

### Recomendações
Lista de ações para redução de custos vindas dos providers e do agente de IA. Filtros disponíveis por prioridade (Crítico, Alto, Médio, Baixo) e por categoria (Compute, Storage, Network, Database, IA).

### Orçamento
Controle de orçamento por provider. Para cada provider (GCP, Huawei, Total):
- Defina o limite mensal no campo de input
- Acompanhe a barra de utilização com alertas coloridos:
  - 🟢 Verde — abaixo de 75%
  - 🟡 Amarelo — entre 75% e 90%
  - 🟠 Laranja — entre 90% e 100%
  - 🔴 Vermelho — acima de 100%
- Exporte o relatório de orçamento em CSV pelo botão "Exportar CSV"

Os limites de orçamento são salvos automaticamente no navegador (localStorage).

### Assistente IA
Chat com o agente FinOps alimentado pelo Gemini. Faça perguntas em linguagem natural sobre seus custos:

- "Quais são os maiores desperdícios?"
- "Como reduzir custos em 20%?"
- "Compare GCP vs Huawei"
- "Previsão para o próximo mês"

Use os botões de sugestão rápida ou digite sua própria pergunta. O histórico da conversa é mantido durante a sessão. Use "Limpar" para reiniciar.

Requer a `GEMINI_API_KEY` configurada em `config.js`.

---

## Importação de CSV

O dashboard aceita importação de dados via CSV em quatro categorias: Projetos, Custos, Desperdícios e Recomendações.

### CSV do Cloud8 (formato especial)

O Cloud8 exporta um relatório de custos GCP com colunas `Custo:` e `Estimativa:`. O dashboard detecta esse formato automaticamente.

**Como importar:**
1. Exporte o relatório do Cloud8 normalmente (arquivo `.csv`)
2. No dashboard, clique no botão de importação CSV (disponível nas páginas de Projetos ou Visão Geral)
3. Arraste o arquivo ou clique para selecionar
4. O sistema exibe o badge **"✓ Formato Cloud8 detectado"** e mostra quantos projetos foram encontrados
5. Clique em **Confirmar Importação**

**O que acontece após a importação:**

O Cloud8 tem 100% de cobertura de tags dos projetos GCP. Ao importar, o sistema faz uma reconciliação automática cruzando os projetos do Cloud8 com os dados recebidos da API GCP/Huawei:

| Status | Significado |
|---|---|
| `matched` | Projeto encontrado nos dois lados — tags aplicadas, custos comparados |
| `provider_only` | Projeto existe na API mas não no Cloud8 |
| `cloud8_only` | Projeto existe no Cloud8 mas não veio no report da API |

Cada projeto com match recebe as seguintes tags:
- `organization` — organização GCP
- `environment` — ambiente detectado pelo nome (`prod`, `homol`, `dev`, `sandbox`)
- `source` — sempre `cloud8`
- `estimated_cost` — estimativa do mês atual
- `cloud8_cost` — custo registrado no Cloud8
- `cost_delta` — diferença entre o custo da API e o do Cloud8
- `cost_delta_pct` — variação percentual entre os dois

O resumo da reconciliação aparece no console do browser e pode ser consultado via `DataBus.getReconciliation()`.

### CSV genérico

Para outros formatos, o sistema detecta automaticamente os delimitadores (`,`, `;`, tab) e tenta mapear as colunas pelos nomes. Se algum campo obrigatório não for detectado, aparece um seletor manual para mapear a coluna correta.

---

## Seleção de período

Use o seletor de período no topo do dashboard (7, 30, 90 dias) para ajustar o intervalo de análise. Todos os gráficos e KPIs atualizam automaticamente.

---

## Atualização de dados

Os dados são cacheados por 5 minutos. Para forçar uma atualização, recarregue a página ou aguarde o TTL expirar.

No modo backend, os dados são sincronizados automaticamente pelo Sync Job (ver seção de configuração).
