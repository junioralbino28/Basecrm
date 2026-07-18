# Construtor de Funil — PLAN (estrutura proposta · para o Codex opinar ANTES de executar)

> De: Claude. Para: Codex. Base: `SPEC.md` + `VISAO-PRODUTO.md` + `PESQUISA-KOMMO.md` + `PESQUISA-GHL.md`.
> **Pedido explícito do Junior: você opina na estrutura ANTES de implementar.** Escreva `OPINIAO-CODEX.md` nesta pasta respondendo às perguntas do §6 (e ao que mais achar). **Não comece a implementar antes do martelo batido.**
> Branch: `feat/funil-construtor` (a partir de `main`=`be7fe35`).

## 1. Leia nesta ordem
1. `SPEC.md` (o quê + decisões travadas + critério de sucesso)
2. `VISAO-PRODUTO.md` (a experiência em linguagem de produto)
3. `PESQUISA-KOMMO.md` §3, §4, §7 e `PESQUISA-GHL.md` §1, §4, §7 (padrões + os buracos que vamos superar)
4. `AGENTS.md` + `docs/basecrm-engineering-playbook.md`
5. Skills: `senku-fullstack`, `evolution-api`

## 2. Estrutura de dados proposta (4 + 2 tabelas)

Baseada no modelo HubSpot/GHL (lista encadeada + cursor por lead), validada nas 2 pesquisas.

**`automations`** — a definição do fluxo
`id · organization_id · name · enabled(bool, default false) · trigger_type(tag|stage_change|event) · trigger_config(jsonb) · service_tag(text, o seletor de fluxo) · should_re_enroll(bool) · cooldown_days(int, default 5) · version(int) · created_by · timestamps`

**`automation_steps`** — os passos, lista encadeada
`id · automation_id · step_type · config(jsonb) · next_step_id · branch_config(jsonb: no_answer/another_answer/failed) · order_hint(int)`
`step_type` v1: `send_message` · `delay` · `wait_for_event` · `create_task` · `move_stage` · `move_pipeline` · `condition`

**`automation_enrollments`** — o cursor por lead **(coração do motor)**
`id · automation_id · **definition_snapshot(jsonb, IMUTÁVEL)** · lead_id/contact_id · organization_id · current_step_id · status(active|waiting|paused|done|exited) · resume_at(timestamptz) · **paused_at · paused_by** · wait_message_id(text, atribuição por message-id) · entered_at · exited_reason`

**`automation_runs`** — log/auditoria
`id · enrollment_id · step_id · status · payload(jsonb) · error · executed_at`

**`message_templates`** — biblioteca de mensagens
`id · organization_id · name · channel · body(text) · media_asset_id(nullable) · variables(jsonb) · created_by · timestamps`
> No passo: `config.template_id` + `config.body_local` + `config.sync_with_template(bool, default false)` = **copy-on-add com sync opcional**.

**`media_assets`** — biblioteca de mídia
`id · organization_id · kind(image|video|audio|document) · storage_path · mime · size_bytes · duration_ms · original_filename · timestamps`
> Reusar o bucket/RLS por tenant que já existe (`20260625000000_deal_files_storage_tenant_rls.sql` + `lib/supabase/dealFiles.ts`).

**Sem coordenadas XY** (decisão travada: lista vertical, ordem por encadeamento).

## 3. O que já existe e deve ser REUSADO (não reconstruir)
- **Envio:** `lib/channels/evolution.ts` → `sendEvolutionTextMessage` · `sendEvolutionMediaMessage` (image/video/document/audio) · `sendEvolutionAudioMessage` (PTT).
- **Anexo em conversa:** `lib/conversations/conversationMedia.ts` (`dispatchConversationMedia`, `ConversationAttachment`).
- **Storage por tenant:** `lib/supabase/dealFiles.ts` + migration de storage RLS.
- **Multi-número + IA por conexão:** `channel_connections.config.aiEnabled` (feature multi-número, já em prod).
- **Permissões:** `lib/auth/permissions.ts` (35 chaves, E1/E2 no ar) → **adicionar `automation.edit` e `automation.operate`** seguindo o padrão + regenerar o snapshot E2 (`scripts/generate-e2-role-permission-defaults.mjs`).
- **Tarefas:** tabela `tasks` (migration `20260618000000_tasks.sql`) para o passo `create_task`.

## 4. Agendador — recomendação e alternativa

**Recomendado: Vercel Cron** batendo numa rota protegida (`/api/internal/automations/tick`), que varre `automation_enrollments` com `status='waiting' AND resume_at <= now()` e avança os cursores.
- Prós: o app já vive na Vercel; testável local; sem extensão nova no Postgres; lógica em TS junto do resto.
- Contras: frequência mínima depende do plano — **conferir o plano da conta antes de fechar**.

**Plano B: pg_cron + pg_net** — `pg_cron` está **disponível mas não instalado**; `pg_net` **já instalado (0.19.5)** no projeto `eqidsihasmwwamkaqfka`.

> **Pergunta pro Codex no §6.**

## 5. Fases (cada uma fecha verde e commitada)

**F1 — Fundação de dados**: migrations das 6 tabelas + RLS por tenant (espelhar o padrão do E2: `can_access_organization` + `has_permission`) + testes de isolamento.
**F2 — Motor**: executor de passos (função pura testável) + `advanceEnrollment` + snapshot imutável na inscrição + **modo seguro** (flag por org/automação: simula envio e loga, não chama Evolution).
**F3 — Agendador**: rota de tick + idempotência (não avançar 2× o mesmo cursor; travar com `for update skip locked` ou equivalente) + teste de corrida.
**F4 — Biblioteca de mensagens + mídia**: CRUD + copy-on-add com sync toggle + **validação de limites do WhatsApp no upload** (imagem 5MB/JPEG-PNG · vídeo 16MB/MP4 · áudio 16MB · doc 100MB) + regra "áudio não aceita texto/legenda junto".
**F5 — Tela do construtor**: lista vertical, gatilho + passos na mesma tela, botão "+" entre passos abrindo modal de busca de ação, editor de mensagem inline, anexo da biblioteca, **branches obrigatórios** (não respondeu / falhou envio).
**F6 — Roteamento + saída**: entrada por **tag de serviço**; `wait_for_event` com corrida (resposta vs prazo, **atribuição por message-id**); resposta → move pro Funil de Vendas/Triagem; **esfriou 5 dias → re-inscrição**; **pausa por lead** quando humano assume (integrar com o takeover que já existe nas Conversas).
**F7 — Observabilidade**: histórico de inscrições + log por passo + **navegar do log pro passo**.
**F8 — IA monta o fluxo**: contrato do SPEC §3 (≤3 perguntas puláveis → structured output → **validação formato+semântica** → instancia `enabled=false` → to-do list clicável). **A IA nunca escreve SQL nem publica.**
**F9 — Fechamento**: `IMPL-LOG.md`, `precheck:fast` verde, sem deploy.

## 6. ⚠️ Perguntas para o Codex responder em `OPINIAO-CODEX.md` (antes de codar)

1. **Agendador:** Vercel Cron ou pg_cron+pg_net? Considere frequência mínima do plano, idempotência, retry e observabilidade. Se Vercel Cron, qual granularidade mínima aceitável pro follow-up (D+0..D+25 tolera tick de 5–15 min?).
2. **Snapshot da definição:** guardar o fluxo inteiro em `definition_snapshot` jsonb por inscrição é aceitável, ou prefere versionar `automations` (tabela `automation_versions`) e a inscrição apontar `version_id`? Trade-off tamanho × normalização × migração futura.
3. **Lista encadeada (`next_step_id`) vs ordem explícita (`order` int)** com branches em tabela separada — qual sofre menos com edição no meio do fluxo e com branches?
4. **`wait_for_event` com corrida:** como garantir que a resposta do lead seja atribuída ao passo certo (o bug do GHL)? Proposta: gravar `wait_message_id` na inscrição e casar no webhook. Vê furo?
5. **Modo seguro:** flag por automação, por organização, ou variável de ambiente? Precisa ser à prova de ligar sem querer.
6. **Copy-on-add com sync bidirecional:** onde mora a verdade quando `sync=true` e os dois lados mudam? Proposta: última escrita vence + `updated_at`. Suficiente?
7. **Reuso do executor:** o passo `send_message` deve chamar `dispatchConversationMedia` (que já cria a mensagem na conversa) ou falar direto com `lib/channels/evolution.ts`? Qual mantém o histórico da conversa correto?
8. **Fallback de variável em todos os canais:** sintaxe proposta `{{contato.nome | "tudo bem"}}`. Onde aplicar — na renderização do template (um único ponto)?
9. **Fatiar F1–F9:** a ordem está boa? O que você entregaria antes/depois? Algum bloco grande demais pra um lote?
10. **Algo no SPEC que você acha errado ou arriscado?** (não reabra as decisões travadas do §4 do SPEC sem argumento forte)

11. **⭐ ONDE RODA A COMPRESSÃO DE VÍDEO?** (requisito novo do Junior — SPEC §3 Bloco 1). Restrições reais: rota Vercel tem limite de corpo (~4.5MB) e **sem ffmpeg no runtime serverless** → upload obrigatoriamente **direto do navegador pro Supabase Storage** via URL assinada. As opções:
    - **(a) No navegador, antes de subir (`ffmpeg.wasm`)** — sem infra nova, sem custo recorrente; mas é lento e pesado pra arquivo de 200-300MB (usa CPU/RAM do usuário, pode derrubar a aba). Bom pra "um pouco acima do limite".
    - **(b) Worker próprio com ffmpeg** (o Junior **tem VPS Hostinger**) — sobe pro Storage → dispara job → worker baixa, comprime, devolve a derivada. Robusto pra qualquer tamanho; custo = manter o worker.
    - **(c) Serviço de mídia pago** (Cloudinary/Mux/Bunny) — zero manutenção; custo recorrente + **dado da clínica sai pra terceiro** (pesa na regra de segurança do projeto).
    - **(d) v1 pragmático:** validar + avisar no upload, comprimir no navegador quando der, e **deixar o worker pra depois**.
    Qual você recomenda pro v1 e por quê? Como modelar `media_assets` pra guardar **original + derivadas por canal** desde já (pra não migrar depois)?

## 7. Riscos conhecidos
- **Idempotência do agendador** é o ponto mais perigoso: tick duplicado = mensagem duplicada pro paciente.
- **Modo seguro** precisa ser à prova de erro — envio acidental pro número da agência com lead real queima o número.
- **Vídeos do piloto estão fora do limite** (56–322MB `.mov` vs 16MB MP4) — conversão é tarefa à parte, mas o **validador de upload** já deve recusar e explicar.
- **`.mov` e 4K/60fps** confirmam que precisamos validar **formato e tamanho no upload**, não no envio.
- Não quebrar o multi-número/`aiEnabled` que acabou de subir pra produção.
