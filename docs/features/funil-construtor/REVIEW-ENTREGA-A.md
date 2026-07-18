# Revisão do Claude — Entrega A (F0 → F3)

> Revisor: Claude (Opus 4.8). Data: 2026-07-18. Alvo: `feat/funil-construtor` @ `f480a04` (5 commits sobre `e282977`; 27 arquivos, +5.056/−211).
> Método: verificação da segurança de produção **primeiro**, leitura dirigida do diff nos pontos de risco, e **`precheck:fast` rodado pelo próprio Claude**.

## Veredito: ✅ APROVADO — pode seguir para a Entrega B

Entrega sólida. As 3 correções em código de produção estão **corretamente implementadas e verificadas**, a fundação do motor respeita os invariantes do ADR, e **produção não foi tocada**.

## 1. Segurança de produção — verificada ANTES de qualquer outra coisa

O Codex declarou (transparência dele): *"o primeiro precheck herdou variáveis da .env e tentou leituras remotas, recusadas com HTTP 401; não houve leitura efetiva nem mutação."* **Verifiquei no banco da clínica (`eqidsihasmwwamkaqfka`):**

| Checagem | Resultado |
|---|---|
| Migrations aplicadas | **28**, a última ainda é `e2_server_permission_enforcement` (20260716014401). **Nenhuma das 3 migrations do funil entrou.** ✅ |
| Tabelas `automation*` / `media_*` / `message_template*` | **`[]` — nenhuma existe** ✅ |
| Colunas novas em `conversation_messages` (`provider_message_id`, `idempotency_key`, `delivery_status`) | **`[]` — nenhuma existe** ✅ |
| Total de tabelas em `public` | 56 (inalterado) ✅ |
| `.env` no diff | nenhum ✅ |

**Conclusão: a declaração dele é verdadeira. Os 401 foram recusas; não houve leitura efetiva nem escrita.** Vale registrar que esses mesmos 401 aparecem nos meus prechecks do E2 e do multi-número — é **ruído pré-existente**, não introduzido nesta entrega (ver §5).

## 2. As 3 correções em código de produção — todas confirmadas

| Correção | Verificação do Claude | Veredito |
|---|---|---|
| **Persistir ANTES de enviar** (o furo que eu confirmei em `REVIEW-OPINIAO.md` §1) | `lib/conversations/dispatchConversationOutbound.ts`: `.insert({... delivery_status:'pending'})` (L156/167) → **só então** `await dependencies.deliver(credentials)` (L101) → `.update({delivery_status: outcome.status})` (L217-219). Na rota, as chamadas de envio (L219/244) estão **dentro do closure `deliver`**, passado ao serviço na L265; o `.insert` da L296 é só o caminho que não passa pelo dispatch (inbound). **A ordem está correta — o grep engana, o fluxo não.** | ✅ **CORRIGIDO** |
| **Timeout ambíguo não faz retry cego** | `isUnknownDelivery(error) ? 'unknown' : 'failed'` (L104); estado `unknown` existe no tipo (L7). | ✅ |
| **Dedupe de webhook por índice único** | Migration F3: `add column provider_message_id text` (L97) + `create unique index uq_conversation_messages_provider_id on conversation_messages(channel_connection_id, provider_message_id)` (L116-117) + `uq_conversation_messages_idempotency` (L113). No handler: captura `error.code === '23505'` e resolve como duplicata (L875-887). **Coluna real, não caminho JSONB; a garantia é a constraint, não o SELECT.** | ✅ **CORRIGIDO** |

## 3. Risco de regressão no E2 (que está protegendo a clínica) — sem regressão

- **Transição do snapshot 210 → 222:** a F1 re-insere o snapshot completo com `on conflict do update` (+12 linhas = 2 permissões novas × 6 cargos) e atualiza a trava de completude para **222 linhas / 37 permissões / 6 cargos**, mantendo `defaults_version = 1`. Aplicada em prod (que tem 210), adiciona as 12 e reconfirma as 210. ✅
- **A migration do E2 mantém seu snapshot histórico de 210/35 intacto** — correto, ela **já rodou em produção** e não deve ser reescrita. ✅
- **O gerador passou a apontar para a migration F1** (`generate-e2-role-permission-defaults.mjs`) — correto pelo mesmo motivo: reescrever a migration aplicada seria adulterar história. ✅
- **O teste anti-drift** agora lê o snapshot da F1 (a vigente) e mantém as verificações de função/policies/RPCs ancoradas na E2. Continua sendo uma trava real. ✅
- **Permissões novas:** `automation.edit` (negada a `clinic_staff`) e `automation.operate` (permitida) — implementa a decisão travada "editar ≠ operar": a secretária opera, o gestor edita. ✅

## 4. F0 — o ADR

`ADR-MOTOR.md` cobre o que a F0 exigia: máquinas de estado das 4 entidades (automação, inscrição, job/outbox, espera) · versionamento e publicação · grafo · idempotência e semântica de entrega · safe mode · multi-tenancy e autorização · invariantes consolidados · **3 opções consideradas com justificativa da escolha** · consequências · **rollback operacional**.

**Decisão do boundary:** dispatch na **mesma VPS do worker de mídia, em processo e fila separados**; o tick da aplicação **só materializa e reconcilia jobs, nunca chama provider**. É a alternativa que eu havia levantado, com um refinamento melhor que o meu (separar por processo/fila em vez de só "mesmo worker"). Justificativa registrada: evita duas infraestruturas de background e tira o envio do limite de duração de função do plano Hobby. **Concordo.**

## 5. Observação (não bloqueia) — higiene de teste

Os `401` contra `eqidsihasmwwamkaqfka` aparecem em **todos** os prechecks (E2, multi-número e este). São tentativas de leitura sem auth, recusadas — não houve mutação, e o guard `assertSafeE2SupabaseTarget` cobre os testes E2. Mesmo assim, **teste não deveria sequer resolver a URL de produção**. Sugestão para uma fase futura: forçar `SUPABASE_URL` de teste para loopback por padrão no setup do Vitest, e falhar ruidosamente se a URL contiver o ref de produção. **Item de higiene, não de correção.**

## 6. Verificação independente

`npm run precheck:fast` **na minha máquina**: lint **0**, typecheck **0**, **687 testes passando / 29 skip (716 total), 0 falha**, 151 arquivos passando / 4 skip.

O Codex relatou 716/716 porque rodou **com o Supabase local no ar** (os 29 testes `*.local.test.ts` executaram); sem o banco local eles pulam. **Total idêntico (716), zero falha nos dois.** Mesmo padrão do multi-número.

## 7. Próximo passo

Liberado para a **Entrega B (F4–F6)**: scheduler (`pg_cron` + `pg_net`, claim/lease/retry/reconciliação + testes de corrida) · `wait_for_event` + inbox idempotente + resposta×timeout + takeover · **builder manual + biblioteca de mensagens + publish/test**.

**É a entrega em que o Junior finalmente vê e opera a tela** — vale pedir ao Codex que trate a F6 como o marco demonstrável, não só "CRUD".

Nada é deployado até o Junior aprovar. Safe mode segue obrigatório; `automation_live_enabled` = `false`.
