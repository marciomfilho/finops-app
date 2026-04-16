# Implementation Plan: FinOps Dashboard V2

## Overview

Evolução do dashboard de single-cloud (GCP) para plataforma multi-cloud com IA integrada. A implementação segue uma ordem de dependências: primeiro a infraestrutura de dados (DataBus + adapters), depois a camada de IA, depois os módulos de UI novos, e por fim a integração e atualização do app shell.

Linguagem: JavaScript Vanilla (ES2020+, sem bundler, sem npm)

---

## Tasks

- [x] 1. Extrair demo-data.js e criar config.js atualizado
  - Mover o objeto `DEMO_DATA` de `gcp-api.js` para o novo arquivo `demo-data.js`
  - Adicionar dados demo para Huawei Cloud (projetos, billing, métricas) ao `DEMO_DATA.generate()`
  - Atualizar `config.js` com as novas chaves: `HUAWEI_ACCESS_KEY`, `HUAWEI_SECRET_KEY`, `HUAWEI_PROJECT_ID`, `HUAWEI_REGION`, `GEMINI_API_KEY`
  - Remover o bloco `DEMO_DATA` de `gcp-api.js` e adicionar `<script src="demo-data.js">` ao `index.html`
  - _Requirements: 10.1, 10.3_

- [x] 2. Implementar data-bus.js — Agregador Multi-Provider
  - [x] 2.1 Criar `data-bus.js` com a interface `DataBus` (load, getData, registerProvider, onUpdate)
    - Implementar `registerProvider(provider)` que adiciona ao array interno de providers
    - Implementar `getData()` que retorna o cache em memória ou null
    - Implementar cache em memória com TTL de 5 minutos (comparar `Date.now()` com `lastFetch + 300000`)
    - _Requirements: 3.3, 3.4, 3.6_

  - [x] 2.2 Implementar `load(period)` com agregação multi-provider
    - Usar `Promise.allSettled()` para chamar `fetchData(period)` em todos os providers configurados
    - Filtrar apenas os resultados `fulfilled` para `successfulData`
    - Se `successfulData.length === 0`, retornar `demoProvider.fetchData(period)` como fallback
    - Chamar `aggregate(successfulData)` e disparar callbacks `onUpdate`
    - _Requirements: 3.1, 3.5, 10.2_

  - [x] 2.3 Implementar `aggregate(providerDataList)` e `mergeTimelines(timelines)`
    - `aggregate`: concatenar `projects`, mesclar `waste` e `recommendations`, construir `UnifiedSummary` com `totalCurrentCost = Σ pd.summary.currentCost`
    - `mergeTimelines`: usar `Map<date, cost>` para somar custos por data de todos os providers, retornar array ordenado por data
    - _Requirements: 3.1, 3.2_

  - [x] 2.4 Escrever property test para agregação de custos (Property 1)
    - **Property 1: Agregação consistente de custos**
    - Gerar N arrays de ProviderData com custos aleatórios via fast-check
    - Verificar que `aggregate(list).summary.totalCurrentCost === list.reduce((s,p) => s + p.summary.currentCost, 0)`
    - **Validates: Requirements 3.1**

  - [x] 2.5 Escrever property test para merge de timelines (Property 2)
    - **Property 2: Merge de timelines por data**
    - Gerar timelines de múltiplos providers com datas sobrepostas via fast-check
    - Verificar que para cada data na timeline unificada, `cost === Σ provider.timeline[date].cost`
    - **Validates: Requirements 3.2**

  - [x] 2.6 Escrever property test para fallback do DataBus (Property 4)
    - **Property 4: Fallback garantido do DataBus**
    - Simular cenário onde todos os providers lançam exceção
    - Verificar que `load()` retorna dados válidos (não null, não lança exceção)
    - **Validates: Requirements 3.5, 10.2**

- [x] 3. Checkpoint — DataBus funcional
  - Garantir que `DataBus.load()` retorna `UnifiedData` válido com dados demo quando nenhum provider real está configurado. Pergunte ao usuário se tiver dúvidas.

- [x] 4. Implementar huawei-api.js — Integração Huawei Cloud
  - [x] 4.1 Criar `huawei-api.js` com `configure(config)` e armazenamento em memória
    - Armazenar `{ accessKey, secretKey, projectId, region }` em variável local do módulo (closure)
    - Nunca escrever em `localStorage`, `sessionStorage` ou cookies
    - Implementar `isConfigured()` verificando se `accessKey` e `secretKey` estão preenchidos
    - _Requirements: 2.1, 8.1, 8.2_

  - [x] 4.2 Implementar `signRequest(method, url, body)` via Web Crypto API (HMAC-SHA256)
    - Calcular `sha256Hex(payload)` usando `crypto.subtle.digest('SHA-256', ...)`
    - Construir `canonicalRequest` com method, uri, query, headers canonicais e payload hash
    - Derivar `signingKey` via HMAC encadeado: `HMAC(HMAC(HMAC(SK, date), region), 'bss')`
    - Retornar headers `{ 'X-Sdk-Date', 'Authorization', 'Content-Type' }`
    - _Requirements: 2.2_

  - [x] 4.3 Escrever property test para assinatura HMAC-SHA256 determinística (Property 3)
    - **Property 3: Assinatura HMAC-SHA256 determinística**
    - Gerar inputs fixos (method, url, body, credenciais, timestamp) via fast-check
    - Verificar que duas chamadas com os mesmos inputs produzem exatamente a mesma assinatura
    - **Validates: Requirements 2.2**

  - [x] 4.4 Implementar `fetchBills(startDate, endDate)` e `fetchMetrics(projectId)`
    - Chamar `https://bss.{region}.myhuaweicloud.com/v2/bills/monthly-bills` com headers assinados
    - Tratar HTTP 429 com retry exponencial (3 tentativas: 1s, 2s, 4s)
    - Tratar erros CORS exibindo aviso e sugerindo importação CSV
    - _Requirements: 2.3, 2.5, 2.6_

  - [x] 4.5 Implementar `fetchData(period)` que normaliza para `ProviderData`
    - Mapear `bill_sums` da BSS API para `NormalizedProject[]`
    - Construir `summary` com `currentCost`, `previousCost`, `provider: 'huawei'`
    - Em caso de erro de autenticação (401/403), exibir modal de reconfiguração com mensagem específica
    - _Requirements: 2.3, 2.4_

- [x] 5. Atualizar gcp-api.js para interface DataProvider
  - Adicionar método `fetchData(period)` que encapsula o fluxo OAuth2 + Billing API existente
  - Implementar `isConfigured()` verificando `CLIENT_ID` e token válido
  - Normalizar resposta da Cloud Billing API para `ProviderData` com `provider: 'gcp'`
  - Registrar o adapter no DataBus: `DataBus.registerProvider(GCP_API)`
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 6. Implementar csv-importer.js — Importação de CSV
  - [x] 6.1 Criar `csv-importer.js` com `detectDelimiter(rawText)` e `parseRows(rawText, delimiter)`
    - `detectDelimiter`: contar ocorrências de `,`, `;` e `\t` na primeira linha; retornar o mais frequente
    - `parseRows`: dividir por linhas, aplicar delimiter, retornar `{ headers, rows }`
    - Tratar encoding: tentar UTF-8 via `FileReader.readAsText(file, 'UTF-8')`, fallback para `latin-1`
    - _Requirements: 4.1, 4.8_

  - [x] 6.2 Implementar `detectSchema(headers, category)` com mapeamento por aliases
    - Normalizar headers para lowercase e trim antes de comparar
    - Usar o `schemaMap` do design para cada categoria (`costs`, `projects`, `waste`, `recommendations`)
    - Retornar `ColumnMapping` com os campos detectados; campos obrigatórios ausentes ficam `undefined`
    - _Requirements: 4.3_

  - [x] 6.3 Escrever property test para detecção de schema por aliases (Property 9)
    - **Property 9: Detecção de schema por aliases**
    - Gerar headers com variações de capitalização e espaços dos aliases conhecidos via fast-check
    - Verificar que `detectSchema` mapeia corretamente para o campo interno correspondente
    - **Validates: Requirements 4.3**

  - [x] 6.4 Implementar `mapToNormalizedFormat(rows, mapping, category)` e `parse(file, category)`
    - `mapToNormalizedFormat`: converter cada row usando o `mapping` para o formato `NormalizedData` da categoria
    - `parse`: orquestrar detectDelimiter → parseRows → detectSchema → mapToNormalizedFormat
    - Retornar `ParseResult { data, errors, preview: rows.slice(0,5), rowCount, detectedEncoding }`
    - Lançar erro imediato se arquivo vazio (0 linhas após header)
    - _Requirements: 4.2, 4.4, 4.5, 4.7_

  - [x] 6.5 Escrever property test para rowCount do CSV (Property 8)
    - **Property 8: rowCount igual ao número de linhas de dados**
    - Gerar CSVs com N linhas de dados (N entre 0 e 1000) via fast-check
    - Verificar que `parse(csv).rowCount === N`
    - **Validates: Requirements 4.2**

  - [x] 6.6 Implementar UI de importação CSV (modal com drag-and-drop, preview e mapeamento manual)
    - Criar modal com zona de drag-and-drop e input `<input type="file" accept=".csv">`
    - Exibir preview das primeiras 5 linhas em tabela após parse bem-sucedido
    - Se coluna obrigatória ausente, exibir interface de mapeamento manual com `<select>` para cada campo
    - Ao confirmar, chamar `DataBus.injectCSVData(category, data)` e fechar modal
    - _Requirements: 4.5, 4.6, 4.9_

- [x] 7. Checkpoint — Adapters e CSV funcionais
  - Verificar que GCP, Huawei e CSV conseguem fornecer dados ao DataBus. Pergunte ao usuário se tiver dúvidas.

- [x] 8. Implementar gemini-api.js — Cliente Gemini API
  - [x] 8.1 Criar `gemini-api.js` com `generate(prompt, options)` usando `fetch` para a REST API
    - Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent`
    - Incluir `x-goog-api-key` header com a chave de `config.js`
    - Parsear `candidates[0].content.parts[0].text` da resposta
    - Tratar HTTP 429 desabilitando o chat por 60s e exibindo mensagem ao usuário
    - Tratar respostas bloqueadas por safety filters exibindo mensagem genérica
    - _Requirements: 5.4, 5.6, 5.7_

  - [x] 8.2 Implementar `generateStream(prompt, onChunk)` para streaming progressivo
    - Usar endpoint `streamGenerateContent` com `alt=sse`
    - Processar chunks via `ReadableStream` e chamar `onChunk(text)` a cada fragmento recebido
    - _Requirements: 6.4, 9.3_

- [x] 9. Implementar ai-agent.js — Lógica do Agente FinOps
  - [x] 9.1 Criar `ai-agent.js` com `buildSystemPrompt(data)` e `buildContextualPrompt(message, data, history)`
    - `buildSystemPrompt`: incluir gasto total, % desperdício, economia potencial, providers ativos, top 3 projetos
    - `buildContextualPrompt`: incluir `history.slice(-6)` no array `contents` do payload Gemini
    - Nunca incluir `accessKey`, `secretKey`, tokens OAuth2 ou API keys no payload
    - _Requirements: 5.2, 5.3, 6.1, 8.3_

  - [x] 9.2 Escrever property test para isolamento de credenciais no prompt (Property 7)
    - **Property 7: Isolamento de credenciais no prompt AI**
    - Gerar `UnifiedData` com credenciais injetadas em campos arbitrários via fast-check
    - Verificar que o payload retornado por `buildContextualPrompt` não contém strings de credenciais
    - **Validates: Requirements 5.3, 8.3**

  - [x] 9.3 Escrever property test para métricas financeiras no prompt (Property 11)
    - **Property 11: Prompt contextual inclui métricas financeiras**
    - Gerar `UnifiedData` com valores aleatórios via fast-check
    - Verificar que o prompt contém gasto total, % desperdício, economia potencial, providers e top 3 projetos
    - **Validates: Requirements 5.2**

  - [x] 9.4 Implementar `autoAnalyze(data)` e `chat(message, history)`
    - `autoAnalyze`: chamar `GeminiClient.generate(buildSystemPrompt(data))`, parsear resposta em `AIInsight[]` classificados por severidade
    - `chat`: chamar `GeminiClient.generateStream(buildContextualPrompt(...), onChunk)` com histórico das últimas 6 mensagens
    - Se `GEMINI_API_KEY` não configurada, retornar array vazio e setar flag `aiDisabled = true`
    - _Requirements: 5.1, 5.5, 6.1_

- [x] 10. Implementar pages/ai-chat.js — Widget de Chat Interativo
  - [x] 10.1 Criar `pages/ai-chat.js` com renderização do widget de chat no HTML
    - Criar container de mensagens, input de texto e botão de envio
    - Manter array `chatHistory: ChatMessage[]` em memória
    - Exibir call-to-action de configuração se `aiDisabled === true`
    - _Requirements: 6.1, 5.5_

  - [x] 10.2 Implementar renderização de mensagens com marked + DOMPurify
    - Renderizar resposta do AI com `marked.parse(text)` para converter markdown em HTML
    - Sanitizar o HTML resultante com `DOMPurify.sanitize(html)` antes de inserir no DOM
    - Usar `textContent` (não `innerHTML`) para mensagens do usuário
    - _Requirements: 6.2, 6.3, 8.4, 8.5_

  - [x] 10.3 Escrever property test para sanitização de conteúdo AI (Property 6)
    - **Property 6: Sanitização de conteúdo AI**
    - Gerar strings com tags `<script>`, `onerror`, `javascript:` via fast-check
    - Verificar que após `DOMPurify.sanitize(marked.parse(input))` nenhum script executável permanece
    - **Validates: Requirements 6.3, 8.4**

  - [x] 10.4 Implementar streaming visual da resposta
    - Criar elemento de mensagem vazio antes do stream iniciar
    - Acumular chunks em `buffer` e atualizar o elemento a cada `onChunk` chamado
    - Sanitizar e renderizar markdown apenas ao final do stream completo
    - _Requirements: 6.4, 9.3_

- [x] 11. Implementar pages/budget.js — Painel de Orçamento Multi-Provider
  - [x] 11.1 Criar `pages/budget.js` com `render(data, config)` e cards por provider
    - Renderizar um card por provider ativo com: gasto atual, limite de orçamento, `utilizationPct`, barra de progresso
    - Calcular `utilizationPct = (currentSpend / budgetLimit) * 100` para cada `BudgetEntry`
    - Incluir gasto projetado se `config.showProjected === true`
    - _Requirements: 7.1, 7.2, 7.7_

  - [x] 11.2 Escrever property test para budget utilization invariant (Property 5)
    - **Property 5: Budget utilization invariant**
    - Gerar `BudgetEntry` com `currentSpend` e `budgetLimit` aleatórios (budgetLimit > 0) via fast-check
    - Verificar que `utilizationPct === (currentSpend / budgetLimit) * 100` e `utilizationPct >= 0`
    - **Validates: Requirements 7.2**

  - [x] 11.3 Implementar alertas visuais de orçamento e input de configuração
    - Exibir badge de aviso (amarelo) quando `utilizationPct >= 75` e `config.alert75 === true`
    - Exibir badge de atenção (laranja) quando `utilizationPct >= 90` e `config.alert90 === true`
    - Exibir badge crítico (vermelho) quando `utilizationPct >= 100` e `config.alert100 === true`
    - Adicionar inputs numéricos para editar o limite de orçamento por provider; ao alterar, recalcular e re-renderizar imediatamente
    - _Requirements: 7.3, 7.4, 7.5, 7.6_

  - [x] 11.4 Implementar `exportReport()` — download de relatório CSV de orçamento
    - Gerar string CSV com colunas: provider, currentSpend, budgetLimit, utilizationPct, projectedSpend
    - Criar `Blob` com `type: 'text/csv'` e disparar download via `URL.createObjectURL`
    - _Requirements: 7.8_

- [x] 12. Checkpoint — Módulos de IA e Budget funcionais
  - Verificar que o chat responde, os insights aparecem e o painel de budget exibe dados corretos. Pergunte ao usuário se tiver dúvidas.

- [x] 13. Atualizar páginas existentes para dados multi-provider
  - [x] 13.1 Atualizar `pages/overview.js` para consumir `UnifiedData` do DataBus
    - Substituir referências diretas a `data.summary` por `DataBus.getData().summary`
    - Adicionar KPI de "Providers Ativos" com breakdown por provider (`summary.byProvider`)
    - Exibir indicador visual de "Modo Demo" quando `Demo_Provider` estiver ativo
    - _Requirements: 3.1, 10.3_

  - [x] 13.2 Atualizar `pages/projects.js` para exibir projetos de todos os providers
    - Adicionar coluna/badge de `provider` (GCP / Huawei / CSV) em cada project card
    - Manter filtro e ordenação existentes funcionando com `NormalizedProject[]` multi-provider
    - _Requirements: 3.1_

  - [x] 13.3 Atualizar `pages/waste.js` e `pages/recommendations.js`
    - `waste.js`: exibir dados de waste agregados de todos os providers
    - `recommendations.js`: integrar `AIInsight[]` do `AI_Agent.autoAnalyze()` como recomendações adicionais com badge "IA"
    - _Requirements: 3.1, 5.1_

  - [x] 13.4 Atualizar `pages/trends.js` para timeline unificada multi-provider
    - Usar `DataBus.getData().timeline` (já mesclada pelo DataBus) para os gráficos de tendência
    - Adicionar gráfico de breakdown de custo por provider ao longo do tempo
    - _Requirements: 3.2_

- [x] 14. Atualizar charts.js com novos gráficos multi-provider
  - Adicionar `renderProviderBreakdown(canvasId, byProvider)` — gráfico de barras empilhadas por provider
  - Adicionar `renderBudgetGauge(canvasId, utilizationPct)` — gráfico de gauge para o painel de budget
  - Garantir que todas as funções chamam `destroyChart(canvasId)` antes de criar nova instância
  - _Requirements: 9.4_

- [x] 15. Atualizar index.html e app.js — App Shell V2
  - [x] 15.1 Atualizar `index.html` com novos scripts, páginas e widget de chat
    - Adicionar `<script>` tags para: `demo-data.js`, `data-bus.js`, `huawei-api.js`, `gemini-api.js`, `ai-agent.js`, `csv-importer.js`
    - Adicionar `<script>` tags CDN para DOMPurify e marked
    - Adicionar itens de navegação na sidebar: "Orçamento" (`budget`) e "Chat IA" (`ai-chat`)
    - Adicionar `<div class="page" id="page-budget">` e `<div class="page" id="page-ai-chat">` no container de páginas
    - Adicionar botão de importação CSV na topbar
    - _Requirements: 9.1_

  - [x] 15.2 Atualizar `app.js` para orquestrar DataBus e lazy loading de módulos
    - Substituir `loadDemoData()` e `loadRealData()` por `DataBus.load(currentPeriod)`
    - Registrar todos os providers no DataBus durante `init()`
    - Implementar lazy loading: carregar `pages/{page}.js` via `<script>` dinâmico apenas na primeira navegação para aquela página
    - Adicionar rotas para `budget` e `ai-chat` no `navigateTo()`
    - Adicionar modal de configuração de credenciais Huawei (AK/SK) acessível via botão na sidebar
    - Disparar `AI_Agent.autoAnalyze(data)` após `DataBus.load()` concluir com sucesso
    - _Requirements: 9.1, 5.1_

  - [x] 15.3 Atualizar `styles.css` com estilos para os novos componentes
    - Estilos para: chat widget, budget cards, alertas de orçamento, badge de provider, indicador de modo demo, modal de importação CSV, modal de configuração Huawei
    - _Requirements: 10.3_

- [x] 16. Checkpoint final — Integração completa
  - Verificar que o fluxo completo funciona: login → DataBus.load() → render de todas as páginas → chat IA → importação CSV → painel de budget. Pergunte ao usuário se tiver dúvidas.

---

## Notes

- Tarefas marcadas com `*` são opcionais (testes de propriedade e unitários) e podem ser puladas para MVP mais rápido
- A ordem das tarefas respeita dependências: DataBus antes dos adapters, adapters antes da IA, IA antes do chat
- Cada tarefa referencia os requisitos específicos para rastreabilidade
- Os property tests usam a biblioteca **fast-check** via CDN ou como devDependency
- O `demo-data.js` deve ser carregado antes de `data-bus.js` no HTML (dependência de ordem de script)
- Credenciais Huawei (AK/SK) nunca devem ser persistidas — apenas em memória durante a sessão
