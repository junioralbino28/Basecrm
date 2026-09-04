# REVERIFICAÇÃO INDEPENDENTE — Correções do Pacote 3

**Revisor:** Claude (independente do Codex, que implementou)
**Data:** 2026-09-04
**Branch:** `feat/funil-construtor`
**Checkpoint revisado:** **`2793ff4`** — não `553303a`
**Estado:** ✅ **fases 1 e 2 concluídas — parecer fechado · V-01 corrigida na branch (§0) · R-01 e R-08 corrigidos (§0b)**

> Nenhuma linha de código foi alterada nesta revisão. Sem acesso a produção, sem push de
> código, sem deploy, sem merge, sem `db reset`. Todo teste de escrita rodou em banco
> local descartável (`p3_verify`) ou em transação revertida.

---

## 🚨 LEIA PRIMEIRO — vulnerabilidade achada FORA do escopo do Pacote 3

Uma varredura de superfície — a que o baseline agregado deveria fazer e nunca fez, porque o
`audit-seg.sh` não existe — encontrou **quatro funções `SECURITY DEFINER` executáveis pelo role
`anon`**, que é o role da chave pública embutida no front-end.

**Provado ao vivo no Supabase local**, com a chave pública e sem sessão nenhuma:

| Passo | Resultado |
|---|---|
| `GET /rest/v1/deals?id=eq.<uuid>` | `[]` — **o RLS barrou a leitura, corretamente** |
| `POST /rest/v1/rpc/mark_deal_won {"deal_id":"<uuid>"}` | **HTTP 204 — aceito** |
| Estado do negócio depois | `is_won=true`, `closed_at` preenchido |
| `POST /rest/v1/rpc/cleanup_rate_limits {"older_than_minutes":0}` | **HTTP 200 — aceito** |

```sql
-- nenhuma checagem de organização, permissão ou autenticação:
CREATE OR REPLACE FUNCTION public.mark_deal_won(deal_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions'
AS $function$
BEGIN
    UPDATE public.deals SET is_won = TRUE, is_lost = FALSE,
        closed_at = NOW(), updated_at = NOW() WHERE id = deal_id;
END;
$function$
```

**Funções afetadas:** `mark_deal_won`, `mark_deal_lost`, `reopen_deal`, `cleanup_rate_limits`
(as quatro com `has_function_privilege('anon', …, 'EXECUTE') = true` confirmado no catálogo).

**Alcance real:** não há vazamento de dado — o RLS continua barrando leitura. O que existe é
**escrita cross-tenant sem autenticação**: alterar o estado comercial de qualquer negócio de
qualquer cliente, e desarmar o controle de taxa. Como as funções são `SECURITY DEFINER`, elas
passam por cima do isolamento por `organization_id`.

**Único obstáculo hoje:** conhecer o UUID do negócio. UUID v4 não é adivinhável por força bruta,
mas também não é segredo — aparece em URL, link compartilhado, print, log e integração. É
inconveniência, não controle de acesso.

**Não é regressão do Pacote 3.** São funções antigas da base do projeto. Mas está valendo em
`crm.basea2.com` agora. Viola G3 (autorização no servidor) e G4 (IDOR) dos gates da Cenoura.

### §0 — Correção aplicada em 04/09, autorizada pelo Junior (*"pode consertar a V-01"*)

**Migration `20260904000000_v01_fechar_rpcs_publicas.sql`**, na branch. Nenhuma assinatura mudou;
o corpo dos `UPDATE` é o original. O que muda:

- as três RPCs de negócio passam a exigir `public.can_operate_deal(deal_id)` **antes** de escrever —
  o mesmo gate da policy `deals_mutate_by_tenant_operator` (`can_operate_organization`), então quem
  já podia editar o negócio pela tabela continua podendo pela RPC, e mais ninguém. Negócio de outra
  organização e negócio inexistente recebem o mesmo `42501`, sem sondagem de existência;
- `REVOKE ALL … FROM PUBLIC, anon` nas três, `GRANT … TO authenticated, service_role`;
- `cleanup_rate_limits` fica restrita ao `service_role` (`REVOKE … FROM PUBLIC, anon, authenticated`);
- **diff de cabeçalho declarado:** as quatro saem de `search_path = public[, extensions]` para
  `search_path = ''` com nomes qualificados, o padrão do restante do motor. `SECURITY DEFINER`,
  `RETURNS` e parâmetros preservados.

**Por que gate + REVOKE, e não só REVOKE:** o REVOKE fecha o `anon`; o gate fecha o usuário
autenticado de **outra** organização, que antes também conseguia (a função era `SECURITY DEFINER`
sem checagem nenhuma).

**Provas, nesta ordem:**

| Prova | Resultado |
|---|---|
| Catálogo real (`has_function_privilege`) | `anon` = **false** nas quatro; `authenticated` mantém as 3 de negócio e perde `cleanup`; `service_role` mantém as 4; `search_path=""` nas quatro |
| Varredura: alguma `SECURITY DEFINER` executável por `anon` que escreva em `deals`/`rate_limits`? | **0** |
| **A mesma exploração de antes, pela API** | `mark_deal_won` / `mark_deal_lost` / `reopen_deal` / `cleanup_rate_limits` → **HTTP 401, `42501 permission denied`**; negócio intocado (`is_won=false, closed_at=null`) |
| Cadeia do zero | **72/72** no banco descartável; ledger local em 72 |
| `test/v01FecharRpcsPublicasMigration.test.ts` (estático) | 4/4 |
| `test/v01FecharRpcsPublicas.local.test.ts` (integração, Supabase local) | **5/5** — anônimo recusado e negócio intocado · admin de OUTRA org recusado · inexistente = mesmo `42501` · admin **e** `clinic_staff` da org certa marcam ganho/perdido/reabrem · `cleanup` só responde ao `service_role` |
| ESLint `--max-warnings 0` · `tsc --noEmit` | limpos |
| Suíte completa `npm run test:local` | **233 arquivos / 1.122 testes, zero falhas** (239,8 s). Eram 231 / 1.113: os +2 / +9 são exatamente os dois testes novos. Saída em arquivo, lida em comando separado antes do commit |

**Auto-revisão adversarial (escrita antes de declarar pronto):**

1. *Quebrei algum chamador legítimo?* Não há chamador no repositório (varredura em `.ts/.tsx/.mjs/.js`
   fora de `node_modules`, `.next` e migrations). O único comportamento que muda para quem chamava
   com JWT válido é: negócio inexistente deixa de ser no-op silencioso e vira `42501`.
2. *O `search_path=''` quebra algo?* `now()`, `coalesce`, `||`, `::interval` vivem em `pg_catalog`
   (sempre no caminho); tabelas e helper estão qualificados. O teste de integração exercita as
   funções reais e o caminho legítimo passou.
3. *`service_role` com EXECUTE mas sem perfil recebe `42501` do gate.* Consistente com
   `record_commission_payment` (mesmo padrão do Codex). Sem chamador; documentado.
4. *`can_operate_deal` é `SECURITY DEFINER` com `search_path = public`* — folga preexistente no
   helper de que agora dependo. Chamo-o qualificado; o corpo dele também é qualificado. Risco
   baixo, registrado como adjacente.
5. *Existe outro caminho de escrita em `deals` para `anon`?* REST direto → RLS ativo e **zero
   policies** para `anon`. Funções `INVOKER` herdam esse bloqueio. `DEFINER` executáveis por `anon`
   que escrevam em `deals`/`rate_limits`: 0 após a migration.
6. *Reaplicável?* `CREATE OR REPLACE` + `REVOKE`/`GRANT` — idempotente.
7. *O teste estático reprovou na primeira rodada* porque lia o **comentário** do cabeçalho (que
   cita "GRANT … anon" e "SECURITY DEFINER" ao explicar o mecanismo). Corrigido para ignorar linhas
   de comentário. Defeito do teste, não da migration — registrado por honestidade.

**⚠️ PRODUÇÃO CONTINUA EXPOSTA.** Esta correção existe na branch e no Supabase local. O hotfix
anterior (`IMPL-LOG-HOTFIX-SEGURANCA.md`) também ficou só no local — produção está congelada desde
antes dele. O buraco em `crm.basea2.com` só fecha com o rollout, que exige o preflight de 7 passos.
**Decisão do Junior:** levar esta migration sozinha como hotfix (fora do ledger, em janela própria)
ou junto com a cadeia do Pacote 3. Não faço isso por conta própria.

### §0b — R-01 e R-08 corrigidos em 04/09 (decisão do Junior: cada relatório numa régua só)

**Decisão (Junior, 04/09):** *"os 2 podem ser usados, mas em momentos diferentes. Para metrificar o
ganho do lead metrifica no mês de fechamento, mas o dinheiro só consta em caixa quando ele realmente
entrar"* — e, na sequência: *"o mais importante hoje é metrificar o COMERCIAL"*. Leitura confirmada
por ele: **Comercial** pelo mês em que o lead virou ganho · **Financeiro = caixa puro** ·
**Profissionais = competência**. Nunca subtrair uma régua da outra.

**Migration `20260904010000_r08_financeiro_caixa_e_equipe_competencia.sql`** (cabeçalhos de segurança
conferidos no catálogo antes de reescrever; `STABLE SECURITY DEFINER`, `search_path = ''` e gates
preservados nas duas RPCs):

- **R-01:** o bloco `sem_profissional` de `get_commission_report` passa a contar por `performed_at`,
  sem exigir recebimento — a mesma régua das linhas. O resto da função é idêntico.
- **R-08:** `get_net_result` vira caixa puro. `faturamento` e `taxas` seguem pela data do pagamento
  (como já eram); entra **`remuneracao_paga`** = pagamentos à equipe no período
  (`commission_payments.paid_at`; a RPC de pagamento quita fixo + comissão juntos); contas fixas
  continuam como estimativa mensal × meses (o produto não registra pagamento delas);
  `liquido = faturamento − taxas − remuneracao_paga − contas`; `regime: 'caixa'` no contrato.
  `comissoes` e `salarios_fixos` **saem** do JSON — o devido vive em Profissionais.
- **Tela e PDF:** os cards "Comissões" e "Salários fixos" viram um só, **"Pago à equipe"** (6 → 5
  KPIs); o donut e o PDF acompanham; a página deixa de buscar o relatório de comissão (não havia mais
  consumidor). Nenhum layout novo — o Junior pediu para não redesenhar.

**Provas:**

| Prova | Resultado |
|---|---|
| Cadeia do zero no banco descartável | **73/73**; ledger local em 73 |
| `test/r08FinanceiroCaixaMigration.test.ts` (estático) | 3/3 |
| Unitários dos 4 arquivos tocados (`financeMath`, `reports`, `FinanceReportPage`, `generateReportPDF`) | 32/32 |
| **Integração real `financeReportsRpcs.multiTenant`** | **10/10**, com fixture novo A5 (sem colaborador, feito 30/06 e pago 02/07): `sem_profissional` de junho = **2 / R$ 700** (antes 1 / R$ 300 — o A5 sumia); `get_net_result` de junho = recebido 1.700 − taxas 28,35 − **pago à equipe 100** − contas 250, com `regime = 'caixa'` e sem `comissoes`/`salarios_fixos` |
| `tsc --noEmit` · ESLint `--max-warnings 0` | limpos |
| Suíte completa `npm run test:local` | **234 arquivos / 1.125 testes, zero falhas** (190 s). Eram 233 / 1.122: o +1 / +3 é o teste estático novo. Saída em arquivo, lida em comando separado antes do commit |

**Auto-revisão adversarial:**

1. *Algum consumidor dependia de `comissoes`/`salarios_fixos` no `get_net_result`?* Todos no
   repositório — tipos, transformador, tela, PDF e testes — foram atualizados; o transformador tolera a
   RPC antiga (`remuneracao_paga` ausente → 0; `regime` sempre `'caixa'`).
2. *Perdi a paridade do P3-01?* Não. Paridade era "uma fonte canônica por fato". Comissão **devida**
   continua vindo só de `atendimentos.commission_amount` (Profissionais); comissão **paga** vem só de
   `commission_payments` (Financeiro). São fatos diferentes, não duas contas do mesmo fato.
3. *`commission_payments.paid_at`* é `NOT NULL DEFAULT now()` — todo pagamento tem data de caixa.
4. *Efeito nos gráficos?* `get_revenue_report` (por semana/mês) já era caixa; agora a página inteira
   está numa régua só.
5. *O que NÃO mudou, de propósito:* a régua do **Comercial** (mês de fechamento) ainda não existe como
   relatório — o painel atual mede por data de **entrada** (coorte de criação). É a próxima frente,
   fora deste parecer.

---

## 1. Correção do alvo da revisão

O §12 do [`IMPL-LOG-CORRECOES-PACOTE-3.md`](./IMPL-LOG-CORRECOES-PACOTE-3.md) manda confirmar o
checkpoint `553303a`. **Esse roteiro está desatualizado.** Depois dele vieram `734d6cf` (docs) e
**`2793ff4`, que é código financeiro real** — a §4.3 do
[relatório de publicação](./RELATORIO-PUBLICACAO-PREVIEW-PACOTE-3-2026-08-03.md), nascida do smoke
no navegador e **fora** da tabela P3-01..P3-24: `get_net_result` descontava o salário fixo
corretamente, mas o service TypeScript descartava `salarios_fixos` e `remuneracao_total`.

**Portanto:** o escopo é `2793ff4`, com esse conserto dentro dele, e o baseline correto é
**1.113 testes / 231 arquivos** — não os 1.103 do IMPL-LOG, número congelado em `553303a`.

## 2. Estado conferido ao vivo

- `feat/funil-construtor` @ `2793ff4`, sincronizada com o remoto, árvore limpa.
- Ledger local: **71 versões**, de `20251201000000` a `20260803100000`; as 11 do ciclo `20260803*`
  presentes.
- **`scripts/audit-seg.sh` não existe** — procurado na árvore inteira. Ver §6.

---

## 3. FASE 1 — auditoria estática

### 3.1 O que passou

| Item | Verificação | Resultado |
|---|---|---|
| **P3-04** | 8 FKs compostas `(organization_id, id)`; entram `NOT VALID` e recebem `VALIDATE` na mesma execução — dado cruzado faz a migration falhar em vez de ser corrigido em silêncio. | **PASS** |
| **P3-08** | Constraint `commission_rules_percent_consistency_chk` + trigger `sync_commission_rule_amount` + backfill. O resolvedor lê só `amount`. Uma fonte de verdade. | **PASS** |
| **P3-02** | `record_commission_payment` com dois advisory locks, payload divergente = `23505`, overpay = `23514`, REST de escrita revogado. | **PASS** |
| **P3-16** | Resolvedor escolhe a regra por `performed_at`, no dia civil de São Paulo. | **PASS** |
| **P3-07** | `protect_historical_commission_rule` barra `UPDATE`/`DELETE` de regra com `valid_from < hoje`; bypass restrito a `postgres`/`service_role`; fuso restaurado na `0800`. | **PASS** |
| **P3-03** | `professional_compensation_versions` com RLS, escrita revogada de `authenticated`, população só por trigger `SECURITY DEFINER`. | **PASS** |
| **P3-15** | O guard fail-closed está **no próprio helper** (`getSupabaseAdminClient` → `assertTestSupabaseTarget`), não só no runner: recusa o ref de produção pelo nome e exige loopback ou flag explícita com HTTPS em `*.supabase.co`. | **PASS** |
| Gate da RPC | `get_commission_report` manteve `can_access_organization + has_permission('reports.professionals')` — **não caiu na armadilha** registrada no CLAUDE.md. | **PASS** |

### 3.2 Achados novos da leitura

Detalhados com prova na §4. Resumo: **R-01** (relatório mistura competência e caixa dentro do
mesmo JSON) · **R-02** (P3-06 sobrevive no ramo de regra legada) · **R-03** (UI e servidor usam
capacidades diferentes no pagamento) · **R-04** (fallback para o cadastro de hoje) · **R-05** (o
backfill de snapshot roda antes do guard de `fixed`) · **R-06** (`professional_has_specialty` sem
`organization_id`) · **R-07** (`pay_type` de hoje exibido como se fosse do período) · **R-08**
(decisão de produto: o "líquido" mistura regimes).

---

## 4. FASE 2 — execução

### 4.1 A cadeia aplica do zero — **PASS**

Método: banco `p3_verify` criado no mesmo cluster, com a infraestrutura clonada por
`pg_dump --schema-only --exclude-schema=public`, `public` e ledger vazios. **O banco local com o
seed do Junior não foi tocado; não houve `db reset`.**

```
migrations processadas: 71 de 71
RESULTADO: CADEIA COMPLETA APLICOU DO ZERO SEM ERRO
NOTICE: 127   WARNING: 0   ERROR: 0
```

**Desvio declarado:** o `pg_cron` só instala no database `postgres` do cluster, então na **cópia
dentro do container** (nunca no repositório) o `create extension pg_cron` virou comentário e o
schema `cron` recebeu stubs de `schedule`/`unschedule`/`job`. Afeta 2 migrations
(`20260718030000`, `20260720030000`) e é ortogonal ao motor financeiro em revisão.

Isso responde à ressalva do IMPL-LOG §5: o banco local do Codex tinha recebido uma revisão
anterior da `0900`; a cadeia **final** agora está provada do zero.

### 4.2 Reproduções — 11 PASS, 3 achados confirmados

| # | Cenário | Esperado | Obtido | |
|---|---|---|---|---|
| 1 | `fixed`-only com regra de 20% sobre R$ 1.000 | R$ 0,00 | R$ 0,00 | **PASS** |
| 2 | Atendimento 10/04, regra nova em 15/04, pago 20/04 | R$ 100 (regra antiga) | R$ 100,00 | **PASS** |
| 3 | Fixo R$ 3.000 → R$ 6.000 em 16/06 (junho, 30 dias) | R$ 4.500,00 | R$ 4.500,00 | **PASS** |
| 4 | Regra **canônica** de Implante × produto de Ortodontia | R$ 0 (não casa) | R$ 0,00 | **PASS** |
| 5 | **Mesma regra, LEGADA** (só o nome) × produto de Ortodontia | R$ 0 | **R$ 500,00** | 🔴 **R-02** |
| 6 | Vincular colaborador da org A a especialidade da org B | `23503` | `23503` | **PASS** |
| 7 | `authenticated` reescreve regra histórica | recusa | `42501` | **PASS** |
| 8 | `authenticated` apaga regra histórica | recusa | `42501` | **PASS** |
| 9 | `authenticated` apaga especialidade | `42501` | `42501` | **PASS** |
| 10-12 | `authenticated` faz TRUNCATE (3 tabelas) | `42501` | `42501` | **PASS¹** |
| 13 | Atendimento sem colaborador, feito 30/06 e pago 02/07 | mesmo mês | junho=1 por competência, **bloco sem-profissional: junho=0, julho=1** | 🔴 **R-01** |
| 14 | Segundo pagamento com a mesma chave de idempotência | `23505` | `23505` | **PASS** |

¹ *No `p3_verify` o `TRUNCATE` é recusado porque criei o schema `public` do zero, sem os default
privileges do Supabase. **No Supabase real o resultado é outro** — ver §4.3.*

**R-02 quantificado:** a **mesma** regra devolve **R$ 0,00** quando canônica e **R$ 500,00** quando
legada — 50% de comissão indevida sobre um procedimento que não pertence àquela especialidade. No
banco local há **3 regras nesse estado, de 95**. A contagem em produção não foi feita (sem acesso)
e precisa entrar no preflight.

**R-04 provado:** colaborador criado hoje (04/09/2026) como `fixed` ganha versão só a partir de
hoje. `professional_pay_type_at(…, '2024-03-15')` devolve **`fixed`** — o cadastro de hoje decide
um fato de 2024. E há assimetria: o `pay_type` cai no cadastro atual, mas o `fixed_amount` respeita
a vigência e devolve **0**. A mesma pessoa, no mesmo mês de 2024, conta como fixo (comissão zerada)
**e** tem salário zero. Remuneração total zero, quando o correto seria a comissão vigente.

### 4.3 Catálogo real do Postgres — 🔴 R-09

Consultado o catálogo, não os `GRANT` escritos nas migrations (a distinção já produziu dois erros
documentados neste projeto). No **Supabase local real**:

| Tabela | `anon` TRUNCATE | `anon` DELETE/UPDATE | `authenticated` TRUNCATE |
|---|:--:|:--:|:--:|
| `atendimentos` | **sim** | **sim** | sim |
| `commission_rules` | **sim** | **sim** | sim |
| `professionals` | **sim** | **sim** | sim |
| `commission_payments` | **sim** | não | **sim** |
| `professional_compensation_versions` | não | não | **sim** |
| `specialties` | não | não | não ✅ |

Origem: o default privilege do `supabase_admin` concede `arwdDxt` a `anon` em **toda** tabela nova
do `public`. A cadeia de migrations **nunca revoga** `atendimentos`, `commission_rules` nem
`professionals` — confirmado por varredura: zero `REVOKE` para as três em 71 migrations. O P3-24 foi
aplicado apenas às 5 tabelas que o parecer listou.

**Gravidade honesta:** RLS está ativo nas 7 tabelas e **não há uma única policy alcançando `anon`**,
então DELETE/UPDATE via PostgREST são barrados. Mas **`TRUNCATE` não passa por RLS** — o próprio
Codex escreveu isso no comentário da migration `100000` (*"TRUNCATE também precisa sair porque
ignora RLS por definição"*) e aplicou a lição só em `specialties`. A defesa restante é o PostgREST
não expor `TRUNCATE`, que é uma barreira de superfície de API, não de banco.

Impacto se contornada: `TRUNCATE professional_compensation_versions` apaga todo o histórico de
remuneração — a tabela que a migration fechou justamente para impedir que "um administrador fabrique
versões antigas".

### 4.4 Varredura de segurança geral

| Verificação | Resultado |
|---|---|
| Funções `SECURITY DEFINER` sem `search_path` fixo | **0** ✅ |
| Tabelas do `public` sem RLS ativo | **0** ✅ |
| Funções `SECURITY DEFINER` no `public` | 88 |
| …executáveis por `anon` | **28** — 21 por ACL padrão, 7 por grant explícito |

Das 28, a maioria são helpers de RLS (`can_access_organization`, `is_agency_role`,
`current_profile_*`) que dependem de `auth.uid()` e devolvem vazio sem sessão, além de funções de
trigger que não são chamáveis diretamente. **Quatro não são inofensivas** — é a vulnerabilidade do
topo deste documento, corrigida na §0.

**Adjacentes, inspecionadas e NÃO corrigidas (fora do escopo autorizado):**

| Função | Executável por `anon` | O que faz | Gravidade |
|---|:--:|---|---|
| `get_singleton_organization_id()` | sim | devolve o UUID da organização mais antiga a qualquer visitante — em produção, o da clínica | 🟡 média — vazamento de identificador de tenant |
| `log_audit_event(...)` | sim | insere em `audit_logs` com `user_id = null` para quem não tem sessão | 🟡 média — poluição da trilha de auditoria |
| `_api_key_make_token()` | sim | gera string aleatória com prefixo, **não persiste** | 🟢 baixa — só formata bytes aleatórios |
| `_api_key_sha256_hex(text)` | sim | hash puro | 🟢 baixa |

Padrão de correção é o mesmo da §0 (`REVOKE … FROM PUBLIC, anon` + gate onde couber). Cabe num
ciclo curto, junto com a revisão dos outros 21 helpers com ACL padrão.

### 4.5 Suíte completa — **PASS**

`npm run test:local`, saída em arquivo e **lida em comando separado do commit**, como manda a regra:

```
Test Files  231 passed (231)
     Tests  1113 passed (1113)
  Duration  241.18s
```

**Zero falhas.** Confirma o baseline de **1.113 / 231** e refuta em definitivo os 1.103 do IMPL-LOG,
que ficaram congelados em `553303a`. Os ruídos conhecidos apareceram e não derrubaram o gate:
`DELETE deal_notes` 400 no teardown, `ECONNREFUSED` em `localhost:3000` sem dev server, e 401
esperados de testes sem autenticação.

---

## 5. Achados desta revisão — consolidado

| # | Achado | Gravidade | Prova |
|---|---|---|---|
| **V-01** | `mark_deal_won`/`mark_deal_lost`/`reopen_deal`/`cleanup_rate_limits` executáveis por `anon`, sem gate, `SECURITY DEFINER` | 🔴 Crítico, fora do Pacote 3 · **✅ corrigido na branch** (`20260904000000`, §0) · **produção ainda exposta** | HTTP 204 antes → 401/`42501` depois |
| **R-01** | `get_commission_report` mistura competência (linhas) e caixa (bloco `sem_profissional`) | 🔴 Alto · **✅ corrigido** (`20260904010000`, §0b) | Reprodução 13; agora 2 / R$ 700 em junho |
| **R-02** | P3-06 sobrevive em regra legada só com o nome da especialidade | 🔴 Alto | Reprodução 5: R$ 500 vs R$ 0 |
| **R-09** | `anon` mantém escrita e `TRUNCATE` nas tabelas centrais do dinheiro; `TRUNCATE` ignora RLS | 🔴 Alto | Catálogo §4.3 |
| **R-04** | `professional_pay_type_at` usa o cadastro de hoje para decidir o passado, e diverge do `fixed_amount` | 🟡 Médio | Prova §4.2 |
| **R-03** | UI libera "Pagar" com `settings.finance`; servidor exige também `can_configure_organization` | 🟡 Médio | Leitura das 3 camadas |
| **R-05** | Backfill de snapshot (`020000`) roda antes do guard de `fixed` (`090000`) | 🟡 Médio | Ordem das migrations |
| **R-06** | `professional_has_specialty` sem `organization_id`, contra o pedido do P3-04 | 🟡 Baixo | Assinatura inalterada |
| **R-07** | `pay_type` do cadastro atual exibido como dado do período | 🟡 Baixo | SQL + transformador |
| **R-08** | O "líquido" mistura competência e caixa | ✅ **decidido e implementado** — Financeiro = caixa puro (§0b) | `regime = 'caixa'`, integração 10/10 |

### Ressalvas menores confirmadas

1. **`interval '1 month - 1 day'` avalia corretamente** — testado: fev/2026 = 28, jun = 30, ago = 31,
   fev/2028 = 29. O divisor do salário está certo.
2. `professional_compensation_versions` usa `UNIQUE (professional_id, valid_from)` sem
   `organization_id` — contido pela FK composta, mas fora do padrão do pacote.
3. Granularidade diária: duas alterações no mesmo dia sobrescrevem a versão do dia. Confirmado.
4. A proteção histórica só age com `valid_from < hoje`: uma regra criada hoje pode ser reescrita
   hoje, **depois** de já ter congelado snapshots do dia.
5. `fixed_compensation_for_period` é O(dias × colaboradores) com lateral por dia, chamada em ambos
   os relatórios. Não medida sob carga.

---

## 6. Sobre o baseline de segurança

O IMPL-LOG (§9) e o relatório (§5) declaram o baseline agregado **inválido/fail-closed** porque o
runner `audit-seg.sh` estourou 10 minutos. **Esse script não existe neste repositório** — o próprio
parecer original já dizia isso em §11 e propunha criá-lo. Os documentos também citam "gates
G1–G32"; os gates da Cenoura vão até **G25**.

Os scans individuais valem: `npm audit` 0 · Semgrep 0 (**com 2 avisos de parsing parcial** em
`CreateBoardModal.tsx` e `CommissionsManager.test.tsx` — esses dois arquivos não têm cobertura
completa) · Gitleaks 0.

**A pendência 12 da §11 não é tarefa, é decisão:** ou o runner é escrito, ou o baseline passa a ser
a soma declarada dos scans individuais. E vale registrar: **a varredura que produziu V-01 levou
menos de um minuto** — a ausência desse gate custou caro.

---

## 7. Veredito parcial

O **motor financeiro do Pacote 3 está substancialmente correto**. As invariantes de dinheiro que
mais importam foram provadas no banco: pagamento não duplica, comissão respeita a data do
atendimento, `fixed` não recebe comissão, o rateio do salário fecha ao centavo, regra histórica não
é reescrita, e vínculo entre organizações é recusado pelo banco.

**Não aprovo para produção**, por três motivos independentes:

1. **V-01** — **corrigida nesta branch e provada** (§0). Em produção o buraco continua até o
   rollout com preflight — e passa a ser o motivo mais forte para esse rollout andar.
2. **R-02** — defeito de cálculo confirmado com número (a regra legada só com o nome da
   especialidade paga R$ 500 onde a canônica paga R$ 0). **R-01 já foi corrigido** (§0b).
3. **R-09** — `anon`/`authenticated` mantêm `TRUNCATE` (que ignora RLS) nas tabelas centrais do
   dinheiro; e as pendências pré-deploy da §11 do IMPL-LOG continuam válidas. **R-08 foi decidido e
   implementado** (§0b), então deixa de ser motivo.

As pendências pré-deploy da §11 do IMPL-LOG continuam válidas, com duas correções: a de número 12
é decisão, não tarefa; e a de número 4 (snapshots `fixed` legados) tem causa identificada em R-05.

---

*Parecer fechado em 2026-09-04, após fases 1 e 2. A fila só deve ir para REVERIFICADO/APROVADO
depois que V-01, R-01, R-02 e R-09 forem tratados e R-08 for decidido pelo Junior.*
