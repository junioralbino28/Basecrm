# Relatório de publicação do Preview — Pacote 3

**Período do fechamento:** 2026-08-03 a 2026-08-10

**Branch:** `feat/funil-construtor`

**Base técnica anterior a este fechamento:** `734d6cf`
**Estado:** Preview isolado publicado e validado; produção não alterada.

Este documento complementa o
[`IMPL-LOG-CORRECOES-PACOTE-3.md`](./IMPL-LOG-CORRECOES-PACOTE-3.md).
O primeiro arquivo registra a implementação e as correções locais. Este registra
a preparação do ambiente remoto, a publicação, os problemas encontrados no
smoke e a situação real para a reverificação independente do Claude.

## 1. Resultado executivo

O Pacote 3 está disponível em um Preview separado da produção, com banco
Supabase próprio, migrations aplicadas desde uma base vazia e somente dados
sintéticos. O endereço estável da branch é:

`https://basecrm-git-feat-funil-construtor-junioralbino28-3867s-projects.vercel.app`

Tenant sintético usado no smoke:

`bd43a9bc-5bab-410a-a5a6-c214f3836f0e`

Rota direta validada:

`/platform/tenants/bd43a9bc-5bab-410a-a5a6-c214f3836f0e/visao-geral`

A credencial de teste não está neste repositório. Ela foi criada apenas no
projeto de staging e deve ser compartilhada por canal privado.

## 2. Isolamento aplicado

- Vercel: projeto `basecrm`, target `preview`, alias estável da branch
  `feat/funil-construtor`.
- Supabase de staging: projeto `basecrm-p3-preview`, ref
  `zvwngsrflkicbbzfmrgy`, região `us-east-2`.
- Supabase de produção preservado: ref `eqidsihasmwwamkaqfka`.
- Branch `main` preservada no checkpoint `be7fe35` durante a preparação do
  Preview.
- Nenhum paciente, contato, atendimento ou configuração real foi copiado.
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
- dados reais;
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

1. Abrir o alias estável e entrar com o usuário sintético compartilhado em canal
   privado.
2. Confirmar o tenant `BaseCRM - Ambiente de Teste Pacote 3`.
3. Em **Configurações → Profissionais → Equipe**, validar os três colaboradores
   e abrir **Comissões**.
4. Em **Cargos**, confirmar `Consultor` e `Coordenador`.
5. Em **Especialidades**, abrir **Procedimentos** e confirmar os dois itens.
6. Em **Financeiro**, conferir que **Salários fixos** aparece como dedução e que
   o líquido fecha a cascata.
7. Abrir o relatório por colaborador e conferir as colunas de fixo, comissão e
   remuneração total.
8. Exportar o PDF e confirmar que o mesmo salário e líquido aparecem nele.
9. Revisar este relatório e o IMPL-LOG antes de qualquer discussão sobre
   produção.
