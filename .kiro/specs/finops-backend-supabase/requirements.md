# Documento de Requisitos

## Introdução

O **finops-backend-supabase** é uma camada de backend Node.js com integração ao Supabase para o FinOps Dashboard V2 da EXA. O dashboard atual é uma SPA puramente client-side que chama as APIs do GCP Billing e da Huawei BSS diretamente do browser, o que causa problemas de CORS, riscos de segurança (credenciais visíveis no DevTools), ausência de persistência de dados e limitações de context window para o chat com IA Gemini.

Esta feature introduz quatro componentes principais: (1) um **Backend Proxy** Node.js hospedado no Cloud Run que intermedia todas as chamadas às APIs de cloud, com autenticação via Google SSO restrita ao domínio corporativo da EXA; (2) um **Sync Job** agendado que busca dados das APIs de cloud, normaliza, persiste no Supabase e gera embeddings vetoriais para o pipeline de RAG; (3) um **Schema Supabase** com tabelas de billing, resumos, recomendações, embeddings e auditoria, com Row Level Security habilitado; e (4) um **Pipeline RAG** para o chat com Gemini, que usa busca vetorial para construir contexto compacto em vez de enviar todos os dados brutos.

O frontend permanece em JS vanilla sem bundler. O DataBus e o AIAgent são atualizados para consumir o backend proxy em vez de chamar as APIs de cloud diretamente.

---

## Glossário

- **Backend_Proxy**: Serviço Node.js hospedado no Cloud Run que intermedia chamadas às APIs de cloud e expõe endpoints REST para o frontend
- **Sync_Job**: Job Node.js agendado que busca dados das APIs de cloud, normaliza e persiste no Supabase
- **Supabase**: Plataforma de banco de dados PostgreSQL gerenciado com autenticação, RLS e extensão pgvector
- **Google_SSO**: Autenticação via Google OAuth2 com validação de ID token e restrição de domínio corporativo
- **Secret_Manager**: Google Cloud Secret Manager — armazena credenciais sensíveis (AK/SK Huawei, service account GCP) fora do código
- **RLS**: Row Level Security — política de segurança do PostgreSQL que restringe acesso a linhas por usuário autenticado
- **pgvector**: Extensão PostgreSQL para armazenamento e busca de vetores de embeddings
- **RAG**: Retrieval-Augmented Generation — técnica que recupera chunks relevantes via busca vetorial antes de enviar contexto ao modelo de IA
- **Embedding**: Representação vetorial de texto gerada pela Gemini Embedding API (dimensão 768) usada para busca semântica
- **ProviderData**: Formato normalizado de dados de billing compatível com a interface DataBus existente do frontend
- **DataBus**: Módulo central de agregação de dados do frontend (`data-bus.js`) — será atualizado para consumir o Backend_Proxy
- **AI_Agent**: Módulo de lógica do agente FinOps do frontend (`ai-agent.js`) — será atualizado para usar o endpoint RAG do backend
- **GCP_Billing_API**: API do Google Cloud Billing para consulta de custos e projetos GCP
- **Huawei_BSS_API**: API de billing da Huawei Cloud (Business Support System) para consulta de custos
- **AK/SK**: Access Key / Secret Key — credenciais de autenticação da Huawei Cloud, armazenadas exclusivamente no Secret Manager
- **JWT**: JSON Web Token — token de sessão emitido pelo Supabase após autenticação bem-sucedida
- **Audit_Log**: Registro imutável de todos os eventos de acesso a dados financeiros (quem acessou o quê e quando)
- **financial_embeddings**: Tabela Supabase com vetores de embeddings de registros financeiros para busca semântica
- **billing_records**: Tabela Supabase com registros individuais de billing normalizados por provider
- **cost_summaries**: Tabela Supabase com resumos agregados de custo por provider e período
- **recommendations**: Tabela Supabase com recomendações de otimização de custo de múltiplas fontes
- **audit_log**: Tabela Supabase com trilha de auditoria de todos os acessos a dados financeiros
- **pg_cron**: Extensão PostgreSQL para agendamento de jobs diretamente no banco de dados
- **CORS**: Cross-Origin Resource Sharing — política de segurança do browser que bloqueia chamadas cross-origin não autorizadas
- **Rate_Limiter**: Componente do Backend_Proxy que limita o número de requisições por IP/usuário em uma janela de tempo
- **Demo_Mode**: Modo de operação do frontend que usa dados simulados quando o backend está indisponível

---

## Requisitos

### Requisito 1: Autenticação via Google SSO

**User Story:** Como um funcionário da EXA, quero fazer login no dashboard usando minha conta Google corporativa, para que eu possa acessar dados financeiros de forma segura sem gerenciar senhas separadas.

#### Critérios de Aceitação

1. WHEN um usuário inicia o fluxo de login, THE Backend_Proxy SHALL redirecionar para o fluxo OAuth2 do Google e solicitar os escopos de perfil e e-mail
2. WHEN o Google retorna um ID token válido, THE Backend_Proxy SHALL validar a assinatura do token usando as chaves públicas do Google e verificar que o campo `hd` (hosted domain) corresponde ao domínio corporativo configurado
3. IF o domínio do e-mail do usuário não corresponder ao domínio corporativo configurado, THEN THE Backend_Proxy SHALL rejeitar a autenticação com status HTTP 403 e mensagem de erro descritiva
4. WHEN a autenticação Google é bem-sucedida, THE Backend_Proxy SHALL criar ou atualizar a sessão do usuário no Supabase e retornar um JWT de sessão válido para o frontend
5. WHEN o JWT de sessão expira, THE Backend_Proxy SHALL retornar status HTTP 401 para que o frontend inicie novo fluxo de autenticação
6. THE Backend_Proxy SHALL aceitar apenas requisições HTTPS, rejeitando conexões HTTP com redirecionamento 301
7. WHERE o domínio corporativo é configurável, THE Backend_Proxy SHALL ler o domínio permitido de variável de ambiente, sem valor hardcoded no código

---

### Requisito 2: Backend Proxy — Endpoints de Dados

**User Story:** Como o frontend do FinOps Dashboard, quero buscar dados de billing do GCP e da Huawei Cloud via backend proxy, para que as credenciais nunca fiquem expostas no browser e os problemas de CORS sejam eliminados.

#### Critérios de Aceitação

1. THE Backend_Proxy SHALL expor endpoints REST autenticados para consulta de dados de billing GCP, billing Huawei, resumos de custo, projetos, recomendações e desperdícios
2. WHEN o Backend_Proxy recebe uma requisição autenticada de billing, THE Backend_Proxy SHALL buscar as credenciais de acesso às APIs de cloud exclusivamente do Secret_Manager, nunca de variáveis de ambiente de código ou arquivos commitados
3. WHEN o Backend_Proxy retorna dados ao frontend, THE Backend_Proxy SHALL serializar a resposta no formato ProviderData compatível com a interface DataBus existente do frontend
4. THE Backend_Proxy SHALL configurar headers CORS permitindo apenas o domínio do frontend configurado, rejeitando origens não autorizadas
5. WHEN o Backend_Proxy recebe parâmetros de query (período, filtros), THE Backend_Proxy SHALL validar e sanitizar todos os parâmetros antes de usá-los em chamadas às APIs externas
6. THE Backend_Proxy SHALL aplicar rate limiting de no máximo 60 requisições por minuto por usuário autenticado em todos os endpoints de dados
7. WHEN o Backend_Proxy processa uma requisição de dados, THE Backend_Proxy SHALL registrar um evento no audit_log contendo: e-mail do usuário, endpoint acessado, parâmetros da requisição e timestamp
8. IF uma API de cloud externa retornar erro, THEN THE Backend_Proxy SHALL retornar ao frontend uma resposta de erro sanitizada sem expor detalhes internos de infraestrutura ou stack traces

---

### Requisito 3: Gerenciamento de Segredos

**User Story:** Como administrador de segurança da EXA, quero que todas as credenciais sensíveis sejam armazenadas no Google Secret Manager, para que nenhuma chave de API ou credencial apareça no código-fonte ou em variáveis de ambiente de containers.

#### Acceptance Criteria

1. THE Backend_Proxy SHALL buscar as credenciais AK/SK da Huawei Cloud exclusivamente do Secret_Manager em tempo de execução, nunca armazenando-as em variáveis de ambiente de container ou arquivos de configuração
2. THE Backend_Proxy SHALL buscar o arquivo de service account do GCP exclusivamente do Secret_Manager em tempo de execução
3. THE Sync_Job SHALL buscar todas as credenciais de APIs externas exclusivamente do Secret_Manager antes de cada execução
4. IF o Secret_Manager estiver indisponível durante a inicialização, THEN THE Backend_Proxy SHALL falhar com erro explícito e não iniciar em estado degradado com credenciais ausentes
5. THE Backend_Proxy SHALL nunca registrar valores de segredos em logs de aplicação ou de auditoria
6. WHERE variáveis de ambiente são usadas, THE Backend_Proxy SHALL usá-las apenas para configurações não sensíveis (domínio CORS, domínio corporativo, URLs de serviços)

---

### Requisito 4: Sync Job — Coleta e Persistência de Dados

**User Story:** Como gestor de FinOps da EXA, quero que os dados de billing do GCP e da Huawei sejam coletados e persistidos automaticamente no Supabase, para que o dashboard exiba dados atualizados sem depender de chamadas em tempo real do browser.

#### Critérios de Aceitação

1. THE Sync_Job SHALL executar coleta de dados de billing diariamente e coleta de dados para detecção de anomalias a cada hora, conforme agendamento configurado via pg_cron
2. WHEN o Sync_Job coleta dados da GCP_Billing_API, THE Sync_Job SHALL normalizar os registros para o formato ProviderData e fazer upsert na tabela billing_records do Supabase
3. WHEN o Sync_Job coleta dados da Huawei_BSS_API, THE Sync_Job SHALL normalizar os registros para o formato ProviderData e fazer upsert na tabela billing_records do Supabase
4. WHEN o Sync_Job processa conjuntos de dados com mais de 1.000 registros, THE Sync_Job SHALL paginar as chamadas às APIs externas e processar os dados em chunks para suportar até 100.000 registros por execução
5. IF uma chamada à API externa falhar durante o sync, THEN THE Sync_Job SHALL realizar até 5 tentativas com backoff exponencial (1s, 2s, 4s, 8s, 16s) antes de registrar falha e continuar com os demais registros
6. WHEN o Sync_Job conclui uma execução, THE Sync_Job SHALL atualizar a tabela cost_summaries com os totais agregados por provider e período
7. WHEN o Sync_Job insere novos registros no billing_records, THE Sync_Job SHALL gerar embeddings de texto para cada novo registro usando a Gemini Embedding API e armazená-los na tabela financial_embeddings
8. IF o Sync_Job encontrar um registro já existente (mesmo provider + período + projeto), THEN THE Sync_Job SHALL atualizar o registro existente em vez de criar duplicata (upsert por chave composta)

---

### Requisito 5: Schema Supabase — Tabelas e Estrutura

**User Story:** Como desenvolvedor do backend, quero um schema PostgreSQL bem definido no Supabase para persistir dados financeiros, embeddings e auditoria, para que os dados sejam armazenados de forma estruturada e consultável.

#### Critérios de Aceitação

1. THE Supabase SHALL conter a tabela billing_records com as colunas: id, provider, project_id, project_name, service, cost, currency, period_start, period_end, region, tags (jsonb), raw_payload (jsonb), synced_at
2. THE Supabase SHALL conter a tabela cost_summaries com as colunas: id, provider, period_start, period_end, total_cost, total_waste, potential_saving, active_projects, payload (jsonb)
3. THE Supabase SHALL conter a tabela recommendations com as colunas: id, source (enum: gcp_recommender, huawei, gemini_ai), provider, title, description, saving, priority, status
4. THE Supabase SHALL conter a tabela financial_embeddings com as colunas: id, record_type, record_id, content (text), embedding (vector(768)), metadata (jsonb)
5. THE Supabase SHALL conter a tabela audit_log com as colunas: id, user_email, action, payload (jsonb), ip_address, created_at
6. THE Supabase SHALL habilitar Row Level Security em todas as tabelas, permitindo leitura apenas para usuários com JWT de sessão válido emitido pelo Supabase Auth
7. THE Supabase SHALL habilitar a extensão pgvector para suporte a colunas do tipo vector e operações de busca por similaridade
8. THE Supabase SHALL habilitar a extensão pg_cron para agendamento dos Sync_Jobs diretamente no banco de dados
9. WHEN um registro é inserido na tabela audit_log, THE Supabase SHALL impedir qualquer operação de UPDATE ou DELETE nessa tabela para garantir imutabilidade da trilha de auditoria

---

### Requisito 6: Row Level Security e Controle de Acesso

**User Story:** Como administrador de segurança da EXA, quero que os dados financeiros no Supabase sejam acessíveis apenas por usuários autenticados com JWT válido, para que nenhum dado financeiro seja exposto sem autenticação.

#### Critérios de Aceitação

1. WHILE um usuário não possui JWT de sessão válido, THE Supabase SHALL rejeitar todas as queries às tabelas billing_records, cost_summaries, recommendations e financial_embeddings com erro de permissão
2. WHEN um usuário autenticado realiza uma query, THE Supabase SHALL aplicar as políticas RLS para garantir que o usuário acesse apenas os dados permitidos pela política configurada
3. THE audit_log SHALL ser acessível para leitura apenas por usuários com role de administrador, conforme política RLS configurada
4. IF uma requisição ao Backend_Proxy não contiver JWT válido no header Authorization, THEN THE Backend_Proxy SHALL rejeitar a requisição com status HTTP 401 antes de realizar qualquer operação de banco de dados
5. THE Backend_Proxy SHALL validar o JWT de sessão do Supabase em cada requisição usando a chave pública do Supabase, sem armazenar estado de sessão no servidor

---

### Requisito 7: Pipeline RAG para Chat com Gemini

**User Story:** Como usuário do chat de IA do dashboard, quero que o agente Gemini responda perguntas sobre meus dados financeiros com contexto relevante e preciso, para que as respostas sejam baseadas nos dados reais do Supabase em vez de dados genéricos ou desatualizados.

#### Critérios de Aceitação

1. WHEN o frontend envia uma mensagem ao endpoint de chat do Backend_Proxy, THE Backend_Proxy SHALL gerar um embedding da mensagem do usuário usando a Gemini Embedding API
2. WHEN o embedding da mensagem é gerado, THE Backend_Proxy SHALL realizar busca de similaridade vetorial na tabela financial_embeddings e recuperar os 10 chunks mais relevantes
3. WHEN os chunks relevantes são recuperados, THE Backend_Proxy SHALL construir um contexto compacto a partir dos chunks e enviá-lo junto com a pergunta do usuário à Gemini API
4. THE Backend_Proxy SHALL nunca incluir credenciais de autenticação (AK/SK, tokens OAuth2, API keys) no payload enviado à Gemini API
5. WHEN o Backend_Proxy envia contexto ao Gemini, THE Backend_Proxy SHALL limitar o tamanho total do contexto para não exceder o limite de tokens configurado, priorizando os chunks de maior similaridade
6. WHEN o Gemini retorna uma resposta, THE Backend_Proxy SHALL armazenar a mensagem do usuário e a resposta no histórico de conversa no Supabase para fins de auditoria
7. IF a busca vetorial não retornar chunks com similaridade acima do threshold configurado, THEN THE Backend_Proxy SHALL informar ao Gemini que não há dados suficientes para responder com precisão, em vez de inventar dados

---

### Requisito 8: Integração Frontend — DataBus e AI Agent

**User Story:** Como desenvolvedor frontend, quero atualizar o DataBus e o AI Agent para consumir o backend proxy, para que o frontend deixe de chamar APIs de cloud diretamente e passe a usar o backend como intermediário seguro.

#### Critérios de Aceitação

1. WHEN o DataBus carrega dados e o backend está disponível, THE DataBus SHALL buscar dados de billing e resumos exclusivamente via endpoints autenticados do Backend_Proxy, sem chamar GCP_Billing_API ou Huawei_BSS_API diretamente do browser
2. WHEN o AI_Agent processa uma mensagem de chat e o backend está disponível, THE AI_Agent SHALL enviar a mensagem ao endpoint RAG do Backend_Proxy em vez de chamar a Gemini API diretamente do browser
3. IF o Backend_Proxy estiver indisponível, THEN THE DataBus SHALL ativar o Demo_Mode com dados simulados e exibir indicador visual informando que o backend está offline
4. WHEN o frontend recebe um JWT de sessão do Backend_Proxy após login, THE DataBus SHALL armazenar o JWT em memória e incluí-lo no header Authorization de todas as requisições subsequentes ao backend
5. WHEN o Backend_Proxy retorna status HTTP 401, THE DataBus SHALL limpar o JWT armazenado e redirecionar o usuário para o fluxo de login
6. THE DataBus SHALL manter compatibilidade com o formato ProviderData existente ao processar respostas do Backend_Proxy, sem alterações na interface pública do DataBus para os módulos de UI
7. WHEN o usuário clica em "Login com Google" no frontend, THE Frontend SHALL iniciar o fluxo OAuth2 via Backend_Proxy em vez de usar o fluxo OAuth2 client-side existente do GCP_Adapter

---

### Requisito 9: Fluxo de Login e Sessão

**User Story:** Como usuário do dashboard, quero fazer login uma única vez com minha conta Google corporativa e manter a sessão ativa durante meu uso, para que eu não precise reautenticar a cada acesso.

#### Critérios de Aceitação

1. WHEN um usuário acessa o dashboard sem sessão ativa, THE Frontend SHALL exibir a tela de login com opção de autenticação via Google SSO e opção de modo demo
2. WHEN o usuário clica em "Login com Google", THE Frontend SHALL redirecionar para o endpoint de autenticação do Backend_Proxy, que iniciará o fluxo OAuth2 com o Google
3. WHEN o Backend_Proxy conclui a autenticação com sucesso, THE Backend_Proxy SHALL redirecionar o browser de volta ao frontend com o JWT de sessão como parâmetro seguro
4. WHEN o frontend recebe o JWT de sessão, THE Frontend SHALL armazenar o token em memória (não em localStorage) e exibir o dashboard com os dados do usuário autenticado
5. WHEN o usuário clica em "Sair", THE Frontend SHALL limpar o JWT da memória e exibir a tela de login
6. WHEN o JWT de sessão expira, THE Frontend SHALL detectar o erro 401 do backend e redirecionar automaticamente para o fluxo de login sem perda de dados em tela

---

### Requisito 10: Auditoria e Rastreabilidade

**User Story:** Como administrador de conformidade da EXA, quero que todos os acessos a dados financeiros sejam registrados com detalhes do usuário e da operação, para que eu possa auditar quem acessou quais dados e quando.

#### Critérios de Aceitação

1. WHEN qualquer endpoint de dados do Backend_Proxy é acessado com sucesso, THE Backend_Proxy SHALL inserir um registro na tabela audit_log contendo: e-mail do usuário autenticado, endpoint acessado, parâmetros da requisição (sem credenciais), endereço IP do cliente e timestamp UTC
2. WHEN uma tentativa de autenticação falha, THE Backend_Proxy SHALL registrar o evento de falha no audit_log com o motivo da rejeição e o endereço IP, sem registrar tokens ou senhas
3. THE audit_log SHALL ser append-only: nenhuma operação de UPDATE ou DELETE é permitida por nenhum usuário ou role, incluindo o service account do backend
4. WHEN o Sync_Job executa uma coleta de dados, THE Sync_Job SHALL registrar no audit_log o início e o fim da execução, o número de registros processados e eventuais erros
5. THE Backend_Proxy SHALL nunca registrar em logs valores de credenciais, tokens JWT, AK/SK ou API keys, mesmo em modo de debug

---

### Requisito 11: Confiabilidade e Tratamento de Erros

**User Story:** Como usuário do dashboard, quero que o sistema se recupere automaticamente de falhas temporárias nas APIs externas, para que interrupções momentâneas não afetem minha experiência de uso.

#### Critérios de Aceitação

1. IF uma chamada à GCP_Billing_API ou Huawei_BSS_API falhar com erro transitório (5xx, timeout), THEN THE Sync_Job SHALL realizar até 5 tentativas com backoff exponencial antes de registrar falha definitiva
2. IF o Secret_Manager estiver temporariamente indisponível durante uma requisição, THEN THE Backend_Proxy SHALL retornar status HTTP 503 ao frontend com mensagem de erro genérica, sem expor detalhes internos
3. WHEN o Backend_Proxy retorna dados ao frontend, THE Backend_Proxy SHALL incluir no payload o campo `synced_at` indicando quando os dados foram coletados pela última vez pelo Sync_Job
4. IF o Supabase estiver indisponível, THEN THE Backend_Proxy SHALL retornar status HTTP 503 ao frontend, que ativará o Demo_Mode como fallback
5. WHEN o Sync_Job falha em processar um chunk de dados, THE Sync_Job SHALL registrar o erro com detalhes do chunk afetado, continuar processando os demais chunks e reportar o número total de falhas ao final da execução

---

### Requisito 12: Configuração e Implantação

**User Story:** Como engenheiro de infraestrutura da EXA, quero que o backend seja implantável no Cloud Run com configuração via variáveis de ambiente e segredos no Secret Manager, para que o deploy seja reproduzível e seguro.

#### Critérios de Aceitação

1. THE Backend_Proxy SHALL ser empacotado como container Docker e implantável no Google Cloud Run sem modificações de código entre ambientes
2. THE Backend_Proxy SHALL ler todas as configurações não sensíveis (porta, domínio CORS, domínio corporativo, URL do Supabase, URLs das APIs) exclusivamente de variáveis de ambiente
3. THE Backend_Proxy SHALL expor um endpoint `/health` que retorna status HTTP 200 com payload JSON indicando disponibilidade do serviço, sem exigir autenticação
4. THE Sync_Job SHALL ser executável tanto como processo standalone (para execução manual ou CI/CD) quanto via pg_cron no Supabase
5. WHERE o ambiente de desenvolvimento é configurado, THE Backend_Proxy SHALL suportar modo local com variáveis de ambiente em arquivo `.env` (não commitado), mantendo a mesma interface de configuração do ambiente de produção
6. THE Backend_Proxy SHALL implementar graceful shutdown: ao receber SIGTERM, concluir as requisições em andamento antes de encerrar, com timeout máximo de 30 segundos
