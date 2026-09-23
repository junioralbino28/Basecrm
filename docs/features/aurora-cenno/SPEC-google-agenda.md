# SPEC — Google Agenda na Aurora (espelho do Google, CRM dono da reserva)

Status: aprovado para construção em 22/09/2026. Desenho, pesquisa e críticas completos no cérebro:
`06-References/basecrm-producao-aurora-2026-09-21/DESENHO-GOOGLE-AGENDA-2026-09-22.md` (workflow `wf_cd2e01aa-012`).

## Pedido e decisões

- Junior, 22/09: "primeira coisa a resolver é agenda, vamos conectar o google agenda e fazer ela agendar". Inverte a ordem de 20/09 (a grade de agenda dentro do CRM, pensada para a clínica, fica ADIADA, não abandonada).
- Travado em 20/09 e mantido: o CRM continua dono da reserva (`reserve_conversation_meeting`); o Google é espelho: (1) o ocupado do Google entra no cálculo de horários; (2) ao confirmar, cria-se o evento no Google com o lead convidado e Google Meet, e o convite por e-mail sai pelo próprio Google. Token por responsável da agenda (`config.calendar.ownerId`). Nada muda para quem não conectar.
- Respostas do Junior, 22/09:
  - conta Google da agenda: **cenourahub@gmail.com** (Gmail, não Workspace);
  - projeto no Google Cloud: criado por Claude no Chrome dele;
  - lembrete com o link do Meet pelo WhatsApp: **15 minutos antes**;
  - confirmação: **acrescentar a frase do convite** (variação aprovada, abaixo).

## Restrições do Google (pesquisa, fontes no documento do cérebro)

- Escopos mínimos, ambos "sensíveis" (nenhum "restrito"): `https://www.googleapis.com/auth/calendar.freebusy` e `https://www.googleapis.com/auth/calendar.events`.
- Tela de consentimento **External**, publicada **In production** SEM verificação formal: aparece "app não verificado" no primeiro consentimento (Avançado → Ir para o app), teto vitalício de 100 contas por projeto, e o refresh token NÃO expira em 7 dias (isso só acontece em status Testing).
- Refresh token só com `access_type=offline` + `prompt=consent`. `invalid_grant` = token morto (revogado, 6 meses sem uso, mais de 100 tokens por conta/cliente).
- Meet: `events.insert` com `conferenceData.createRequest` (`hangoutsMeet`) + query `conferenceDataVersion=1`; o link pode vir `pending` e aparecer depois em `hangoutLink`. **Não verificado se funciona em Gmail pessoal pela API** → teste real obrigatório na Fatia 1 antes de depender dele.
- `sendUpdates=all` faz o Google mandar o convite ao convidado externo.
- Service account está descartada (não convida nem gera Meet sem delegação de domínio, que não existe em Gmail).
- O Google exige redirect URI EXATO: callback fixo `/api/integrations/google-calendar/callback`, com a conexão identificada pelo `state` no banco. URIs cadastrados: `https://crm.basea2.com/...`, `https://teste.crm.basea2.com/...`, `http://localhost:3000/...`.

## Dados (migrations aditivas; nenhuma altera tabela existente)

- `google_calendar_connections`: `id`, `organization_id`, `owner_id` (profile), `google_account_email`, `google_calendar_id` (padrão `primary`), `google_calendar_summary`, `busy_calendar_ids` (bloqueiam), `watch_calendar_ids` (só avisam), `refresh_token_secret_id` (id no Supabase Vault), `scope`, `status` (`connected` | `reconnect_required` | `revoked`), `last_error` (redigido), `last_read_error_at`, `connected_at`, `updated_at`. Único por (`organization_id`, `owner_id`). RLS ligado sem policy para `authenticated`/`anon`; grants só `service_role`.
- `google_oauth_states`: `state` (uuid, pk), `organization_id`, `channel_connection_id`, `owner_id`, `requested_by`, `redirect_origin`, `created_at`, `expires_at` (10 min), `consumed_at`. Uso único (marca consumido ANTES de trocar o code). Só `service_role`.
- `conversation_meeting_google_events`: `activity_id` (pk, refs `activities` on delete cascade), `organization_id`, `thread_id`, `channel_connection_id`, `owner_id`, `invitee_email`, `google_calendar_id`, `google_event_id`, `meet_link`, `status` (`pending` | `created` | `update_pending` | `cancel_pending` | `cancelled` | `failed`), `attempts`, `last_error`, `next_retry_at`, `reminder_sent_at`, `reminder_escalated_at`, `overlap_warning`, `created_at`, `updated_at`. Só `service_role`.
- Funções `security definer`, `set search_path = ''`, `revoke` de public/anon/authenticated, `grant execute` só a `service_role`: gravar/ler/apagar o refresh token no Vault por (org, owner). O token nunca fica em coluna comum nem em `channel_connections.config` (que vai para o navegador redigido só por nome, `lib/channels/publicChannel.ts`).
- O access token NÃO é persistido: cache em memória da instância, renovado a partir do refresh token.

## Fluxo OAuth

1. `POST /api/platform/tenants/[tenantId]/channels/[connectionId]/google-calendar/connect` — chamado por `fetch` same-origin (`isAllowedOrigin` + `requireTenantAccess` com `whatsapp.manage_connection`); lê o `ownerId` do `config.calendar` NO SERVIDOR; grava o `state`; devolve `{ url }` de consentimento. O cliente faz `window.location = url`.
2. `GET /api/integrations/google-calendar/callback` (pública, o Google chama) — valida `code`/`state`/`error`; `state` existente, não expirado, não consumido; marca consumido; troca o code; lê o e-mail da conta (`userinfo` via `openid email`); grava o token no Vault e faz upsert da conexão com org/owner vindos do `state`; redireciona para a tela da conexão com `?google=ok|erro` (sem token na URL).
3. `POST .../google-calendar/disconnect` — revoga no Google (melhor esforço), apaga do Vault, `status = revoked`.
4. `GET .../google-calendar/status` — `{ connected, googleAccountEmail, status, connectedAt }`, nunca o token.
- Variáveis de ambiente novas: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` (Vercel Preview e Production). Sem elas, o botão não aparece e nada muda.

## Escolha de agendas (Fatia 5 + correção de 22/09)

- Cada conexão escolhe **onde a IA escreve** (`google_calendar_id` + `google_calendar_summary`) e o que as outras agendas da conta fazem. Três papéis, exclusivos entre si:
  - **Ignorar** — a IA nem consulta.
  - **Bloquear** (`busy_calendar_ids`) — entra no `freebusy`; o horário não é oferecido ao lead.
  - **Só avisar** (`watch_calendar_ids`) — **não entra no `freebusy`**; o horário continua sendo oferecido e, se houver sobreposição quando o evento nasce (ou é remarcado), grava `conversation_meeting_google_events.overlap_warning` e toca o sino (severidade média). Falha nessa checagem nunca derruba a reunião já criada.
- Por que as duas listas existem: a agenda principal de uma equipe tem compromissos de **outras pessoas** (na CENNO HUB, calls que a Rayanne faz com clientes). Bloquear ali tirava horário do closer sem motivo; ignorar escondia o conflito. Pedido do Junior em 22/09.
- A lista de agendas usa `summaryOverride ?? summary`: agenda renomeada (o caso da principal, que a API devolve com o próprio e-mail em `summary`) aparece com o nome que a pessoa vê no Google.
- **Reconectar preserva a escolha.** O callback do OAuth chama a RPC sempre com `primary`; a RPC ignora esse valor no `do update` e só volta para `primary` (limpando nome e as duas listas) quando o **e-mail da conta Google muda** — ids de agenda da conta antiga não existem na nova. Antes da correção, toda reconexão devolvia a IA para a agenda principal em silêncio, mantendo na tela o nome da agenda escolhida.

## Leitura de ocupado

- Em `loadAvailableMeetingSlots` (`lib/conversations/aiReply.ts`), depois do ocupado do CRM: se o responsável tem conexão `connected`, `freebusy.query` na janela de oferta (timeout ~2,5 s), resultado em cache por (org, owner) por 60 s. Sem conexão: zero chamada de rede.
- Os intervalos ocupados do Google entram como INTERVALOS (não só inícios): evento de 3 h, dia inteiro ou vários dias bloqueia todos os horários que se sobrepõem. Evento marcado "livre" não bloqueia (o próprio Google não o devolve).
- Falha de leitura (token morto, timeout) → oferta segue só com o CRM (a Aurora não para) + aviso idempotente no sino ("Google Agenda não respondeu; a Aurora está oferecendo horários sem conferir sua agenda"), no máximo 1 por conexão por dia; `invalid_grant` também marca `reconnect_required`.

## Criação do evento (fora da resposta ao lead)

- Depois de a reserva ser gravada com sucesso (confirmação da Aurora em `aiReply.ts` e confirmação humana em `conversations/[threadId]/route.ts`), se o responsável tem Google conectado: grava linha `pending` em `conversation_meeting_google_events`. Nada de rede nesse caminho.
- Passo novo no tick (`app/api/internal/automations/tick/route.ts`), try/catch que nunca derruba o tick, com `batchLimit` e `deadlineMs` próprios (orçamento total do tick é 60 s): `events.insert` com `conferenceDataVersion=1`, `sendUpdates=all`, Meet, convidado = e-mail do lead (se houver e válido).
- **Texto do evento é FIXO, nunca gerado pela IA** (G16; o e-mail do convite sai em nome da conta Google): título `Diagnóstico Cenoura Hub — {primeiro nome}` (a marca pública segue "Cenoura Hub" até o rebrand, decisão de 22/09); descrição neutra fixa.
- Limites anti-abuso (o e-mail vem do lead e não tem prova de posse): no máximo 1 evento ativo por contato; no máximo N convites novos por conexão por dia (padrão 20); cada convite enviado gera aviso de baixa severidade no sino com o e-mail convidado (auditoria).
- Meet `pending` → relê o evento nos ticks seguintes até ter `hangoutLink`.
- Falha → retentativa com espera crescente; `invalid_grant` → `reconnect_required` + aviso de alta severidade; esgotou → `failed` + aviso. A reserva do CRM nunca é desfeita.
- Remarcar (`adjust_meeting`, mesma `activity`) → `update_pending` → `events.patch` (horário) com `sendUpdates=all`.
- Cancelar: ação nova `cancel_meeting` no card de reunião do CRM (marca a atividade como cancelada) → `cancel_pending` → `events.delete` com `sendUpdates=all`.
- Remarcação pedida ao WhatsApp numa conversa que já tem reunião futura confirmada: o novo horário atualiza a MESMA atividade (sem deixar a antiga órfã no CRM nem no Google).

## Lembrete com o link (15 min antes)

- Passo no tick: reunião com evento `created`, `meet_link` e início entre agora e +15 min, `reminder_sent_at` nulo → `events.get` confere que o evento ainda existe e não foi cancelado → envia pelo WhatsApp pelo mesmo caminho de envio da cutucada → marca `reminder_sent_at` (reserva atômica para dois ticks não mandarem duas vezes).
- Texto (novo, conteúdo operacional): `{primeiro nome}, nossa reunião começa daqui a pouco. Aqui está o link do Google Meet: {link}`.
- Se a janela chegou sem link pronto (evento falhou, token morto, evento apagado no Google) → aviso de ALTA severidade daquela reunião ("reunião com {lead} em 15 min sem link do Google; mande na mão"), uma vez.

## O que a Aurora diz

- Texto aprovado continua valendo para quem NÃO tem Google conectado.
- Com Google conectado, a confirmação usa a variação aprovada pelo Junior em 22/09:
  "Perfeito, fulano, nossa reunião está marcada para {dia}, {data}, às {hora}; nosso especialista Junior vai conduzir seu diagnóstico. Você vai receber um convite por e-mail com os detalhes, e no dia te envio o link aqui mesmo no WhatsApp alguns minutinhos antes (Google Meet). Mais alguma dúvida?"
- Futuro ("vai receber"), porque o evento sai no tick seguinte.

## Fatias e critério de aceite

0. **Google Cloud** (Claude no Chrome do Junior, conta cenourahub@gmail.com): projeto, Calendar API ativada, consentimento External publicado em produção, domínio autorizado `basea2.com`, cliente OAuth Web com os 3 redirect URIs, credencial no `.secrets` e na Vercel. Aceite: `GOOGLE_OAUTH_CLIENT_ID/SECRET` presentes nos dois lugares, sem serem impressos.
1. **Conectar**: migrations + rotas + botão na tela da agenda da conexão. Aceite: o Junior conecta cenourahub@gmail.com e vê "Google conectado"; a Aurora não muda nada; teste real de criar e apagar 1 evento com Meet na conta (resolve o ponto não verificado).
2. **Ocupado**: evento criado à mão no Google some das ofertas da Aurora; sem conexão, comportamento idêntico (teste de regressão).
3. **Evento**: reunião confirmada pela Aurora vira evento no Google com o lead convidado e Meet em até ~5 min, sem atrasar a resposta; remarcar atualiza; cancelar apaga; token morto vira aviso e nada quebra.
4. **Lembrete**: a mensagem com o link sai uma vez, 15 min antes; sem link → aviso de alta severidade.

Cada fatia: suíte completa lida antes de commitar, prévia provada no banco de preview (JS servido), revisão adversarial, produção só com o que já foi provado na prévia.

## Testes (nenhum chama o Google real)

- Um único ponto de rede (`lib/googleCalendar/googleApiClient.ts`), mockado em todos os testes.
- Unitários: URL de consentimento (escopos, offline, consent, state), troca/renovação de token e `invalid_grant`, free/busy (sucesso, 401, timeout, JSON ruim, cache), intervalos → horários bloqueados (evento longo, dia inteiro, vários dias, fuso), payload do `events.insert` (Meet, `conferenceDataVersion`, `sendUpdates`, texto fixo), limites de convite, retentativa, lembrete idempotente, aviso sem link.
- Rotas: connect (origem, permissão, owner do servidor), callback (state ausente/expirado/reusado/de outro tenant), disconnect, status (nunca devolve token).
- Supabase local: RLS/grants das três tabelas e das funções do Vault (authenticated e anon negados).
- Regressão: conexão sem Google = mesmas ofertas e mesmo texto de hoje.

## Fora deste lote

- Grade de agenda estilo Google dentro do CRM (clínica) — adiada.
- Vários responsáveis de organizações diferentes na mesma conta Google (conflito entre organizações) — fora de escopo enquanto houver 1 responsável.
- Limpeza periódica de tokens de responsáveis que deixaram de ser referenciados — registrada.
