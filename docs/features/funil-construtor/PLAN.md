# Construtor de Funil — PLAN v2 (aprovado pelo Junior · pronto pra execução)

> **v2 — 2026-07-18.** Reescrito pelo Claude incorporando `OPINIAO-CODEX.md` (aceita integralmente em `REVIEW-OPINIAO.md`) + as decisões do Junior.
> A v1 continha 2 erros do Claude, corrigidos aqui (ver `REVIEW-OPINIAO.md` §2).
> **Junior aprovou (2026-07-18):** os 8 pontos do Codex + o fatiamento em 4 entregas. **Plano Vercel = FREE (Hobby).**
> Branch: `feat/funil-construtor`. Base: `main`=`be7fe35`.

## 0. Leitura obrigatória antes de codar
1. `SPEC.md` — o quê, decisões travadas, critério de sucesso, dados reais do piloto
2. `VISAO-PRODUTO.md` — a experiência em linguagem de produto
3. `OPINIAO-CODEX.md` — o parecer arquitetural (é a base técnica deste PLAN)
4. `REVIEW-OPINIAO.md` — a adjudicação do Claude + as 4 verificações de código
5. `PESQUISA-KOMMO.md` / `PESQUISA-GHL.md` — fontes, com lacunas declaradas
6. `AGENTS.md`, `docs/basecrm-engineering-playbook.md`, skills `senku-fullstack` e `evolution-api`

## 1. Decisão do agendador — **Supabase Cron (pg_cron + pg_net)**

**O plano da Vercel é FREE (Hobby)** → no Hobby o cron da Vercel roda **no máximo 1×/dia**, o que não serve pro follow-up. Portanto:

- **`pg_cron` agenda um job a cada 5 minutos** que dispara `net.http_post` (pg_net) contra o endpoint de tick da aplicação.
- **Estado verificado no projeto `eqidsihasmwwamkaqfka`:** `pg_net` **já instalado (0.19.5)**; `pg_cron` **disponível (1.6.4), ainda NÃO instalado** → habilitar via migration.
- O endpoint de tick é **protegido por segredo** (header), nunca público.
- `pg_net` é fire-and-forget: **não garante entrega nem retry.** Isso é aceitável **porque o outbox é a garantia** — um tick perdido é reconciliado pelo próximo, que busca todo job com `available_at <= now()` (não só os criados desde o último tick). O cron é **gatilho**, não garantia.

**⚠️ Limite da Vercel que continua valendo (Hobby):** duração máxima de função é curta. Portanto o tick **claim-and-return**: pega um lote pequeno, e o trabalho pesado não pode estourar o tempo.

**➕ Alternativa a avaliar na F0 (recomendação do Claude):** como o **worker da VPS já vai existir pro ffmpeg** (ponto 7 aprovado), o **dispatch da automação pode rodar no mesmo worker**, consumindo a fila direto do Postgres. Isso tira a execução do limite de função da Vercel e consolida infra num lugar só. O cron continuaria só como despertador (ou o próprio worker faz polling). **Decidir na F0 e registrar no ADR.**

## 2. Modelo de dados (aprovado)

**Autoria (draft, editável)**
- **`automations`** — `id · organization_id · name · lifecycle_status(draft|published|paused|archived) · delivery_mode(simulation|test|live) · trigger_type · trigger_config · published_version_id · created_by · timestamps`
  *(sem `enabled` — era ambíguo; sem `service_tag` — não duplicar o trigger; sem `cooldown_days` — ver §3)*
- **`automation_steps`** — os **nós**: `id · organization_id · automation_id · step_key · step_type · config · sort_key(só UI)`
- **`automation_step_edges`** — os **caminhos**: `id · organization_id · automation_id · from_step_id · outcome · to_step_id · order`
  `outcome` ∈ `success | answered | timeout | failed | true | false | otherwise`. Índice único em `(from_step_id, outcome)` onde o tipo não admitir múltiplos.

**Publicação (imutável)**
- **`automation_versions`** — `id · organization_id · automation_id · version · definition(jsonb canônico) · definition_hash · created_by · created_at · published_at`. **Sem UPDATE/DELETE operacional.** O `definition` carrega o **conteúdo efetivo dos templates** (não só `template_id`), senão editar um template mudaria retroativamente uma versão publicada.

**Execução**
- **`automation_enrollments`** — `id · organization_id · automation_id · **automation_version_id** · deal_id(oportunidade) · contact_id(destinatário) · thread_id · channel_connection_id · **current_step_key**(não FK pro draft) · status(active|waiting|paused|done|exited|failed|cancelled) · paused_at · paused_by · entered_at · exited_reason`
- **`automation_jobs`** (outbox/fila) — `id · organization_id · enrollment_id · version_id · step_key · job_type · **idempotency_key (UNIQUE)** · status(pending|leased|sent|failed|unknown|dead_letter|simulated) · available_at · lease_owner · lease_until · attempt_count · last_error · timestamps`
- **`automation_waits`** — `id · organization_id · enrollment_id · version_id · step_key · thread_id · channel_connection_id · outbound_provider_message_id · status(pending|resolved|expired) · opened_at · expires_at · resolved_by_message_id · resolved_at`
- **`automation_step_attempts`** (auditoria) — tentativa por passo: status, duração, `scheduled_for` × `executed_at`, provider ID, erro.

**Conteúdo**
- **`message_templates`** — `id · organization_id · name · channel · body · media_asset_variant_id · variables(jsonb) · **revision** · timestamps`
  No passo: `template_id` + `link_mode(copied|linked)` + `body_local`. **`copied` é o default.** Em `linked`, o template é a fonte de verdade; editar pelo passo cria **nova revisão do template** com aviso de quantos drafts serão afetados + optimistic concurrency por `revision`. "Editar só aqui" = ação explícita **desvincular e copiar**.

**Mídia** (bucket próprio `automation-media`, **NÃO reusar `deal-files`**)
- **`media_assets`** — `id · organization_id · kind · original_storage_path · original_filename · original_mime · original_size_bytes · original_checksum · status · created_by · timestamps`
- **`media_asset_variants`** — `id · organization_id · asset_id · profile · channel · storage_path · mime · size_bytes · duration_ms · width · height · video_codec · audio_codec · checksum · processor_version · status · error · timestamps`
- **`media_processing_jobs`** — `id · organization_id · asset_id · target_profile · status · available_at · lease_owner · lease_until · attempt_count · last_error · timestamps`

Paths: `{organization_id}/{asset_id}/original/{uuid}` e `{organization_id}/{asset_id}/variants/{variant_id}.mp4`. O passo publicado referencia **`media_asset_variant_id`**, nunca o path do original.

**Regra geral:** `organization_id` em **todas** as tabelas operacionais + RLS espelhando o padrão do E2 (`can_access_organization` + `has_permission`). O worker **nunca** aceita `organization_id` vindo do browser.

## 3. Regras que estavam misturadas e agora são separadas
- **timeout do passo** (quanto o `wait_for_event` espera)
- **regra de esfriamento** (o "esfriou = 5 dias" do Junior → sai/volta)
- **política de reentrada/cooldown** (intervalo mínimo pra reinscrever)
- **timezone da organização + quiet hours** no schema desde já; definir se "D+1" é 24h ou próximo dia local. **Não assumir UTC como regra de produto.**

## 4. Correções em código existente (verificadas — ver `REVIEW-OPINIAO.md` §1)
1. **Serviço compartilhado `dispatchConversationOutbound`** usado por envio manual **e** automação: recebe `idempotency_key`, **persiste mensagem `pending` + job ANTES do efeito externo**, resolve tenant/conexão/credenciais/URL assinada no servidor, aplica janela de 24h e regras do canal, chama os adapters existentes, atualiza mensagem/attempt/run com provider ID, atualiza o resumo da thread **sem transformar mensagem automática em takeover humano**.
   *(Hoje a rota envia nas linhas ~204/228 e só faz `INSERT` na ~276 — janela de duplicidade real.)*
2. **Dedupe de webhook com índice único**: coluna própria + `UNIQUE(channel_connection_id, provider_message_id)` (hoje é `SELECT`→`INSERT` sobre caminho JSONB, com corrida).
3. **Timeout ambíguo após POST** → `delivery_status = unknown`, **nunca retry cego**. Objetivo realista é **effectively once** (outbox + IDs persistidos + reconciliação + fila de revisão), não exactly-once.

## 5. Safe mode — gates em série, todos fail-closed
1. **Ambiente:** `AUTOMATION_LIVE_SENDS_ENABLED` ausente/≠`true` **bloqueia qualquer envio real** (kill switch; banco e UI não ultrapassam).
2. **Organização:** capability `automation_live_enabled`, default `false`.
3. **Automação:** `delivery_mode`, default `simulation`.
4. **Canal:** conexão ativa + compliance aprovado + credenciais resolvidas.
5. **Publicação:** só versão publicada opera em `live`.

Em `test`: allowlist explícita de números. Em `simulation`: registra payload renderizado e decisão, **nunca fabrica provider message ID**. Troca de modo exige `automation.operate` + log de auditoria.

## 6. Variáveis
Renderer **determinístico e server-side**, antes de criar o job. Sintaxe `{{ contato.nome | default: "tudo bem" }}` — gramática fechada, **sem eval**. Catálogo fechado inserido por picker; chave canônica estável (label PT-BR é só apresentação); **token desconhecido ou sem fallback bloqueia a publicação**, não some calado; renderiza primeiro, valida tamanho/formato do canal depois; salva no attempt o conteúdo efetivamente renderizado. Preview no cliente reusa a função pura, mas **a verdade é a do servidor**.

## 7. Fases × Entregas (fatiamento aprovado pelo Junior)

| Entrega | Fases | O que fecha | Junior vê? |
|---|---|---|---|
| **A** | F0–F3 | Fundação: ADR · schema de autoria + RLS · publicação (compiler/validator + versões imutáveis + enrollments) · outbox/jobs/attempts + serviço compartilhado de envio **em simulação** | Não vê tela — Claude demonstra com teste |
| **B** | F4–F6 | Scheduler (claim/lease/retry/reconciliação + testes de corrida) · `wait_for_event` + inbox idempotente + resposta×timeout + takeover · **builder manual + biblioteca de mensagens + publish/test** | **SIM — 1º marco visível, ele opera a tela** |
| **C** | F7–F9 | Roteamento por tag + tarefas + mover etapa/funil + reentrada/cooldown · **mídia (TUS + bucket + variantes + worker ffmpeg)** · observabilidade navegável + dead-letter + operação por lead | **SIM — fecha o critério de sucesso com vídeo** |
| **D** | F10 | IA: perguntas ≤3 puláveis · structured output · validação · pendências clicáveis · nasce draft | **SIM** |

**F0 = ADR do motor** (estados, versionamento, arestas, idempotência, safe mode, invariantes, **e a decisão worker-VPS vs tick-Vercel do §1**). É o primeiro entregável.

Regras de execução: teste antes do código · commit pequeno por fase · **scheduler só depois de outbox e simulação** · **IA só depois do contrato manual estável** · F8 (mídia) pode começar em paralelo depois de F1, mas não escondida dentro de "CRUD de mídia".

## 8. Riscos
- **Idempotência é o risco nº1:** tick duplicado = mensagem duplicada pro paciente. Resolvido por `idempotency_key UNIQUE` + lease + compare-and-set.
- **Safe mode precisa ser à prova de erro** — envio acidental pra lead real queima o número da agência.
- **`pg_net` não garante entrega** — a garantia é o outbox; nunca depender do tick.
- **Vídeos do piloto:** 56–322MB `.mov` (um 4K/60fps) vs limite de 16MB MP4 do WhatsApp. O validador de upload recusa e explica; o worker gera a variante.
- Não quebrar multi-número/`aiEnabled`, E1/E2 — tudo em produção.

## 9. Governança
Supabase **local** pra teste (nunca o banco da clínica) · **sem push, sem deploy** · TDD · `npm run precheck:fast` verde · PT-BR · discordou, escreve antes de implementar.
