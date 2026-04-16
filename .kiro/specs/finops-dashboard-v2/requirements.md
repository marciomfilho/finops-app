# Requirements Document

## Introduction

O FinOps Dashboard V2 evolui a plataforma de single-cloud (GCP) para uma solução multi-cloud com inteligência artificial integrada. A V2 adiciona quatro pilares principais: (1) Agente de IA via Gemini API para análises automáticas e chat interativo, (2) integração com Huawei Cloud via autenticação AK/SK, (3) painel de orçamento multi-provider com linha de orçamento configurável, e (4) importação de dados via CSV para todas as categorias. A aplicação mantém a arquitetura web pura (HTML/CSS/JS vanilla, sem backend), com todas as integrações feitas via chamadas diretas às APIs dos provedores.

---

## Glossary

- **DataBus**: Módulo central de agregação e normalização de dados de todos os providers (`data-bus.js`)
- **GCP_Adapter**: Módulo de integração com Google Cloud Platform via OAuth2 e Billing API (`gcp-api.js`)
- **Huawei_Adapter**: Módulo de integração com Huawei Cloud via autenticação AK/SK (`huawei-api.js`)
- **CSV_Importer**: Módulo de importação e parsing de arquivos CSV (`csv-importer.js`)
- **Gemini_Client**: Módulo cliente da Google Gemini API (`gemini-api.js`)
- **AI_Agent**: Módulo de lógica do agente FinOps com análise automática e chat (`ai-agent.js`)
- **Budget_Module**: Módulo de painel de orçamento multi-provider (`budget.js`)
- **AI_Chat**: Widget de chat interativo com o agente de IA (`ai-chat.js`)
- **Demo_Provider**: Gerador de dados de demonstração usado como fallback (`demo-data.js`)
- **AK/SK**: Access Key / Secret Key — credenciais de autenticação da Huawei Cloud
- **HMAC-SHA256**: Algoritmo de assinatura criptográfica usado pela Huawei Cloud SDK
- **NormalizedProject**: Estrutura de dados unificada representando um projeto/conta de qualquer provider
- **UnifiedData**: Estrutura de dados agregada contendo informações de todos os providers ativos
- **BudgetEntry**: Estrutura representando o estado de orçamento de um provider específico
- **ParseResult**: Resultado do parsing de um arquivo CSV, incluindo dados, erros e preview
- **ProviderData**: Dados brutos normalizados retornados por um provider específico
- **AIInsight**: Insight estruturado gerado pelo agente de IA (anomalia, tendência, economia, risco)
- **AIResponse**: Resposta completa do agente de IA contendo texto, insights e ações sugeridas
- **DOMPurify**: Biblioteca de sanitização de HTML usada para proteger contra XSS

---

## Requirements

### Requirement 1: Integração GCP

**User Story:** Como um usuário de FinOps, quero conectar minha conta GCP via OAuth2, para que eu possa visualizar e analisar os custos de billing do Google Cloud Platform no dashboard.

#### Acceptance Criteria

1. WHEN um usuário configura credenciais GCP, THE GCP_Adapter SHALL autenticar via fluxo OAuth2 e obter um token de acesso válido
2. WHEN o GCP_Adapter obtém um token válido, THE GCP_Adapter SHALL buscar dados de billing da Cloud Billing API e normalizá-los no formato NormalizedProject
3. WHEN o token GCP expira, THE GCP_Adapter SHALL iniciar re-autenticação via redirect OAuth2 sem perda de dados em memória
4. IF a Cloud Billing API retornar erro de autenticação, THEN THE GCP_Adapter SHALL exibir mensagem de erro específica e oferecer opção de reconfiguração

---

### Requirement 2: Integração Huawei Cloud

**User Story:** Como um usuário de FinOps, quero conectar minha conta Huawei Cloud via AK/SK, para que eu possa visualizar e analisar os custos da Huawei Cloud no mesmo dashboard.

#### Acceptance Criteria

1. WHEN um usuário fornece AK, SK, Project ID e Region, THE Huawei_Adapter SHALL armazenar as credenciais exclusivamente em memória, sem persistência em localStorage ou cookies
2. WHEN o Huawei_Adapter assina uma requisição, THE Huawei_Adapter SHALL produzir headers de autenticação válidos usando o algoritmo HMAC-SHA256 com as credenciais AK/SK fornecidas
3. WHEN a Huawei BSS API retorna dados de billing, THE Huawei_Adapter SHALL normalizar os dados no formato ProviderData compatível com o DataBus
4. IF o AK/SK fornecido for inválido, THEN THE Huawei_Adapter SHALL exibir um modal de reconfiguração com mensagem de erro específica e link para documentação
5. IF a Huawei API retornar status HTTP 429, THEN THE Huawei_Adapter SHALL realizar até 3 tentativas de retry com backoff exponencial antes de reportar falha
6. IF a Huawei BSS API estiver bloqueada por CORS, THEN THE Huawei_Adapter SHALL exibir aviso informativo e oferecer importação via CSV como alternativa

---

### Requirement 3: DataBus — Agregação Multi-Provider

**User Story:** Como um usuário de FinOps, quero visualizar dados de GCP e Huawei Cloud consolidados em uma única visão, para que eu possa analisar meus custos totais de cloud sem alternar entre plataformas.

#### Acceptance Criteria

1. WHEN o DataBus carrega dados de múltiplos providers, THE DataBus SHALL agregar o custo total como a soma exata dos custos individuais de cada provider ativo
2. WHEN o DataBus mescla timelines de múltiplos providers, THE DataBus SHALL somar os custos de todos os providers para cada data, produzindo uma série temporal unificada
3. WHEN os dados são carregados com sucesso, THE DataBus SHALL armazenar os dados em cache em memória por 5 minutos
4. WHILE os dados em cache têm menos de 5 minutos, THE DataBus SHALL retornar os dados em cache sem realizar novas chamadas às APIs
5. IF todos os providers configurados falharem ao carregar dados, THEN THE DataBus SHALL retornar dados do Demo_Provider como fallback, sem lançar exceção para a camada de UI
6. WHEN um novo provider é registrado, THE DataBus SHALL incluí-lo nas próximas chamadas de carregamento se estiver configurado

---

### Requirement 4: Importação de CSV

**User Story:** Como um usuário de FinOps, quero importar dados de custo via arquivo CSV, para que eu possa incluir fontes de dados que não possuem integração direta com o dashboard.

#### Acceptance Criteria

1. WHEN um usuário seleciona ou arrasta um arquivo CSV, THE CSV_Importer SHALL detectar automaticamente o delimitador do arquivo (vírgula, ponto-e-vírgula, tab)
2. WHEN o CSV_Importer processa um arquivo CSV válido, THE CSV_Importer SHALL retornar um ParseResult com rowCount igual ao número de linhas de dados, excluindo o cabeçalho
3. WHEN o CSV_Importer detecta o schema de colunas, THE CSV_Importer SHALL mapear os cabeçalhos do arquivo para os campos internos usando correspondência por aliases definidos por categoria
4. WHEN o mapeamento de colunas é concluído, THE CSV_Importer SHALL converter as linhas para o formato NormalizedData correspondente à categoria selecionada (projects, waste, recommendations, costs)
5. WHEN o parsing é concluído com sucesso, THE CSV_Importer SHALL exibir um preview com as primeiras 5 linhas antes de confirmar a importação
6. IF uma coluna obrigatória estiver ausente no CSV, THEN THE CSV_Importer SHALL exibir uma interface de mapeamento manual de colunas com os campos obrigatórios da categoria
7. IF o arquivo CSV estiver vazio, THEN THE CSV_Importer SHALL retornar um erro imediato sem tentar processar o arquivo
8. IF o arquivo CSV não estiver em UTF-8, THEN THE CSV_Importer SHALL tentar reprocessar automaticamente com encoding latin-1 antes de reportar erro de encoding
9. WHEN dados CSV são importados, THE DataBus SHALL injetar os dados normalizados e atualizar todas as visualizações do dashboard imediatamente

---

### Requirement 5: Agente de IA — Análise Automática

**User Story:** Como um usuário de FinOps, quero que o sistema analise automaticamente meus dados de custo ao carregar o dashboard, para que eu receba insights e recomendações de otimização sem precisar solicitar manualmente.

#### Acceptance Criteria

1. WHEN o DataBus conclui o carregamento de dados, THE AI_Agent SHALL executar análise automática e gerar uma lista de AIInsights classificados por severidade (low, medium, high, critical)
2. WHEN o AI_Agent constrói o prompt contextual, THE AI_Agent SHALL incluir no payload ao Gemini_Client: gasto total, percentual de desperdício, economia potencial, providers ativos e top 3 projetos por custo
3. WHEN o AI_Agent constrói o prompt contextual, THE AI_Agent SHALL excluir do payload enviado ao Gemini_Client quaisquer credenciais de autenticação (AK/SK, tokens OAuth2)
4. WHEN o Gemini_Client recebe uma resposta da Gemini API, THE Gemini_Client SHALL parsear a resposta em um AIResponse contendo texto em markdown, lista de AIInsights e ações sugeridas
5. IF a chave da Gemini API não estiver configurada, THEN THE AI_Agent SHALL desabilitar o módulo de IA e exibir um call-to-action de configuração
6. IF a Gemini API retornar status HTTP 429, THEN THE AI_Agent SHALL desabilitar o chat por 60 segundos e exibir mensagem informativa ao usuário
7. IF a Gemini API bloquear a resposta por safety filters, THEN THE AI_Agent SHALL exibir uma mensagem genérica sem expor detalhes do bloqueio

---

### Requirement 6: Agente de IA — Chat Interativo

**User Story:** Como um usuário de FinOps, quero interagir com um chat de IA contextualizado com os dados do dashboard, para que eu possa fazer perguntas específicas sobre meus custos e receber respostas em linguagem natural.

#### Acceptance Criteria

1. WHEN um usuário envia uma mensagem no AI_Chat, THE AI_Agent SHALL incluir as últimas 6 mensagens do histórico de conversa no contexto enviado ao Gemini_Client
2. WHEN o Gemini_Client retorna uma resposta, THE AI_Chat SHALL renderizar o texto em markdown usando a biblioteca marked
3. WHEN o AI_Chat renderiza uma resposta, THE AI_Chat SHALL sanitizar o HTML gerado via DOMPurify antes de inserir no DOM
4. WHEN o Gemini_Client suporta streaming, THE Gemini_Client SHALL usar generateStream para exibir a resposta progressivamente ao usuário
5. WHEN o AI_Agent gera recomendações via chat, THE AI_Agent SHALL quantificar o impacto financeiro estimado em BRL para cada recomendação

---

### Requirement 7: Painel de Orçamento Multi-Provider

**User Story:** Como um gestor de FinOps, quero visualizar os gastos de GCP e Huawei Cloud lado a lado com uma linha de orçamento configurável, para que eu possa monitorar a utilização do orçamento por provider e receber alertas de consumo.

#### Acceptance Criteria

1. WHEN o Budget_Module renderiza, THE Budget_Module SHALL exibir os gastos de cada provider ativo lado a lado com a linha de orçamento mensal configurada
2. FOR ANY BudgetEntry onde budgetLimit é maior que zero, THE Budget_Module SHALL calcular utilizationPct como (currentSpend / budgetLimit) * 100
3. WHEN um usuário atualiza o valor de orçamento de um provider, THE Budget_Module SHALL recalcular e exibir o utilizationPct atualizado imediatamente
4. WHEN a utilização de orçamento de um provider atinge 75%, THE Budget_Module SHALL exibir alerta visual de aviso se o alerta de 75% estiver habilitado na configuração
5. WHEN a utilização de orçamento de um provider atinge 90%, THE Budget_Module SHALL exibir alerta visual de atenção se o alerta de 90% estiver habilitado na configuração
6. WHEN a utilização de orçamento de um provider atinge 100%, THE Budget_Module SHALL exibir alerta visual crítico se o alerta de 100% estiver habilitado na configuração
7. WHEN o Budget_Module exibe dados, THE Budget_Module SHALL incluir o gasto projetado para o mês corrente com base na tendência atual, se showProjected estiver habilitado
8. WHEN um usuário solicita exportação, THE Budget_Module SHALL gerar e disponibilizar para download um relatório com os dados de orçamento de todos os providers

---

### Requirement 8: Segurança e Isolamento de Credenciais

**User Story:** Como um administrador de segurança, quero garantir que as credenciais de acesso às APIs de cloud sejam tratadas com segurança, para que dados sensíveis não sejam expostos ou vazados.

#### Acceptance Criteria

1. THE Huawei_Adapter SHALL armazenar credenciais AK/SK exclusivamente em memória durante a sessão, sem persistência em localStorage, sessionStorage ou cookies
2. WHEN o usuário encerra a sessão ou fecha o browser, THE Huawei_Adapter SHALL descartar as credenciais AK/SK da memória
3. THE AI_Agent SHALL nunca incluir credenciais de autenticação (AK/SK, tokens OAuth2, API keys) no payload enviado à Gemini API
4. WHEN o AI_Chat renderiza conteúdo gerado pela IA, THE AI_Chat SHALL sanitizar todo HTML via DOMPurify antes da inserção no DOM para prevenir XSS
5. WHERE conteúdo dinâmico de APIs externas é exibido, THE Dashboard SHALL usar textContent em vez de innerHTML para prevenir execução de scripts arbitrários

---

### Requirement 9: Performance e Experiência do Usuário

**User Story:** Como um usuário do dashboard, quero que a aplicação carregue e responda rapidamente, para que eu possa analisar dados de custo sem esperas excessivas.

#### Acceptance Criteria

1. WHEN um usuário navega para uma página pela primeira vez, THE Dashboard SHALL carregar o módulo JavaScript correspondente de forma lazy, sem pré-carregar todos os módulos
2. WHEN o CSV_Importer processa arquivos grandes, THE CSV_Importer SHALL processar os dados em chunks de até 1000 linhas para não bloquear a thread principal do browser
3. WHEN o Gemini_Client suporta streaming, THE Gemini_Client SHALL iniciar a exibição da resposta ao usuário antes de receber o payload completo
4. WHEN instâncias de Chart.js são recriadas, THE Dashboard SHALL destruir a instância anterior antes de criar uma nova para evitar vazamento de memória
5. WHEN o DataBus possui dados em cache válidos, THE DataBus SHALL retornar os dados em cache sem realizar chamadas às APIs externas

---

### Requirement 10: Modo Demo e Fallback

**User Story:** Como um novo usuário, quero explorar o dashboard sem precisar configurar credenciais de cloud, para que eu possa avaliar as funcionalidades antes de conectar minhas contas reais.

#### Acceptance Criteria

1. WHEN nenhum provider real está configurado, THE Demo_Provider SHALL gerar dados de demonstração realistas para GCP e Huawei Cloud automaticamente
2. IF todos os providers configurados falharem ao carregar dados, THEN THE DataBus SHALL ativar o Demo_Provider como fallback e notificar o usuário sobre o uso de dados de demonstração
3. WHEN o Demo_Provider está ativo, THE Dashboard SHALL exibir um indicador visual claro informando que os dados exibidos são de demonstração
4. WHEN um provider real é configurado com sucesso, THE DataBus SHALL substituir os dados demo pelos dados reais sem necessidade de recarregar a página
