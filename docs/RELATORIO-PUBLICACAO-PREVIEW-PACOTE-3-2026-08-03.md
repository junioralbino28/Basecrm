# Relatório de publicação do Preview — Pacote 3

**Período do fechamento:** 2026-08-03 a 2026-08-10

**Branch:** `feat/funil-construtor`

**Base técnica anterior a este fechamento:** `734d6cf`
**Estado:** Preview isolado publicado e validado; produção não alterada. O
staging contém o tenant sintético original e dois clones pseudonimizados para
teste prático.

Este documento complementa o
[`IMPL-LOG-CORRECOES-PACOTE-3.md`](./IMPL-LOG-CORRECOES-PACOTE-3.md).
O primeiro arquivo registra a implementação e as correções locais. Este registra
a preparação do ambiente remoto, a publicação, os problemas encontrados no
smoke e a situação real para a reverificação independente do Claude.

## 1. Resultado executivo

O Pacote 3 está disponível em um Preview separado da produção, com banco
Supabase próprio e migrations aplicadas desde uma base vazia. O ambiente tem um
seed totalmente sintético e, desde 10/08/2026, clones pseudonimizados da Dra.
Jéssica e da FM Vistos para teste prático. O endereço permanente é:

`https://teste.crm.basea2.com`

Alias técnico automático da branch:

`https://basecrm-git-feat-funil-construtor-junioralbino28-3867s-projects.vercel.app`

### 1.1 Separação permanente dos ambientes — 10/08/2026

O alias automático da branch já havia sido usado com o Supabase de produção e
depois foi redirecionado para o staging vazio do Pacote 3. Isso não excluiu os
dados existentes, mas retirou daquele endereço o acesso às contas e aos tenants
da Dra. Jéssica e da FM Vistos. O staging recebeu um hostname próprio para
impedir nova mistura.

Mapa canônico a partir desta correção:

| Finalidade | Endereço | Banco | Regra |
|---|---|---|---|
| Produção | `https://crm.basea2.com` | Supabase `eqidsihasmwwamkaqfka` | Uso real; não recebe experimentos nem alterações sem rollout aprovado |
| Teste permanente | `https://teste.crm.basea2.com` | Supabase `zvwngsrflkicbbzfmrgy` | Validação de código e dados sintéticos |
| Preview automático | URL Vercel da branch | Conforme overrides da branch | Endereço técnico; nunca deve ser entregue como referência permanente ao usuário |

Infraestrutura aplicada:

- domínio cadastrado no projeto Vercel `basecrm`;
- alias fixado no deployment Preview já testado
  `dpl_4NkKJsrggXkdhW8FGm4ZUoWotWWd`, sem rebuild e sem promoção;
- DNS Cloudflare `A teste.crm.basea2.com -> 76.76.21.21`, sem proxy;
- certificado TLS emitido pela Vercel;
- `crm.basea2.com` permaneceu no deployment de produção
  `dpl_9rziTdebyuf35a16fvcPuoGU5Jiz`.

Validação pós-configuração:

- `/login` respondeu 200 e rota protegida sem sessão redirecionou para login;
- login sintético aprovado em `teste.crm.basea2.com`;
- tenant exibido: `BaseCRM - Ambiente de Teste Pacote 3`;
- Dra. Jéssica e FM Vistos não apareceram no seletor do staging;
- chamadas autenticadas foram para o Supabase de staging
  `zvwngsrflkicbbzfmrgy`, com respostas 200;
- navegador sem erro de página ou overlay;
- nenhum log de nível `error` ou resposta 5xx foi encontrado no deployment no
  intervalo da validação.

Regra operacional: um hostname voltado ao usuário nunca pode trocar de banco.
Uma versão nova deve ser validada em `teste.crm.basea2.com` e somente depois,
em plano separado com backup, migrations e rollback, ser promovida para
`crm.basea2.com`.

Tenant sintético usado no smoke:

`bd43a9bc-5bab-410a-a5a6-c214f3836f0e`

Rota direta validada:

`/platform/tenants/bd43a9bc-5bab-410a-a5a6-c214f3836f0e/visao-geral`

A credencial de teste não está neste repositório. Ela foi criada apenas no
projeto de staging e deve ser compartilhada por canal privado.

### 1.2 Restauração segura dos workspaces de teste — 10/08/2026

Depois da separação definitiva dos ambientes, o login voltou a funcionar no
staging, mas o seletor mostrava apenas `BaseCRM - Ambiente de Teste Pacote 3`.
Os workspaces da Dra. Jéssica e da FM Vistos continuavam existentes somente em
produção. Foi executada uma cópia controlada para devolver ao Junior um cenário
útil de testes sem reconectar serviços reais.

Produção foi acessada somente por consultas `SELECT`. Nenhuma linha, usuário,
senha, configuração ou deployment de produção foi alterado.

#### Identidade dos tenants no staging

| Tenant | UUID no staging | Situação |
|---|---|---|
| `BaseCRM - Ambiente de Teste Pacote 3` | `bd43a9bc-5bab-410a-a5a6-c214f3836f0e` | Preservado integralmente |
| `Clínica Dra. Jéssica Barros — Teste` | `b439ba19-b560-4c17-89f7-7e8f1b41d793` | Clone pseudonimizado |
| `FM Vistos — Teste` | `2c263b5a-f34d-4e5f-819a-8b9ff2d0ba2c` | Clone estrutural pseudonimizado |

O UUID do tenant sintético era igual ao UUID real da Dra. Jéssica em produção.
Por isso ele não foi sobrescrito nem reutilizado. Foram gerados dois UUIDs novos
para os clones; os IDs filhos foram preservados somente depois de uma varredura
de PKs e índices únicos confirmar zero colisões no staging.

#### Backup anterior à carga

O staging está no plano Free, sem backup remoto e sem PITR. Antes da primeira
escrita foi criado um backup lógico local em
`supabase/.temp/backups/staging-20260810-170249/`, diretório ignorado pelo Git.

| Arquivo | Tamanho | SHA-256 |
|---|---:|---|
| `roles.sql` | 297 B | `25873cec56a2cc6514e204f420231777f85c03da818caa7090cdcdfa89776ecd` |
| `schema.sql` | 490.034 B | `bfc17c8209d3b3be4c37a3619d52e160d98229790f09ebcf83bbf84cf9c75fdd` |
| `data.sql` | 73.770 B | `8862cb1eba388d9b6ccd095af7151892beaea29476c7e06882a4a17c940915de` |
| `history_schema.sql` | 887 B | `18b99fbbb3ec9fbb964bb255a56171329acd99b6977ece2addd89fdf5aa5105b` |
| `history_data.sql` | 685.696 B | `b8226c9db829b8d779aa2ebf178c2337da5b9cd13c1c2d2cac8a7b69f72b2d54` |

Os cinco arquivos estavam presentes e não vazios, totalizando 1.250.684 bytes.
O dump foi validado estruturalmente. Ainda não houve um ensaio completo de
restore; o `pg_dump` avisou sobre FKs circulares e um restore deve usar
`session_replication_role=replica` em uma instância descartável PostgreSQL 17.

#### Dados copiados

A carga explícita teve 280 linhas e gerou mais 7 versões de remuneração pelo
trigger do staging, totalizando 287 linhas novas.

| Estrutura | Dra. Jéssica | FM Vistos |
|---|---:|---:|
| Organizações, settings e editions | 1 de cada | 1 de cada |
| Boards / estágios | 2 / 16 | 1 / 7 |
| Produtos | 101 | 0 |
| Fontes de lead | 4 | 0 |
| Cargos / especialidades | 3 / 9 | 0 / 0 |
| Profissionais / vínculos com especialidades | 7 / 11 | 0 / 0 |
| Regras de comissão | 90 | 0 |
| Contatos / negócios | 4 / 5 | 0 / 0 |
| Categorias / tags / atribuições | 1 / 2 / 4 | 0 / 0 / 0 |
| Tarefas / agendamentos | 3 / 2 | 0 / 0 |
| Run de provisionamento sanitizado | 1 | 1 |

Transformações aplicadas:

- contatos viraram `Contato Teste NNN`; email, telefone, avatar, notas e
  nascimento ficaram nulos;
- profissionais viraram `Profissional Teste NN`; `external_id` e proprietário
  ficaram nulos;
- negócios viraram `Negócio Teste NNN`; resumo de IA, motivo de perda e campos
  personalizados foram removidos;
- tarefas viraram itens concluídos, com texto genérico e sem ator, impedindo
  lembretes;
- agendamentos ficaram `cancelado`, origem `manual`, sem identificador externo
  ou notas;
- todos os `owner_id`, `created_by`, `updated_by`, `archived_by` e equivalentes
  do subconjunto foram zerados;
- chaves de IA ficaram nulas, `ai_enabled=false` e
  `automation_live_enabled=false`;
- payloads de provisionamento foram reduzidos a um resumo seguro;
- 82 regras receberam `product_id` canônico; 8 regras gerais permaneceram sem
  produto. Três regras apontavam para um nome duplicado e receberam de forma
  determinística o produto mais antigo/menor ID.

Como os UUIDs filhos, valores financeiros e timestamps foram preservados, o
resultado é **pseudonimizado**, não anonimizado de forma irreversível. As
verificações não encontraram PII nos campos e padrões definidos, mas alguém com
acesso aos dois bancos poderia correlacionar IDs. Esse risco precisa permanecer
registrado; a busca de segredos por padrões de alta confiança também não prova
ausência semântica de qualquer segredo arbitrário.

#### Dados e integrações deliberadamente omitidos

- `auth.users`, profiles, permissões, convites e preferências da produção;
- WhatsApp/Evolution, `channel_connections`, conversas e mensagens;
- `clinicorp_config` e qualquer credencial Clinicorp;
- endpoints inbound/outbound, webhooks, tokens de API e report tokens;
- domínios, arquivos/storage, logs, auditoria e histórico de IA;
- definições e estado operacional de automações, jobs, waits e inbox events.

#### Execução e validação

A carga usou listas explícitas de colunas e uma única transação. Antes do
`COMMIT`, o mesmo lote de 142.244 bytes foi executado integralmente com
`ROLLBACK`; passou por constraints, triggers e validações e deixou zero linhas
residuais. O lote definitivo repetiu a transação aprovada.

Validação pós-carga:

- todas as contagens corresponderam ao manifesto, sem divergência;
- 7 versões de remuneração foram geradas, uma por profissional;
- 82 regras possuem produto canônico e 8 são regras gerais;
- zero PII residual nos campos definidos para pseudonimização;
- zero referências órfãs ou cross-org;
- zero profiles, canais, Clinicorp, endpoints, webhooks, conversas, tokens ou
  automações nos dois clones;
- IA e automação live permaneceram desligadas;
- fingerprint de 12 estruturas do tenant sintético teve zero diferenças após a
  carga e depois do smoke;
- produção permaneceu somente leitura.

Smoke autenticado em `https://teste.crm.basea2.com`:

- `/platform/tenants` exibiu os três workspaces;
- Dra. Jéssica abriu o dashboard, o funil com negócios pseudonimizados, os 4
  contatos e a agenda sem erro de página;
- FM Vistos abriu o dashboard e o `Funil de Agendamento - FM Vistos`, vazio
  como esperado;
- nenhum error overlay ou page error foi encontrado;
- o console exibiu apenas warnings não bloqueantes do gráfico Recharts com
  dimensão `-1` durante a automação headless.

O link mágico de QA revelou uma configuração antiga do Auth: redirects não
permitidos recaem em `http://localhost:3000`. Para não alterar a senha do Junior
nem ampliar o escopo, o smoke usou um `agency_admin` temporário exclusivo do
staging. O usuário, seu profile e suas settings foram removidos ao final; as
consultas confirmaram zero resíduos.

## 2. Isolamento aplicado

- Vercel: projeto `basecrm`, target `preview`, alias estável da branch
  `feat/funil-construtor`.
- Supabase de staging: projeto `basecrm-p3-preview`, ref
  `zvwngsrflkicbbzfmrgy`, região `us-east-2`.
- Supabase de produção preservado: ref `eqidsihasmwwamkaqfka`.
- Branch `main` preservada no checkpoint `be7fe35` durante a preparação do
  Preview.
- Nenhuma PII de paciente ou credencial real foi copiada. Um subconjunto de
  configuração e operação foi pseudonimizado conforme a seção 1.2.
- I.A. desativada no tenant sintético.
- Automações em modo seguro: `automation_live_enabled=false` e nenhuma
  automação cadastrada.
- Instalador desabilitado na branch com `INSTALLER_ENABLED=false`.

As variáveis públicas e server-side do Supabase possuem overrides exclusivos
para a branch de Preview. Valores e chaves não foram gravados no Git.

## 3. Banco remoto e seed

O projeto de staging começou vazio. A cadeia completa de **71 migrations** foi
aplicada em ordem, de `20251201000000` até `20260803100000`.

Validações remotas realizadas:

- ledger local e remoto com as mesmas 71 versões;
- `supabase db lint --linked --level error` sem erros de schema;
- projeto em estado `ACTIVE_HEALTHY`;
- tenant sintético criado com o mesmo UUID da rota de teste;
- 2 cargos, 2 especialidades, 2 produtos/serviços e 3 colaboradores;
- colaboradores sintéticos cobrindo remuneração somente por comissão, somente
  fixa e híbrida;
- 2 regras de comissão e 3 versões iniciais de remuneração;
- 0 automações e execução automática desativada.

O seed permite exercitar comissão percentual, vínculo por especialidade,
procedimento habilitado/desabilitado e salário fixo proporcional sem usar dados
de produção.

## 4. Problemas encontrados e correções

### 4.1 Autorização da Vercel expirou

A primeira tentativa de publicação abriu o device flow da Vercel e expirou
enquanto o Junior estava longe do computador. A publicação foi retomada com a
credencial local já autorizada, sem exigir uma nova interação manual.

### 4.2 Preview retornou `401 Invalid API key`

O primeiro deploy novo foi construído, mas as rotas server-side falharam porque
`lib/supabase/server.ts` prioriza `SUPABASE_SECRET_KEY` e a chave moderna
configurada no projeto novo foi rejeitada pelo REST desse ambiente.

Correção aplicada somente no override da branch: a variável passou a usar a
chave server-side legada do próprio staging, que já havia sido validada com
status 200. Nenhuma chave de produção foi usada e nenhum segredo foi incluído
no código ou neste relatório.

Depois do redeploy, as APIs e páginas protegidas voltaram a responder 200 e o
console do navegador ficou sem erros.

### 4.3 Salário fixo era descontado, mas não aparecia

O smoke encontrou uma divergência funcional que os testes anteriores não
cobriam. `get_net_result` calculava e descontava corretamente a remuneração
fixa proporcional, mas o service TypeScript descartava `salarios_fixos` e
`remuneracao_total`. O efeito visível era um líquido negativo sem uma dedução
que o explicasse. O PDF ainda recalculava o líquido sem o salário e podia
discordar da tela.

Correções realizadas:

- contrato TypeScript e transformadores preservam fixo e remuneração total;
- fallback mantém compatibilidade com respostas anteriores às novas RPCs;
- Financeiro ganhou card explícito de **Salários fixos**;
- o donut inclui salários, inclusive quando ainda não existe faturamento;
- cálculo e PDF deduzem a mesma parcela fixa usada pela RPC;
- relatório por colaborador exibe cargo, fixo no período,
  comissão, remuneração total, remuneração paga e remuneração a pagar;
- o saldo a pagar usa `remuneração total - valor pago`, coerente com a RPC de
  pagamento, que quita fixo e comissão em conjunto;
- a modalidade atual (`pay_type`) não é mostrada como se fosse um dado histórico
  do período; as parcelas realizadas aparecem separadas nas próprias colunas;
- os seis KPIs do PDF usam grade 3×2 para impedir sobreposição em A4;
- rótulo da tabela alterado de “Dentista” para “Colaborador”;
- regressões adicionadas para remuneração fixa, comissionada e híbrida.

No seed, o valor observado de `R$ 258,06` correspondia a um dia de vigência de
`R$ 5.000 / 31 + R$ 3.000 / 31`. Esse total é proporcional ao período e pode
mudar conforme o intervalo selecionado.

## 5. Evidências de validação

### Código e banco local

- testes focais da correção: **46/46 aprovados**;
- suíte padrão: **946/946 aprovados**;
- suíte completa sequencial com Supabase local: **231 arquivos e 1.113 testes aprovados**;
- TypeScript: aprovado;
- ESLint com zero violações;
- build Next.js de produção: aprovado, 106 páginas estáticas geradas;
- `git diff --check`: aprovado.

O build mantém um warning preexistente do Turbopack sobre tracing amplo a
partir de `next.config.ts` e do instalador. Ele não impediu compilação, mas não
foi classificado como resolvido neste pacote.

Uma execução paralela anterior teve uma falha intermitente no teste global de
saúde do tick: outro arquivo sobrescreveu a mensagem compartilhada entre
`fail_automation_tick_request` e a asserção. O caso isolado passou **5/5** e a
suíte final com `--maxWorkers=1` passou **1.113/1.113**. Nenhuma alteração no
motor de automações foi feita para mascarar a disputa do runner.

### Smoke HTTP e navegador

- OpenAPI público: 200;
- verificação de instalador: 200 e instância inicializada;
- rota protegida sem sessão: 307 para `/login`;
- login do usuário sintético: aprovado;
- `/platform/tenants`: carregou o tenant sintético;
- Visão Geral: carregou sem erro de console;
- Configurações → Profissionais: equipe, cargos e especialidades carregados;
- detalhe de comissão por procedimento carregado;
- Financeiro: RPCs `get_revenue_report`, `get_commission_report` e
  `get_net_result` responderam 200;
- relatório por colaborador: carregado com os três tipos de remuneração;
- logs do deploy final consultados sem erro ou resposta 5xx no intervalo do
  smoke.

O smoke no navegador foi de leitura. Escritas compostas, concorrência,
isolamento e pagamento idempotente foram exercitados pela suíte automatizada
contra o Supabase local.

### Segurança

- o audit detectou em 2026-08-10 uma vulnerabilidade alta recém-publicada no
  `js-yaml 4.3.0`, dependência transitiva de desenvolvimento do ESLint; o
  lockfile foi atualizado para a versão corrigida `4.3.1`;
- `npm audit` final: 0 vulnerabilidades;
- Semgrep `1.170.1`: 0 findings na execução final;
- o scan anterior do histórico Git pelo Gitleaks encontrou 0 secrets;
- o runner agregado final `audit-seg.sh` permaneceu **inválido/fail-closed**
  porque a nova varredura completa do Gitleaks ultrapassou o limite de 10
  minutos. Portanto este relatório não chama o baseline agregado de auditoria
  completa nem afirma cobertura integral dos 25 gates.

## 6. O que não foi alterado

- domínio e deploy de produção `crm.basea2.com`;
- branch `main`;
- banco Supabase de produção;
- PII, credenciais, conversas ou integrações reais; somente o subconjunto
  pseudonimizado descrito na seção 1.2 existe no staging;
- automações, webhooks, Evolution API ou envios externos;
- calendário Google/Calendly, que permanece fora do Pacote 3.

## 7. Bloqueio separado para produção

O Preview novo provou que as migrations funcionam quando aplicadas do zero. Isso
não autoriza aplicá-las na base existente de produção.

Antes de produção ainda é obrigatório:

1. conferir o ledger remoto das versões `20260803*` e detectar qualquer versão
   já registrada com conteúdo anterior;
2. auditar vínculos órfãos/cross-org e mapeamentos legados de produtos,
   especialidades e regras;
3. validar snapshots financeiros e colaboradores fixos/híbridos já existentes;
4. criar backup/restore testado ou clone restaurável;
5. ensaiar a cadeia sobre uma cópia exata da base anterior;
6. preparar uma migration compensatória nova se alguma versão já tiver sido
   aplicada; migrations registradas não podem ser editadas ou “reparadas” para
   mascarar estado;
7. executar rollout app + banco em janela controlada. Não existem down
   migrations confiáveis para esse conjunto.

Produção deve permanecer bloqueada até esse preflight ser aprovado.

## 8. Roteiro curto para reverificação do Claude

1. Abrir `https://teste.crm.basea2.com` e entrar com a credencial compartilhada
   em canal privado.
2. Confirmar os três tenants: `BaseCRM - Ambiente de Teste Pacote 3`,
   `Clínica Dra. Jéssica Barros — Teste` e `FM Vistos — Teste`.
3. No tenant sintético, em **Configurações → Profissionais → Equipe**, validar
   os três colaboradores e abrir **Comissões**.
4. Em **Cargos**, confirmar `Consultor` e `Coordenador`.
5. Em **Especialidades**, abrir **Procedimentos** e confirmar os dois itens.
6. Em **Financeiro**, conferir que **Salários fixos** aparece como dedução e que
   o líquido fecha a cascata.
7. Abrir o relatório por colaborador e conferir as colunas de fixo, comissão e
   remuneração total.
8. Exportar o PDF e confirmar que o mesmo salário e líquido aparecem nele.
9. Revisar este relatório e o IMPL-LOG antes de qualquer discussão sobre
   produção.

## 9. Ajustes de produto registrados, fora desta restauração

- substituir na interface de agência o termo **Clínica** por **Empresa** ou
  **Negócio**, incluindo títulos, menu, seletor e ações de criação; o produto é
  multissetorial e não deve assumir saúde como padrão;
- revisar a largura e densidade dos cards do funil, que ficam apertados na tela
  do Junior;
- priorizar integração com Google Agenda: o compromisso nasce no CRM e é
  espelhado no Google; Calendly fica como integração posterior;
- corrigir a allowlist/Site URL do Supabase Auth do staging, hoje com fallback
  para `http://localhost:3000` em links mágicos;
- tratar o warning de dimensão do Recharts observado no navegador headless,
  depois de confirmar se também ocorre em viewport real.
