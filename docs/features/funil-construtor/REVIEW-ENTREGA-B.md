# Revisão do Claude — Entrega B (F4 → F6)

> Revisor: Claude (Opus 4.8). Data: 2026-07-18. Alvo: `feat/funil-construtor` @ `df90d1a` (5 commits sobre `4b7e93d`; 36 arquivos, +4.884/−17).
> Método: segurança de produção **primeiro**, leitura dirigida do diff nos pontos de risco (autorização dos endpoints internos, corrida do claim/lease, corrida resposta×timeout, pausa no takeover, DDL destrutivo), e **`precheck:fast` rodado pelo próprio Claude**.

## Veredito: ✅ APROVADO — pode seguir para a Entrega C

A entrega mais arriscada até aqui (concorrência real + primeira tela operável) e as garantias estão nos lugares certos: no **banco**, não na aplicação. Produção segue intacta.

## 1. Segurança de produção — verificada ANTES de qualquer outra coisa

Consulta ao banco da clínica (`eqidsihasmwwamkaqfka`):

| Checagem | Resultado |
|---|---|
| Migrations aplicadas | **28**, a última ainda é `20260716014401` (E2). Nenhuma das 3 migrations da Entrega B entrou. ✅ |
| Tabelas `automation*` / `media_*` / `message_template*` | **0** ✅ |
| Colunas novas em `conversation_messages` | **0** ✅ |
| Total de tabelas em `public` | 56 (inalterado) ✅ |
| `pg_cron` | **NÃO instalado** — o agendador não foi criado em prod ✅ |
| `role_permission_defaults` | **210** (snapshot do E2, intocado) ✅ |

**Nada da Entrega B chegou perto do banco da clínica.**

## 2. Endpoints internos novos — o maior risco do diff, e está fechado

Três rotas novas em `app/api/internal/automations/` (`tick`, `jobs/claim`, `jobs/[jobId]/complete`). Um endpoint interno sem autenticação seria um furo grave. Verificado:

- `lib/automations/internalAuth.ts`: **fail-closed** (segredo ausente/vazio → `false`), comparação **timing-safe** com checagem de comprimento antes do `timingSafeEqual` (evita o throw).
- Nas 3 rotas o gate é a **primeira instrução**, e o `createStaticAdminClient()` só é criado **depois** da autorização.
- Payloads com Zod `.strict()`, `jobId` validado como uuid, `attemptCount` funcionando como fencing token.
- `tick` e worker usam **segredos distintos** (`AUTOMATION_TICK_SECRET` × `AUTOMATION_WORKER_SECRET`).

O segredo do cron **não está na migration**: `request_automation_tick()` lê de `vault.decrypted_secrets`, retorna `null` se URL ou segredo não estiverem configurados, e a função tem `revoke` de `public`/`anon`/`authenticated`. Agendamento idempotente (`unschedule` antes de `schedule`). ✅

## 3. Concorrência — as três garantias verificadas uma a uma

| Garantia | Verificação | Veredito |
|---|---|---|
| **Claim sem duplicar** | `claim_automation_jobs`: `for update skip locked` + `limit`, lease com prazo, `attempt_count + 1` a cada claim. Ao retomar lease expirado, marca a tentativa órfã como `lease_expired` antes de reclamar. `grant execute` **somente a `service_role`**. | ✅ |
| **Worker zumbi não conclui** | `complete_automation_job` exige `status='leased'` **E** `lease_owner = p_worker_id` **E** `attempt_count = p_attempt_count`, senão `55000` (rota devolve 409). Backoff exponencial com teto de 300s, 5 tentativas → `dead_letter`. `unknown` **não avança** a inscrição. | ✅ |
| **Resposta × timeout** | Um único `UPDATE ... WHERE status='pending' RETURNING` decide os dois caminhos (resposta e expiração). O perdedor recebe zero linhas e cai em `unmatched`. `opened_at <= v_message_created_at` impede casar espera aberta depois da mensagem. Correlação por quote com fallback determinístico por conversa. | ✅ |

## 4. Pausa no takeover — a proteção está no último ponto possível

Era o ponto que eu mais queria verificar: `claim_automation_jobs` **não** filtra por estado da inscrição, então um job já materializado poderia disparar depois de a secretária assumir. **Não dispara** — o RPC de dispatch revalida `enrollment.status <> 'active'` no momento do envio (F4 L664), com o job travado `for update` na mesma transação. Materialização também só ocorre para inscrição `active` (L213).

Fiação na aplicação, em 3 pontos, **todos falhando alto** (500/throw, nada engolido):
- mensagem manual `outbound`/`internal` — e a pausa vem **antes** do insert, sem janela de corrida;
- `PATCH` do thread para `human_queue`/`human_active`;
- handoff da IA (`aiReply`).

`pause_automation_enrollments_for_thread` valida que o ator pertence ao tenant e preserva `paused_from_status` para retomada. ✅

## 5. Safe mode — imposto pelo banco, não por config

- Dispatch recusa qualquer coisa que não seja `simulation` (`42501`, F4 L673).
- O save do builder **força** `delivery_mode='simulation'` (F6 L86) — a tela não destrava envio real nem que o payload peça.
- `automation_live_enabled` segue `false`.

## 6. Autorização da tela (F6) — respeita "editar ≠ operar"

`automation.operate` (secretária): listar automações, disparar teste simulado.
`automation.edit` (gestor): criar, editar, publicar, biblioteca de mensagens.
Nenhuma rota sem gate. ✅

## 7. DDL destrutivo — nenhum sobre dado existente

Só dois casos, ambos legítimos e internos à feature: `drop function complete_automation_simulation` (criada na F3, substituída) e os `delete` do save do builder, **escopados por `automation_id` + `organization_id`**, com controle otimista de concorrência ("rascunho alterado em outra sessão"). ✅

## 8. Verificação independente

`npm run precheck:fast` **na minha máquina**: lint **0**, typecheck **0**, **696 passando / 39 pulados (735 total), 0 falha**, 155 arquivos passando / 7 skip.

O Codex relatou 662 passando / 73 pulados — **mesmo total (735)**, zero falha nos dois. A diferença é que **meu Supabase local estava no ar**, então os 34 testes `*.local.test.ts` (scheduler, waits, builder, isolamento E2) **executaram aqui de verdade**, contra `127.0.0.1:54321`. Banco local confirmado com 9 tabelas `automation*`, `pg_cron` instalado, cron agendado e 222 `role_permission_defaults`. **A verificação desta ponta ficou mais forte que a do relatório, não mais fraca.**

## 9. Observações que NÃO bloqueiam (levar para a Entrega C)

1. **Tick que falha em silêncio.** `request_automation_tick()` tem `exception when others then return null`. Se a URL estiver errada, o app fora do ar ou o segredo rotacionado, o motor inteiro para **sem sinal nenhum**. Registrar última tentativa/resultado do tick numa tabela e expor na observabilidade (F9) — motor parado calado é o pior modo de falha possível para o piloto.
2. **Job de inscrição pausada queima retries.** O dispatch levanta `55000` corretamente (não envia), mas quando o worker da VPS existir (Entrega C) isso tende a virar 5 tentativas até `dead_letter`. Definir que takeover **estaciona/cancela** o job em vez de deixá-lo queimar retentativas.
3. **`unknown` e `dead_letter` param o lead em silêncio.** Comportamento conservador e correto, mas precisa de fila visível na F9 — senão um lead trava sem ninguém saber.
4. **Item de higiene ainda aberto** (herdado): teste não deveria sequer resolver a URL de produção. Forçar loopback no setup do Vitest e falhar ruidosamente com o ref de prod.

## 10. Próximo passo

Liberado para a **Entrega C (F7–F9)**: roteamento por etiqueta · tarefas · mover etapa/funil · reentrada/cooldown · mídia (upload TUS + bucket `automation-media` + variantes + worker ffmpeg na VPS) · observabilidade navegável (que deve absorver os itens 1-3 do §9).

**Antes da C**, vale o Junior percorrer o roteiro do `IMPL-LOG.md` (`localhost:3000/platform/tenants` → conta → Automações) — é o primeiro marco que ele vê e opera, e o retorno dele deve entrar na C como ajuste de UX.

Nada é deployado até o Junior aprovar. `automation_live_enabled` = `false`.
