# REVERIFICAÇÃO INDEPENDENTE — Correções do Pacote 3

**Revisor:** Claude (independente do Codex, que implementou)
**Data de início:** 2026-09-04
**Branch:** `feat/funil-construtor`
**Checkpoint revisado:** **`2793ff4`** — não `553303a`
**Estado deste parecer:** 🟡 **EM ANDAMENTO — fase 1 de 2 concluída**

> **Fase 1 (concluída):** auditoria estática de migrations, RPCs, ACLs e código.
> **Fase 2 (pendente):** cadeia aplicada do zero em banco descartável, suíte completa,
> reprodução dos 8 cenários e inspeção do catálogo real do Postgres.
>
> **Este documento ainda NÃO autoriza produção.** Nenhuma linha de código foi alterada
> nesta revisão. Não houve acesso a produção, push, deploy, merge nem `db reset`.

---

## 1. Correção do alvo da revisão

O §12 do [`IMPL-LOG-CORRECOES-PACOTE-3.md`](./IMPL-LOG-CORRECOES-PACOTE-3.md) manda confirmar o
checkpoint `553303a`. **Esse roteiro está desatualizado.** Depois dele vieram dois commits:

| Commit | Conteúdo |
|---|---|
| `734d6cf` | Documentação (o próprio IMPL-LOG). |
| **`2793ff4`** | **Código financeiro real**, nascido do smoke no navegador e **fora** da tabela P3-01..P3-24. |

O `2793ff4` é a §4.3 do [relatório de publicação](./RELATORIO-PUBLICACAO-PREVIEW-PACOTE-3-2026-08-03.md):
`get_net_result` calculava e descontava o salário fixo corretamente, mas o service TypeScript
descartava `salarios_fixos` e `remuneracao_total`; a tela mostrava líquido negativo sem a dedução
que o explicava e o PDF recalculava por conta própria, podendo discordar da tela.

**Consequências para esta revisão:**

1. O escopo é `2793ff4`, com o conserto do smoke **dentro** dele — esse código nunca passou por
   revisão adversarial de ninguém.
2. O baseline correto é **1.113 testes / 231 arquivos** (relatório de 10/08), não os **1.103** do
   IMPL-LOG — número congelado em `553303a`.

## 2. Estado do repositório conferido ao vivo

- `feat/funil-construtor` @ `2793ff4`, **em sincronia com o remoto** (0 commits de diferença).
- Árvore com um único arquivo não commitado: as seções de 10/08 do relatório de publicação
  (+214/−10, documentação, zero código).
- `docs/REVIEW-CORRECOES-PACOTE-3.md` (este arquivo) não existia até agora.
- **`scripts/audit-seg.sh` não existe no repositório** — procurado na árvore inteira. Ver §5.

---

## 3. FASE 1 — Auditoria estática

### 3.1 O que passou

| Item | Verificação | Resultado |
|---|---|---|
| **P3-04** vínculos cross-org | 6 FKs compostas `(organization_id, id)` em `professional_specialties`, `specialty_products` e `professional_product_overrides`, mais 2 em `commission_rules`. Entram `NOT VALID` e recebem `VALIDATE` **na mesma execução** — dado cruzado preexistente faz a migration falhar em vez de ser corrigido em silêncio. | **PASS** |
| **P3-24** ACL larga | `REVOKE ALL ON TABLE … FROM PUBLIC, anon` nas 5 tabelas, seguido de grants explícitos mínimos. Fecha o `REFERENCES`/`TRIGGER`/`TRUNCATE` herdado. | **PASS (a confirmar no catálogo)** |
| **P3-08** duas verdades `amount`×`percent` | Constraint `commission_rules_percent_consistency_chk`: `(percent AND amount = percent) OR (fixed AND percent = 0)`, com trigger `sync_commission_rule_amount` e backfill dos divergentes. O resolvedor lê **só `amount`**. Uma fonte, de verdade. | **PASS** |
| **P3-02** pagamento duplicável | `record_commission_payment` com dois advisory locks (chave e saldo), retry idêntico devolve a mesma linha, payload divergente na mesma chave = `23505`, overpay = `23514`, e `INSERT/UPDATE/DELETE` REST revogados de `authenticated`. Correções de data e undo passam por RPCs próprias. | **PASS** |
| **P3-16** qual data manda | `resolve_commission_amount` escolhe a regra por `p_performed_at`, com dia civil de `America/Sao_Paulo`. Bate com a decisão do Junior de 29/07. | **PASS** |
| **P3-07** histórico imutável | `protect_historical_commission_rule` barra `UPDATE` de campos de domínio e `DELETE` quando `valid_from < hoje`, com bypass restrito a `postgres`/`service_role`. O fuso foi restaurado na `0800`. | **PASS (com ressalva §3.3.4)** |
| **P3-03** fixo/híbrido | `professional_compensation_versions` com RLS, `INSERT/UPDATE/DELETE` revogados de `authenticated` e população exclusiva por trigger `SECURITY DEFINER`. Cliente não fabrica versão antiga. `fixed_compensation_for_period` rateia por dias do mês. | **PASS (com ressalva §3.3.3)** |
| Gate da RPC principal | `get_commission_report` manteve `can_access_organization(v_org) AND has_permission('reports.professionals')`. **Não caiu na armadilha** registrada no CLAUDE.md (trocar por `can_configure_organization` negaria 42501 a `clinic_staff` com a permissão liberada). | **PASS** |
| Superfície das funções | `resolve_commission_amount`, `professional_pay_type_at`, `fixed_compensation_for_period`, `snapshot_atendimento_commission` e `version_professional_compensation` são `SECURITY DEFINER` + `search_path = ''` + `REVOKE … FROM PUBLIC, anon, authenticated` + `GRANT … TO service_role`. Cliente não executa nenhuma delas direto. | **PASS** |
| Snapshot não aceita entrada do cliente | `snapshot_atendimento_commission` recalcula em `INSERT` e em mudança relevante; caso contrário força `NEW.commission_amount := OLD.commission_amount`. Não há caminho para injetar comissão pelo REST. | **PASS** |

### 3.2 Achados novos — não constam em nenhum documento anterior

#### 🔴 R-01 — `get_commission_report` mistura dois regimes dentro do MESMO relatório

As linhas por colaborador filtram por competência:

```sql
LEFT JOIN public.atendimentos a
  ON … AND a.performed_at >= p_start AND a.performed_at <= p_end
```

Mas o bloco `sem_profissional`, no mesmo `json_build_object`, filtra por caixa:

```sql
'sem_profissional', (SELECT … FROM public.atendimentos sp
  WHERE … AND sp.recebido = true AND sp.paid_at >= p_start AND sp.paid_at <= p_end)
```

**Falha concreta:** um atendimento sem colaborador realizado em 30/06 e pago em 02/07 entra no bloco
"sem profissional" de **julho**, enquanto todos os atendimentos com colaborador do mesmo dia entram
em **junho**. Somar `faturamento_base` das linhas com `sem_profissional.faturamento` não reproduz o
faturamento de nenhum dos dois regimes. Além disso, o `recebido = true` exigido só nesse bloco é
justamente o filtro que a decisão de 29/07 mandou tirar do caminho da comissão por causa do
parcelamento clínica.

**Confiança:** alta — `[Behavior observed]` na leitura do SQL; efeito numérico a confirmar na fase 2.

#### 🔴 R-02 — P3-06 sobrevive no ramo de regra legada por nome

O resolvedor só confere `specialty_products` quando a regra tem `specialty_id`:

```sql
OR (
  c.specialty_id IS NOT NULL
  AND EXISTS (… professional_specialties …)
  AND (p_product_id IS NULL OR EXISTS (… specialty_products …))   -- ✅ confere o procedimento
)
OR (
  c.specialty_id IS NULL
  AND c.specialty IS NOT NULL
  AND public.professional_has_specialty(p_professional_id, c.specialty)   -- ❌ NÃO confere
)
```

O segundo ramo é exatamente o bug original do P3-06: casa a regra pela especialidade da **pessoa**,
sem verificar se o procedimento pertence àquela especialidade. O `canonicalize_commission_rule_refs`
preenche `specialty_id` em toda escrita nova, e o backfill da `020000` preencheu por nome — mas
**toda regra cujo nome não bateu continua caindo no ramo vulnerável.**

O IMPL-LOG classifica P3-06 como "caso original corrigido; borda adjudicável", descrevendo a borda
como "produto em várias especialidades". **Esta é uma borda diferente e não está registrada.**

**Confiança:** alta — `[Inferred]` do SQL. Quantas regras estão nesse estado é pergunta da fase 2.

#### 🟡 R-03 — P3-13 fechado pela metade: a UI e o servidor não usam a mesma capacidade

- Tela: `const canManageFinance = useHasPermission('settings.finance') === true;`
  ([ProfessionalsReportPage.tsx:66](../features/reports/ProfessionalsReportPage.tsx#L66))
- Servidor: `record_commission_payment` exige `can_configure_organization(org)` **E**
  `has_permission('settings.finance')`.
- `can_configure_organization` = `is_agency_admin_role()` **ou** papel `clinic_admin`.
  **`clinic_staff` nunca passa**, mesmo com `settings.finance` explicitamente liberado.

**Falha concreta:** um `clinic_staff` com o override de Financeiro liberado vê o botão "Pagar" e
recebe `42501` ao clicar. É literalmente o sintoma que o P3-13 descreveu ("staff vê ações que o
servidor rejeita"). O comentário na linha 430 do arquivo mostra que a assimetria foi consciente,
mas a correção obrigatória do parecer pedia **a mesma capacidade em UI, rota e RLS/RPC**.

**Confiança:** alta — `[Behavior observed]` na leitura das três camadas.

#### 🟡 R-04 — `professional_pay_type_at` cai no cadastro ATUAL como fallback silencioso

```sql
SELECT coalesce(
  (SELECT cv.pay_type FROM professional_compensation_versions … valid_from <= data …),
  (SELECT p.pay_type FROM professionals p WHERE …),   -- ← estado de HOJE
  'commission'
);
```

É o mesmo raciocínio que o Codex **removeu** da primeira versão da `0900` por ser inseguro: o
cadastro de hoje não prova o contrato vigente no passado. O backfill cobre quem existia em 03/08
(`valid_from = 1900-01-01`), mas um colaborador criado depois recebe versão com `valid_from = hoje`;
um atendimento lançado com `performed_at` **anterior** a essa data não encontra versão e usa o
`pay_type` atual. A justificativa correta foi escrita no comentário da `0900` e depois contrariada
pelo próprio fallback.

**Confiança:** média-alta — `[Inferred]`; alcançabilidade a provar na fase 2.

#### 🟡 R-05 — o backfill de snapshot rodou ANTES do guard de `fixed`

A `020000` popula `atendimentos.commission_amount` chamando `resolve_commission_amount`, que naquele
momento **ainda não tinha** o guard de `pay_type = 'fixed'` — ele só nasce na `090000`. Logo, todo
atendimento histórico de colaborador somente-fixo recebeu comissão no snapshot.

O IMPL-LOG registra a auditoria desses snapshots como pendência 4 da §11, mas não explica que a
causa é a **ordem das próprias migrations**. Quem for reaplicar a cadeia do zero em produção vai
reproduzir exatamente o mesmo estado.

**Confiança:** alta — `[Inferred]` da ordem das migrations; contagem real na fase 2.

#### 🟡 R-06 — `professional_has_specialty` continua sem `organization_id`

A correção obrigatória do P3-04 pedia "`organization_id` explícita em helpers". A assinatura
`professional_has_specialty(uuid, text)` **não mudou** — a `20260803000000` só ajustou o grant.
A função busca `professional_specialties` e `professionals` filtrando apenas por `professional_id`.

Na prática o risco está contido: o `p_professional_id` chega já filtrado por organização e as FKs
compostas novas impedem vínculo cross-org. **Não há exploração demonstrável** — mas o padrão pedido
não foi atendido, e é o tipo de dívida que reabre quando alguém reusar o helper em outro contexto.

**Confiança:** alta — `[Behavior observed]` na assinatura; sem prova de exploração.

#### 🟡 R-07 — `pay_type` exibido é o do cadastro atual, não o vigente no período

`get_commission_report` faz `GROUP BY … p.pay_type` e devolve `'pay_type', l.pay_type` — o valor de
**hoje**. Um colaborador que era `commission` em junho e virou `fixed` em agosto aparece como `fixed`
no relatório de junho. O relatório de 10/08 afirma que "a modalidade atual não é mostrada como se
fosse um dado histórico do período", mas o campo continua sendo emitido e consumido pela tela
(`payType: r.pay_type ?? 'commission'`). A afirmação e o código discordam.

**Confiança:** alta — `[Behavior observed]` no SQL e no transformador.

#### 🟡 R-08 — o "líquido" mistura competência e caixa (decisão de produto, não defeito)

```
comissões  → por performed_at   (competência)
salários   → por dias do período (competência)
faturamento→ por paid_at + recebido = true (caixa)
```

Cada metade está correta isoladamente e segue a decisão do Junior de 29/07. Mas o número chamado
**"líquido"** subtrai despesa por competência de receita por caixa. Com o parcelamento clínica em
10x, o mês do atendimento carrega **100% da comissão** e **10% da receita** — líquido negativo
estrutural, todo mês, sem nada estar errado.

O Junior pediu "bruto, líquido e margem **precisos**". Um líquido que mistura dois regimes não é
impreciso por bug: é ambíguo por definição. **Isso é decisão de produto, não conserto de código** —
e precisa ser tomada antes de a clínica olhar esse número para decidir qualquer coisa.

**Confiança:** alta — `[Inferred]` da leitura; magnitude a medir na fase 2.

### 3.3 Ressalvas menores

1. **`interval '1 month - 1 day'`** aparece como divisor do rateio de salário
   (`fixed_compensation_for_period`) e como fim de competência (`record_commission_payment`). O
   relatório de 10/08 sugere que avalia corretamente (R$ 258,06 = 5.000/31 + 3.000/31 em agosto),
   mas isso precisa ser provado no banco, não inferido — é o divisor de todo salário do produto.
2. **`professional_compensation_versions`** tem `UNIQUE (professional_id, valid_from)` sem
   `organization_id`, fora do padrão composto adotado no resto do pacote. Contido pela FK composta;
   inconsistência de padrão.
3. **Granularidade diária da remuneração:** duas alterações no mesmo dia sobrescrevem a versão do dia
   (`ON CONFLICT … DO UPDATE`). Já registrado como pendência 8 da §11 — confirmado no código.
4. **Janela do dia corrente na regra histórica:** a proteção só age com `valid_from < hoje`. Uma
   regra criada hoje pode ser reescrita hoje mesmo, **depois** de já ter congelado snapshots em
   atendimentos do dia. Resultado: atendimentos anteriores mantêm o valor antigo e os seguintes usam
   o novo, para a "mesma" regra. Não é bug de implementação; é uma janela não documentada.
5. **Custo do rateio:** `fixed_compensation_for_period` é `O(dias × colaboradores)` com subconsulta
   lateral por dia, e é chamada uma vez por colaborador em `get_commission_report` e novamente em
   `get_net_result`. Um ano × 20 colaboradores = 7.300 iterações por chamada. Não medido.

---

## 4. FASE 2 — o que falta (bloqueia o veredito)

Nada abaixo foi executado ainda. Sem isso não existe parecer, só leitura.

1. Aplicar a **cadeia completa das 71 migrations do zero** em banco descartável — sem `db reset` no
   banco local com seed. O IMPL-LOG avisa que o banco local do Codex recebeu uma revisão anterior da
   `0900`, que continha o `UPDATE` retroativo depois removido: **o banco atual não prova a cadeia
   final.**
2. **Inspecionar o catálogo real do Postgres** (`information_schema.role_table_grants`,
   `pg_proc.proacl`) — não os `GRANT` escritos na migration. Essa distinção já produziu dois erros
   documentados neste projeto.
3. Rodar `npm run test:local`, salvar a saída em arquivo e **ler o resultado em comando separado**;
   confirmar 1.113/231.
4. Reproduzir os 8 cenários: pagamento idempotente (retry e payload divergente) · corrida e overpay ·
   `fixed`-only · mudança de fixo no meio do mês · `performed_at` cruzando vigência · cross-org ·
   hard delete de especialidade · e **R-01/R-02 acima**.
5. Contar quantas `commission_rules` estão sem `specialty_id`/`product_id` (dimensiona R-02) e
   quantos snapshots de colaborador `fixed` têm comissão > 0 (dimensiona R-05).
6. Revisar as ressalvas herdadas P3-05, P3-06, P3-07, P3-10, P3-11, P3-17 e P3-18.

## 5. Sobre o baseline de segurança

O IMPL-LOG (§9) e o relatório (§5) declaram o baseline agregado **inválido/fail-closed** porque o
runner canônico `audit-seg.sh` estourou 10 minutos. **Esse script não existe neste repositório** —
procurado na árvore inteira. O próprio parecer original já dizia isso, em §11: *"Este repositório não
possui `scripts/audit-seg.sh`, `status.json` ou equivalente fail-closed"*, e propunha criá-lo.

Os dois documentos também citam "gates G1–G32"; os gates da Cenoura vão até **G25**.

Os scans individuais foram executados de verdade e valem: `npm audit` 0 vulnerabilidades · Semgrep 0
achados (**com 2 avisos de parsing parcial** em `CreateBoardModal.tsx` e `CommissionsManager.test.tsx`
— esses dois arquivos não têm cobertura completa) · Gitleaks 0 vazamentos.

**Portanto a pendência 12 da §11 não é tarefa, é decisão:** não se "conclui" um script que não está
versionado. Ou ele é escrito (ciclo próprio, como o parecer propôs), ou o baseline passa a ser a
soma declarada dos scans individuais — com o parsing parcial do Semgrep dito em voz alta.

---

*Fase 1 encerrada em 2026-09-04. Este parecer continua na fase 2 e não deve ser citado como
aprovação até lá.*
