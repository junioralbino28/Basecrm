# PLAN — C1A (contrato e segurança)

> Escrito por Claude em 2026-07-20, depois da adjudicação em `REVIEW-OPINIAO-C1.md` (parecer do Codex aceito integralmente).
> **Junior aprovou o escopo e o critério de sucesso revisado.**
> Executor: Codex. Revisão: Claude, em `REVIEW-ENTREGA-C1A.md`.

## O que é a C1A

**A fatia invisível.** Contrato do grafo, execução, permissão e saúde do motor. **Nada muda na tela** — a interface é a C1B. Isso é consequência do gap dos N caminhos, não desvio de rota.

**Ordem obrigatória: T1 → T8.** Cada tarefa fecha com `npm run precheck:fast` verde e commit próprio.

**Regras da execução:** TDD (teste vermelho antes) · Supabase **local** · sem push · sem deploy · `automation_live_enabled` segue `false` · ler `AGENTS.md` antes de qualquer comando.

---

## T1 — O6: testes não alcançam produção (primeiro de tudo)

**Por que primeiro:** as tarefas seguintes escrevem dezenas de testes novos. A trava tem que existir antes deles, não depois.

**Arquivos:** `test/setup.ts` (modificar) · `test/helpers/e2Supabase.ts` (referência do padrão que já existe)

Hoje `assertSafeE2SupabaseTarget` (L16-26) recusa o ref `eqidsihasmwwamkaqfka`, **mas só nos testes E2 que o chamam**. O resto da bateria resolve a URL de produção do ambiente e apanha 401 — ruído que aparece em todo precheck desde o E2.

1. Teste vermelho em `test/setupGuard.test.ts`: um helper `assertTestSupabaseTarget(url)` deve lançar quando a URL contém o ref de produção e passar em loopback.
2. Rodar e ver falhar.
3. Implementar o helper (reusar a lógica de `e2Supabase.ts`, não duplicar) e chamá-lo no topo de `test/setup.ts`, com **fallback para loopback** quando `NEXT_PUBLIC_SUPABASE_URL` não estiver definida no ambiente de teste.
4. Rodar `npm run precheck:fast` e confirmar que **os 401 contra produção sumiram** do output.
5. Commit: `test: impede a bateria de resolver o Supabase de producao`.

**Aceite:** nenhum teste resolve o ref de produção; o precheck fica sem os 401.

---

## T2 — Tipo `switch` no schema

**Arquivo novo:** `supabase/migrations/20260720000000_funil_c1a_switch.sql`
**Não editar** nenhuma migration já aplicada.

Contrato decidido (`REVIEW-OPINIAO-C1.md` §3.1):

```
step_type: 'switch'
config: { field, cases: [{ case_id (uuid), label, operator, value, order }], fallback_label }
edges:  outcome = 'case:<case_id>'  |  outcome = 'otherwise'
```

1. Estender `automation_steps_type_known` para incluir `'switch'`.
2. Trocar `automation_step_edges_outcome_known` de lista fixa para **lista + padrão**: os outcomes atuais **ou** `outcome ~ '^case:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`.
3. **Não criar índice novo:** o `unique (from_step_id, outcome)` que já existe (F1 L357) passa a garantir sozinho **uma aresta por caso**.
4. Adicionar `unique (from_step_id, "order")` — hoje não existe, e sem ele o mesmo fluxo desenha diferente para duas pessoas (`REVIEW-OPINIAO-C1.md` §3.5).
5. Teste local em `test/funilSwitchSchema.local.test.ts`: aceita `case:<uuid>`; recusa `case:abc`; recusa duas arestas com o mesmo caso; recusa duas arestas com a mesma ordem no mesmo pai.

**Aceite:** `supabase db reset` aplica limpo; dinamismo confinado ao formato `case:<uuid>`.

---

## T3 — `switch` no compilador

**Arquivos:** `lib/automations/compiler.ts` · `lib/automations/compiler.test.ts`

1. Testes vermelhos, um por regra: IDs de caso únicos · ordem única e determinística · **bijeção casos ↔ arestas `case:<id>`** · exatamente um `otherwise` · nenhuma aresta dinâmica em outro tipo de passo · campo/operador/valor compatíveis · rótulo não vazio e limite de quantidade e tamanho.
2. Implementar: `ALLOWED_OUTCOMES.switch` aceita `otherwise` + o padrão `case:`; os demais tipos continuam com conjunto fechado (**não relaxar `condition`**).
3. Novos códigos de issue, seguindo o padrão existente: `switch_case_duplicate`, `switch_case_edge_mismatch`, `switch_missing_otherwise`, `dynamic_outcome_not_allowed`, `duplicate_edge_order`.
4. Commit: `feat(funil): compilador valida passo switch`.

**Aceite:** um `switch` com 4 casos + `otherwise` compila; qualquer violação acima recusa com issue específica.

---

## T4 — Invariante de árvore (pai único)

**Arquivos:** `lib/automations/compiler.ts` · `compiler.test.ts`

Hoje o compilador exige **uma entrada**, checa órfão e ciclo, mas **não rejeita `indegree > 1`** (verificado: `compiler.ts` L495-535). O builder v1 é **árvore enraizada**.

1. Teste vermelho: grafo onde dois passos apontam para o mesmo destino → issue `multiple_parents`.
2. Implementar a checagem junto das demais validações topológicas.
3. Commit: `feat(funil): builder v1 exige arvore com pai unico`.

**Aceite:** convergência é recusada com mensagem clara.

---

## T5 — `schemaVersion: 2` na publicação

**Arquivos:** `lib/automations/publication.ts` · `lib/automations/compiler.ts` (snapshot canônico) · testes correspondentes

1. Teste vermelho: publicação nova grava `schemaVersion: 2`; versão v1 já existente **continua legível e executável**.
2. Implementar sem reescrever versões antigas — elas são imutáveis por design (o guard já provou isso ao bloquear a limpeza do banco local).
3. Commit: `feat(funil): publica definicao com schemaVersion 2`.

**Aceite:** v1 e v2 convivem; o executor lê as duas.

---

## T6 — Executor N-ário (o bloqueante)

**Arquivo novo:** `supabase/migrations/20260720010000_funil_c1a_switch_exec.sql`

Hoje `advance_automation_enrollment` (F4 L426+) **só faz lookup**: recebe o outcome pronto e procura a aresta. **Ninguém calcula qual caso venceu.** Sem isto, publicar um `switch` cria um passo que o motor não sabe executar.

1. Testes vermelhos em `test/funilSwitchExec.local.test.ts`:
   - primeiro caso que casa vence (ordem define precedência);
   - nenhum caso casou → segue por `otherwise`;
   - contato com **múltiplas etiquetas** → vence o de menor `order` (regra decidida no parecer §8.5);
   - reprocessar o mesmo passo **não duplica efeito**.
2. Implementar a avaliação lendo `cases[]` da definição publicada e produzindo o outcome `case:<id>`, que o `advance_automation_enrollment` existente então resolve. **Não duplicar a lógica de transição** — só produzir o outcome.
3. Commit: `feat(funil): motor avalia passo switch`.

**Aceite:** um fluxo com 4 caminhos executa em simulação e **o registro mostra qual ramo rodou**.

---

## T7 — O1: permissão com snapshot v2 e ponteiro ativo

**Arquivo novo:** `supabase/migrations/20260720020000_e3_role_defaults_v2.sql`
**Também:** `lib/auth/permissions.ts` · `scripts/generate-e2-role-permission-defaults.mjs` · testes de permissão

A E2 documentou isto na L14-15: *"A troca por snapshots paralelos + ponteiro ativo fica deliberadamente para a primeira mudança de defaults."* **Esta é essa mudança.** Confirmado que hoje v1 e v2 não coexistem (`primary key (role, permission_key)`, sem `defaults_version`) e que `has_permission` fixa `defaults_version = 1` (L336).

1. Teste vermelho: `clinic_staff` e `vendedor` **não** têm `automation.operate`; `clinic_admin`, `agency_admin` e `agency_staff` têm; override individual **continua** liberando.
2. Migration, tudo na mesma transação: PK passa a incluir `defaults_version` · tabela singleton com `active_version` · inserir snapshot **v2 completo** gerado de `permissions.ts` · `has_permission` passa a ler a versão ativa · ativar v2 · **v1 preservada**.
3. `lib/auth/permissions.ts`: incluir `automation.operate` em `CLINIC_STAFF_DENIED`.
4. Regenerar o snapshot pelo script e atualizar a trava de completude para validar **v1 e v2 e o ponteiro ativo**.
5. **Gate no endpoint, não só no menu:** confirmar que as rotas de automação exigem a permissão (a rota de listagem hoje pede `automation.operate` — ver `app/api/platform/tenants/[tenantId]/automations/route.ts`). Esconder o menu não é enforcement.
6. Commit: `feat(auth): defaults v2 com ponteiro ativo e automation.operate restrita`.

**Aceite:** secretária não vê o menu **e** recebe 403 no endpoint; admin com override manual passa a ver.

---

## T8 — O2: saúde do tick e gate do envio real

**Arquivo novo:** `supabase/migrations/20260720030000_funil_c1a_tick_health.sql`

`request_automation_tick()` engole exceção e retorna `null` (F4 L48-49). Hoje o motor pode parar **sem sinal nenhum** — o pior modo de falha do piloto.

1. Testes vermelhos: segredo ausente · exceção no post · requisição emitida e não recebida · sucesso · **recuperação zera o contador**.
2. Estado **agregado singleton** (uma linha, crescimento zero): `last_requested_at` · `last_request_id` · `last_received_at` · `last_succeeded_at` · `last_http_status` · `consecutive_failures` · `last_error` · `updated_at`.
3. `request_automation_tick()` registra a tentativa **antes** do `net.http_post`; segredo ausente e exceção **atualizam erro e contador** em vez de sumirem.
4. O endpoint do tick marca recebimento e conclusão, incluindo quantos jobs materializou.
5. `automation_scheduler_health()` passa a distinguir **agendado · requisição emitida · endpoint recebeu · tick concluiu**, e deriva **degradado** quando nada é concluído em dois intervalos.
6. **Gate:** a ação que habilitar `automation_live_enabled` exige tick saudável; recusa com a causa quando degradado. **Não bloquear o consumo de jobs já materializados** — se o cron cair, o dispatcher continua esvaziando a fila.
7. Commit: `feat(funil): saude do tick e gate para habilitar envio real`.

**Aceite:** derrubar o tick de propósito deixa a saúde degradada e **recusa** habilitar o envio real, com motivo legível.

---

## Fechamento da C1A

- `npm run precheck:fast` verde.
- `IMPL-LOG-C1A.md` com: o que foi feito, commits, desvios, e **o que ficou impossível de verificar sem navegador**.
- **Não** prosseguir para a C1B sem a revisão do Claude (`REVIEW-ENTREGA-C1A.md`).

**Critério de sucesso da C1 (o alvo final, atingido só na C1C):** o Junior monta um fluxo com 4 caminhos por serviço, move um passo de um ramo para outro, publica, e **o teste simulado atravessa a decisão comprovando qual ramo rodou** — não apenas a primeira mensagem. A secretária, com o cargo dela, não vê o menu Automações.
