# Revisão do Claude — Entrega C1A

> Revisor: Claude (Opus 4.8). Data: 2026-07-20. Alvo: `feat/funil-construtor` @ `0731912` (9 commits sobre `5e00a4a`; 26 arquivos, +3.142/−38).
> Método: segurança de produção **primeiro** · leitura dirigida do diff nos pontos de risco · `precheck:fast` **e a bateria de integração local** rodados pelo próprio Claude.

## Veredito: ✅ APROVADO com 1 correção pequena antes da C1B

As 8 tarefas foram entregues como especificadas, produção está intacta, e **o gate do envio real ficou mais forte do que eu pedi**. Encontrei **um problema real que o relatório não pega**: um teste que só passa em banco limpo.

## 1. Produção — verificada antes de tudo

| Checagem | Resultado |
|---|---|
| Migrations | **28**, última ainda `20260716014401` (E2). Nenhuma das 4 da C1A entrou. ✅ |
| Tabelas `automation*` | **0** ✅ |
| `role_permission_defaults` | **210 linhas, 4 colunas** — PK **não** foi alterada em produção ✅ |
| `pg_cron` | não instalado ✅ |
| Constraint com `switch` | ausente ✅ |

## 2. As 8 tarefas

| T | Verificação | Veredito |
|---|---|---|
| **T1** | `test/setup.ts` chama `assertTestSupabaseTarget` e cai para loopback quando não há URL. O ruído de 401 contra produção **sumiu** do meu precheck. | ✅ |
| **T2** | Constraint de outcome virou lista **+ padrão** `case:<uuid>` (L34); `unique (from_step_id,"order")` adicionado (L36-37); **nenhum índice novo para a bijeção** — reusou o `unique (from_step_id, outcome)` existente, como combinado. | ✅ |
| **T3** | `ALLOWED_OUTCOMES.switch` aceita `otherwise` + padrão `case:`; **`condition` não foi relaxado**; issues novas seguem o padrão do compilador. | ✅ |
| **T4** | Invariante de pai único implementado no compilador. | ✅ |
| **T5** | `schemaVersion: 2` na publicação, v1 preservada e legível. | ✅ |
| **T6** | Avaliador real: percorre `cases[]` **ordenado por `(order, caseId)`** (desempate determinístico), primeiro que casa vence, `otherwise` como saída padrão, `case_id` validado por regex, campo restrito a uma lista fechada. Idempotência por job existente + `idempotency_key`. | ✅ |
| **T7** | PK virou `(defaults_version, role, permission_key)`; singleton `permission_defaults_state.active_version`; `has_permission` lê a versão ativa e **retorna `false` se o ponteiro sumir** (fail-closed); v1 **preservada** (nenhum delete/truncate); trava de completude valida v1, v2 e o ponteiro. | ✅ |
| **T8** | Estado agregado singleton; o gate virou **trigger no banco** (`guard_automation_live_enable` em `organization_settings`), disparando só na transição para ligado — **nenhum cliente contorna**. Não toca em `claim_automation_jobs`, então jobs materializados continuam saindo. | ✅ **acima do pedido** |

**Estado no banco local, conferido por mim:** `v1=222 · v2=222 · active_version=2 · clinic_staff.automation.operate=false · clinic_admin.automation.operate=true`. Exatamente a decisão do Junior.

## 3. Verificação independente

**`npm run precheck:fast` na minha máquina:** lint **0**, typecheck **0**, **646 passando / 125 pulados (771), 0 falha** — idêntico ao relatado.

**Bateria de integração local, rodada por mim** (com `E2_SUPABASE_*` apontando para loopback): **31 passando, 1 falhando.** O Codex relatou 36/0.

## 4. 🟡 O achado — teste que só passa em banco limpo (corrigir antes da C1B)

`test/funilTickHealth.local.test.ts` → *"segredo ausente registra falha e contador"* falhou na minha execução:

```
- Expected  "consecutive_failures": 1
+ Received  "consecutive_failures": 2
```

**Causa confirmada experimentalmente:** `automation_tick_health` é uma **linha única que persiste entre execuções**. O teste afirma o valor **absoluto** `consecutive_failures = 1`. Rodei duas vezes e o contador acumulou. Zerei o contador (`update automation_tick_health set consecutive_failures = 0`) e **os 5 testes do arquivo passaram**.

**Portanto o relatório do Codex é verdadeiro** — ele rodou após `supabase db reset`, em estado limpo. **Mas o teste não é reexecutável**, e é justamente o teste do mecanismo criado para impedir que o motor falhe em silêncio.

**Correção pedida (pequena):** zerar/semear o estado de saúde no `beforeEach`, ou asserir **delta** em vez de valor absoluto (`contador aumentou em 1`). Não bloqueia o mérito da C1A; **bloqueia confiar nessa suíte em execuções repetidas**.

## 5. Observações que não bloqueiam

1. **125 pulados (antes 39).** Não é regressão: os testes de integração exigem `E2_SUPABASE_URL/ANON/SERVICE_ROLE` explícitos e são opt-in por desenho. Rodados à mão, passam. Vale considerar um `npm run test:local` que exporte as três variáveis, para essa bateria não depender de alguém lembrar.
2. **Ausência de navegador.** Correto para a C1A, que não tem mudança visual. **A exigência de validação real em navegador continua valendo para a C1C** (gesto, realce, cancelamento, teclado).

## 6. Próximo passo

Liberado para a **C1B — a fatia visível** (R1 árvore · R4 doca · R5 mapa · R6 seletor/gatilho · R7 microcorreções), **depois** da correção do §4.

Lembrete de expectativa: a C1B é a entrega em que o **Junior volta a ver e operar a tela**, e o retorno dele deve ser tratado como parte da entrega — foi assim que apareceram os três defeitos que nenhum teste pegou.

Nada é deployado até o Junior aprovar. `automation_live_enabled` segue `false` — e agora existe uma trava no banco que **recusa** ligá-lo com o motor degradado.
