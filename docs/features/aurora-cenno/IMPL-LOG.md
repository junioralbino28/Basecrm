# Aurora CENNO — IMPL-LOG

Data: 2026-09-19  
Branch: `feat/aurora-implantacao`

## Entrega deste lote

- Contrato de handoff com seis intenções comerciais.
- Sanitização e leitura defensiva da metadata.
- Persistência do último handoff na conversa.
- Notificação de alta prioridade na tabela existente `system_notifications`.
- ID idempotente derivado de organização + thread + evento inbound, evitando colisão entre tenants.
- Configuração `aiAgentName` e `aiPromptKey` por conexão, com fallback que preserva a Julia.
- Prompt específico `task_conversations_whatsapp_cenno_aurora`.
- Structured output migrado de `generateObject` para `generateText + Output.object` do AI SDK v6.
- Limite de 1.200 tokens de saída na geração.
- Webhook nativo passa nome, prompt, tipo de handoff e event ID.
- Rota externa aceita os mesmos campos com validação Zod.
- Pedido de reunião com data futura exata cria/atualiza uma atividade `MEETING` ligada ao contato, negócio e responsável disponíveis.
- Preferência ambígua fica registrada no handoff e no alerta, sem gerar horário artificial.
- Alertas persistentes são consultados a cada 15 segundos mesmo com a aba em segundo plano.
- O navegador avisa somente novos alertas altos e reutiliza as preferências de notificação/som do usuário.
- O alerta aponta para a thread correta por deep link.
- Card de handoff mobile-first no topo da conversa, com contexto, estado e ações `Ligar`, `Confirmar horário` e `Ajustar`.
- Confirmação/ajuste exige permissão `conversations.reply`; visualização continua em `conversations.access`.
- O estado de agenda fica no handoff como `pending`, `confirmed` ou `adjusted`, com ator e data da ação humana.
- Atividade existente só pode ser atualizada se organização, contato e negócio correspondem à thread atual.
- Conflito sequencial de outra reunião aberta a menos de 60 minutos no mesmo responsável retorna `409`.
- Teste local com usuário autenticado e chave pública provou que tenant A não lê nem altera thread/atividade do tenant B.
- Contrato de agenda por conexão com timezone, responsável, aviso mínimo, horizonte e faixas semanais; desativado por padrão.
- Reunião com duração prevista de 40 minutos e inícios separados por 60 minutos.
- A Aurora recebe os slots livres validados de todo o horizonte e não pode confirmar um horário fora dessa lista.
- A ordem dos slots é cronológica e o prompt obriga a oferecer primeiro o mesmo dia, depois o dia seguinte.
- Expediente padrão de segunda a sexta, 09:00–19:00, com horizonte máximo de 14 dias.
- Sábado é removido da agenda automática e sempre gera `meeting_requested` para confirmação humana.
- O painel aceita até quatro faixas independentes por dia útil.
- Bloqueios locais suportam almoço semanal, ocupado pontual e folga de dia inteiro.
- A tabela `conversation_calendar_blocks` valida organização, conexão e responsável, com RLS por permissão `whatsapp.manage_connection`.
- `meeting_confirmed` é revalidado imediatamente antes do envio e reservado no banco antes da confirmação ao lead.
- A função `reserve_conversation_meeting` usa advisory lock por organização/responsável e bloqueia corrida simultânea.
- Confirmação e ajuste humano usam a mesma reserva atômica do agente; não existe mais check-then-write separado.
- Criação, alteração e remoção de bloqueio compartilham o lock da reserva, e a função revalida o bloqueio dentro da transação.
- `aiEnabled=false` interrompe webhook nativo, rota externa e executor central; uma automação antiga não consegue continuar enviando.
- Sem agenda configurada, sem slot livre ou em falha de reserva, o fluxo cai para `meeting_requested` e atendimento humano.
- Tela `Agenda da IA` no cartão do número: ativação explícita, responsável obrigatório, dias, faixa, fuso, antecedência e horizonte; começa desligada.
- Chave de prompt agora precisa existir no catálogo; valor inválido ou removido falha fechado, sem usar conteúdo de outro tenant como fallback.
- `meeting_requested` nunca cria atividade confirmada. Quando há agenda disponível, a resposta é reescrita para oferecer os dois primeiros slots em vez de prometer um registro inexistente.
- Conexão, flag `ai_conversation_auto_reply` e `organization_settings.ai_enabled` são relidas antes de gerar e novamente antes de enviar.
- Conexões novas e configurações legadas sem `aiEnabled=true` ficam com automação desligada.
- Falha de geração ou envio move a conversa para `human_queue`, pausa automações e cria alerta alto idempotente.
- O fallback externo não é acionado depois que a execução nativa assumiu o envio, evitando resposta duplicada após falha de persistência.
- Webhook e rota externa de resposta usam rate limit distribuído e atômico no Supabase.
- Metadados externos têm limite de tamanho/quantidade e não conseguem sobrescrever campos de entrega controlados pelo CRM.
- Erros internos dos endpoints públicos ficam no servidor; o cliente recebe mensagens genéricas.

## Arquivos principais

- `lib/conversations/handoff.ts`
- `lib/conversations/aiAgentConfig.ts`
- `lib/conversations/aiReply.ts`
- `lib/conversations/threadMetadata.ts`
- `lib/conversations/meetingRequest.ts`
- `lib/conversations/meetingHandoffAction.ts`
- `lib/conversations/meetingAvailability.ts`
- `lib/conversations/calendarBlocks.ts`
- `lib/conversations/handoffEventId.ts`
- `lib/conversations/conversationAIGate.ts`
- `lib/conversations/conversationAIFailure.ts`
- `lib/conversations/conversationDeliveryMetadata.ts`
- `lib/conversations/conversationRateLimit.ts`
- `lib/conversations/meetingReplyPolicy.ts`
- `lib/notifications/systemAlerts.ts`
- `lib/conversations/types.ts`
- `lib/ai/prompts/catalog.ts`
- `app/api/public/channels/evolution/[connectionId]/webhook/route.ts`
- `app/api/public/channels/evolution/[connectionId]/ai-reply/route.ts`
- `hooks/useSystemNotifications.ts`
- `components/notifications/NotificationPopover.tsx`
- `features/platform/tenants/TenantConversationsPage.tsx`
- `features/platform/tenants/conversations/ConversationHandoffCard.tsx`
- `features/platform/tenants/conversations/ChannelCalendarSettings.tsx`
- `features/platform/tenants/conversations/WeeklyAvailabilityEditor.tsx`
- `features/platform/tenants/conversations/CalendarBlocksPanel.tsx`
- `supabase/migrations/20260919050000_conversation_meeting_reservation.sql`
- `supabase/migrations/20260919060000_conversation_calendar_blocks.sql`
- `supabase/migrations/20260919061000_conversation_calendar_blocks_grants.sql`
- `supabase/migrations/20260919062000_conversation_meeting_reservation_hardening.sql`
- `supabase/migrations/20260919063000_conversation_ai_rate_limit.sql`

## Evidência TDD e verificação

- RED observado antes da criação de `handoff.ts` e `aiAgentConfig.ts`.
- RED observado antes da persistência de `lastHandoff`.
- RED observado antes do prompt e da integração.
- RED observado antes do contrato 40/60, disponibilidade configurável e reserva transacional.
- RED observado antes de múltiplas faixas, bloqueios, prioridade temporal e regra humana de sábado.
- Regressão global final: 1.184/1.184 testes aprovados em 246 arquivos; 232 testes ignorados por configuração.
- Supabase local do incremento: 9/9 testes aprovados — 4 de RLS/validação A↔B e 5 de reserva (janela 60 min, corrida simultânea, bloqueio manual, ajuste humano atômico e execução anônima negada).
- Suítes focadas do kill switch, configuração da Aurora e agenda aprovadas.
- TypeScript: exit 0.
- ESLint: exit 0.
- `npm run precheck:fast`: exit 0 — 246 arquivos aprovados, 45 skipped; 1.184 testes aprovados, 232 skipped. A suíte registrou ruído `ECONNREFUSED localhost:3000` de testes sem servidor local, sem falha no portão.
- `next build --webpack`: compilação aprovada; o typecheck gerado pelo Next parou em quatro erros preexistentes fora do lote (`deal-cockpit-mock`, `pipeline`, `join` e export extra na rota de automações).

## Segurança deste lote

- Sem dependência nova.
- Cinco migrations novas, aplicadas somente no Supabase local: reserva atômica, tabela de bloqueios, privilégios explícitos, endurecimento da reserva/bloqueios e rate limit distribuído.
- Sem credencial nova ou segredo no código.
- Saída do LLM validada por Zod; o modelo não recebe ferramenta nem grava diretamente no banco.
- Horários oferecidos são calculados no servidor; a reserva revalida o slot e executa por RPC restrita ao `service_role`.
- Texto limitado antes de persistir em notificação/metadata.
- Queries de thread e notificação mantêm `organization_id`.
- Falha ao gravar a notificação não repete a mensagem enviada; vira warning operacional.
- Apenas o Supabase local em `127.0.0.1:54321` foi chamado; nenhum banco remoto, IA ou WhatsApp real foi acionado.
- O Codex Security revisou os 49 arquivos do snapshot e encontrou um achado low no kill switch da rota externa; o controle foi aplicado na rota e no executor, com três testes de regressão aprovados.
- O primeiro baseline canônico terminou inválido/fail-closed porque foi executado no WSL sem acesso ao Docker Desktop; ele foi descartado.
- A repetição pelo Git Bash do Windows gerou `status.json` com `execution_ok=true`: npm audit 0 vulnerabilidades, Semgrep 1.170.1 com 0 achados e Gitleaks v8.30.1 com 0 achados na árvore e no histórico. É baseline parcial e não prova todos os gates manuais.
- A migration de rate limit passou no `supabase db lint --local --level error`; no banco local, duas chamadas foram permitidas e a terceira foi bloqueada na mesma janela.
- O papel `anon` recebeu `permission denied` ao tentar chamar a RPC de rate limit; `service_role` executou a mesma função com sucesso.

## Limites

- A notificação funciona com o CRM aberto ou com a aba em segundo plano; push com navegador/app totalmente fechado ainda não existe.
- Integração com Google Agenda ou Microsoft 365 continua fora deste lote; a fonte atual é a agenda interna do CRM.
- A migration foi aplicada somente ao Supabase local; nenhum banco remoto recebeu a função.
- A conexão real da CENNO ainda não recebeu o nome/prompt da Aurora.
- A flag `ai_conversation_auto_reply` da organização precisa ser ativada explicitamente junto da conexão e da IA da organização; enquanto qualquer um dos três gates estiver desligado, nenhuma resposta é gerada ou enviada.
- Nenhuma mudança foi aplicada à produção ou ao WhatsApp real; a publicação seguinte deste branch é limitada ao preview isolado.

## Preview (19/09, noite) — publicado pelo Claude

- Branch `feat/aurora-implantacao` no GitHub: `1b7ce22` (lote revisado; vitest 1184/1184, eslint 0, tsc 0) e `4f290ec` (gatilho da prévia).
- Vercel: 9 variáveis de Preview restritas à branch, apontando para o Supabase de preview `zvwngsrflkicbbzfmrgy` (`AUTOMATION_LIVE_SENDS_ENABLED=false`).
- Deploy pela CLI **não recebe** as variáveis por branch: o bundle saiu apontando para produção e o deploy foi removido. A prévia válida nasceu do push: `dpl_CLfSQf8BfpifAY2soYNKtswYtdx1` (`basecrm-60s9fjcvw…`); `teste.crm.basea2.com` aponta para ela. Prova: o JS servido referencia só `zvw`, nenhuma vez `eqid`.
- Migrations no preview via `supabase db push --linked`: 3 pendentes da `main` (`20260916000000`, `20260916010000`, `20260917000000`) + 5 da Aurora; ledger em `20260919063000`; RPCs, triggers e tabelas conferidas no catálogo.
- Banco de preview: organização de teste da agência (`bd43a9bc…`) com chave do Gemini e modelo `gemini-3-flash-preview`; conexão de teste `Aurora (teste)` (`ec659bef-a093-4232-a8c7-db194c8ca493`, instância `aurora-teste-3e146689`, **IA desligada**, nome e prompt da Aurora, agenda seg–sex 09:00–19:00 com o Junior como responsável). Os três gates seguem desligados até a janela do teste.
- Sondas no domínio de teste: webhook sem segredo 401, segredo errado 401, id inexistente 404, ai-reply sem segredo 401.
- Falta: parear o WhatsApp Business do Junior na conexão de teste (QR pela tela), ligar os três gates só durante o teste, rodar o roteiro ponta a ponta e o adversarial, desligar os gates.
- Produção intocada: `crm.basea2.com` segue em `a792399`; nenhuma migration em produção; número da campanha e Pandora não foram tocados.

## Ajustes do Junior (20/09) — aplicados pelo Claude

Origem: 1ª rodada no preview (20/09, 00h20). Junior ditou: nome e concordância só de vez em quando (cara de bot e "puxa-saquismo"), 2 horários em vez de 3 e, na recusa, "manhã ou tarde?" + "terça funciona para você?" (dia seguinte), nunca oferecer ligação (é follow-up humano; a intenção é sempre a reunião), cutucada aos 15 minutos em vez de 90 s e fora do módulo de follow-up.

- **Prompt** (`lib/ai/prompts/catalog.ts`): regras de nome/concordância/"bora"; seção "OBJETIVO E REUNIAO" (quem conduz é `{{meetingHostName}}`, a Aurora não participa; máximo 2 horários; recusa → manhã/tarde e dia seguinte pelo nome; ligação só se o lead pedir → `call_accepted`); `{{currentDateTimeLocal}}` (data local com dia da semana) ao lado do UTC.
- **Contexto do prompt** (`lib/conversations/aiPromptContext.ts` + `aiReply.ts`): `formatLocalDateTimeForPrompt` e `meetingHostName` (nome configurado no número `config.meetingHostName` > nome do responsável da agenda > "a equipe comercial"; perfil só com e-mail nunca expõe o login).
- **Cutucada de inatividade** (`lib/conversations/idleNudge.ts`, `idleNudgeRunner.ts`): o webhook só agenda (`aiInactivityNudgeDueAt`, 15 min por padrão, por número em `config.aiIdleNudge`); o tick de 5 min envia as vencidas com reivindicação atômica (token + `lastDirection=outbound` + `status=ai_active`), pela mesma esteira `executeConversationAIReply` (`automation_source=native_crm_idle_nudge`). O bloco de `sleep(90_000)` do webhook foi removido. O tick não derruba se a cutucada falhar; resumo em `idleNudges` na resposta.
- **PATCH da conexão**: aceita `aiIdleNudge` (parcial, completa com o atual/padrão) e `meetingHostName`.
- **Testes**: 36 novos (config, agendamento, runner com cliente falso, webhook só agenda, PATCH, prompt, tick em ordem e blindado). Suíte completa: 251 arquivos / 1220 testes aprovados, 45/232 pulados; `tsc --noEmit` 0; ESLint 0.
- **Preview** (banco `zvw`, conexão "Aurora (teste)"): bloqueio de almoço 12:00–13:00 seg–sex criado; `meetingHostName=Junior` gravado. Gates continuam desligados.
- **Fora deste lote**: agenda visual (Junior perguntou se não é melhor espelhar o Google Agenda via OAuth; proposta registrada no cérebro, aguarda o "vai").

## Encerramento depois do handoff (20/09, madrugada) — Claude

Decisão do Junior: nunca deixar o lead no vácuo; sempre encerrar; se o lead mandar mais alguma mensagem, responder, agradecer e encerrar, sem corte seco e sem prolongar.

- `lib/conversations/closingReply.ts`: `resolveClosingReplyEligibility` (só `human_queue`; handoff da própria IA, provado por `handoffRequestedAt` = `lastHandoff.requestedAt`; nunca em falha da IA; janela de 60 min; máximo 2 respostas via `aiClosingReplies`), `buildClosingStageContext` (situação por tipo de handoff, com data local, quem conduz e formato), `readMeetingChannelText` (`config.meetingChannelText`).
- `aiReply.ts`: `generateConversationAutoReply({ closing })` injeta `{{conversationStageContext}}` e `{{meetingChannelText}}` (prefixo `SITUACAO DA CONVERSA:` quando o prompt não tem o marcador), pula a política de reunião e zera handoff; `executeConversationAIReply({ closingReply })` passa em `human_queue`, nunca em `human_active`, não abre handoff, mantém a conversa na fila com travas e não lidas como estavam e conta a resposta.
- Webhook: inbound em `human_queue` elegível agenda `processDeferredAIReply({ closingReply: true })`; a elegibilidade é re-checada com a metadata fresca depois do debounce; falha de geração em encerramento não vira alerta nem n8n. A cutucada não é agendada (status ≠ `ai_active`).
- Prompt da Aurora: regra da mensagem de confirmação (dia/hora, quem conduz, formato, agradecimento, nunca dizer que estará na reunião) e seção ENCERRAMENTO.
- PATCH da conexão: `meetingChannelText` (≤200).
- Testes: `closingReply.test.ts` (7), `webhook/route.closing.test.ts` (4), contrato estático `test/auroraClosingContract.test.ts` (3), prompt e PATCH ampliados. Focados 53/53; `tsc` 0; ESLint 0; suíte completa e revisão adversarial (workflow de 4 lentes + refutadores) registradas abaixo quando terminarem.
- Decisão da agenda (20/09): opção B — grade no CRM (clínica) + espelho do Google Agenda via OAuth (CENNO); lotes seguintes.

### Revisão adversarial do encerramento (workflow de 4 lentes + 2 refutadores por achado) e correções

Achados **confirmados** pelos refutadores e corrigidos antes do push:

- **Humano assume/resolve/devolve durante a geração** (alta): o executor só checava o status uma vez e a gravação final forçava `human_queue`, desfazendo a ação humana. Correção: a resposta de encerramento é **reivindicada de forma atômica antes do envio** (`UPDATE ... WHERE status='human_queue' AND metadata->>aiClosingReplies = <valor lido>`, com `select('id')`); reivindicação vazia = nada enviado (`closing_claimed`); a gravação final também é condicional ao status (`.eq('status','human_queue')`) e, se o estado mudou no meio do envio, o estado do humano fica.
- **Limite de 2 respostas não atômico** com mensagens sobrepostas (alta): coberto pela mesma reivindicação (compare-and-set no contador).
- **Marca `closingReply` congelada no inbound** (média): se um humano devolvesse a conversa para a IA nos 7 s de debounce, a mensagem ficava sem resposta. Correção: `processDeferredAIReply` decide pelo **estado fresco** (`ai_active` → resposta normal; `human_queue` elegível → encerramento; senão silêncio); o parâmetro sumiu.
- **Vazamento para prompts sem a seção** (Julia, overrides antigos) (alta): o encerramento agora só vale para prompt que tem `{{conversationStageContext}}` (regex tolerante a espaços); sem o marcador a geração devolve `closing_unsupported` e o webhook silencia sem alerta. O prefixo `SITUACAO DA CONVERSA:` foi removido.
- **Texto padrão do formato** lido como "formato: o formato…" (média): padrão virou "a combinar por aqui antes do horário" e o prompt diz "o formato da reuniao (...)".
- O executor também **re-checa a elegibilidade** (janela de 60 min, limite, handoff humano, falha da IA) no estado fresco antes de reivindicar.

Aceitos como limite conhecido (baixa): o texto livre do modelo em encerramento não é validado contra promessa de reagendar (só instrução de prompt; o handoff estrutural está bloqueado); falha de entrega da cutucada de encerramento mantém o contador incrementado (conservador: menos mensagens, não mais).

Achado da 2ª janela (04h10): lead que volta depois de reunião confirmada fazia a Aurora reofertar horários e, no resumo, ela inventou "via Google Meet". Correção: `buildConfirmedMeetingStageContext` (situação REUNIAO JA CONFIRMADA quando há `lastHandoff` `meeting_confirmed` futuro) e o formato da reunião vem de `meetingChannelText`, nunca do modelo. E às 04h17, domingo de madrugada, "amanhã, segunda-feira" estava certo mas confundiu o Junior: regra nova no prompt — citar dia da semana + data e evitar "hoje/amanhã" entre 0h e 6h.

- **Saida estruturada do Gemini (04h17, 2a janela):** `AI_NoObjectGeneratedError: could not parse the response` na mensagem "mas amanha e domingo" -> fila humana. Correcao: `lib/conversations/aiOutputRepair.ts` recorta o objeto do texto cru (cerca de markdown, raciocinio em volta) e valida no schema; se nao der, **segunda geracao**; so a segunda falha vira falha de provedor. O texto cru (160 caracteres) passa a ser gravado em `aiFailureError` para diagnostico.
- **Regra do dia no prompt (Junior):** "tenho segunda-feira as 9h ou as 10h"; "amanha" so quando o dia seguinte for dia util e a conversa estiver em horario comercial; de madrugada ou fim de semana, so o nome do dia.
- Suite completa final: 255 arquivos / 1244 testes aprovados; tsc 0; eslint 0.

### Janela 2 contra o build `1a0fcfc` + Claude Sonnet 5 (04h34–04h40) e o retorno do Junior

- Funcionou: dia pelo nome com 2 horarios ("Terca-feira, dia 22, 09h ou 10h"); recusa da manha → "Terca a tarde: 13h ou 14h"; "so umas 6 horas" → **confirmou 22/09 18h** com formato + quem conduz; "vai ser aqui no whatsapp?" ja na fila humana → **encerramento respondeu** e a conversa continuou na fila (`aiClosingReplies=1`, nao lida preservada); reuniao `d55d4b50…` reservada; sem falha de geracao no Sonnet 5; tick 200.
- **Retorno do Junior: "esse final ficou pessimo — cortou o lead, e nem especificou como funciona".** Causa: instrucao "encerre" lida como corte ("Obrigada, Junior te vejo terca!") e `meetingChannelText` no padrao vago. Correcao: situacao de encerramento/confirmacao passa a trazer **como funciona** (≈40 min, quem conduz, o que acontece, formato), resposta completa e concreta em 2–3 frases, fechamento com porta aberta ("qualquer duvida ate la, me chama por aqui"), proibido "te vejo/nos vemos"; a 2a resposta e a despedida suave. **Pendente do Junior:** o formato real da reuniao para gravar em `config.meetingChannelText`.
- **Defeito novo:** duas mensagens do lead com 9 s de intervalo (fora do debounce de 7 s) geraram duas respostas, a primeira obsoleta. Correcao: antes de enviar, o webhook rele `aiPendingToken`; se mudou (chegou mensagem nova durante a geracao), a resposta e descartada e a geracao da mensagem nova responde com o contexto completo. Teste em `route.idleNudge.test.ts`.

### Coleta de dados do lead e confirmacao no modelo do Junior (04h45–04h55)

- Junior: reuniao e **Google Meet**, link pelo WhatsApp minutinhos antes (gravado em `config.meetingChannelText` do numero de teste); antes de fechar, ter **telefone, e-mail e nicho**, com o nicho fluindo no diagnostico (nao no fim); confirmacao no modelo dele ("Perfeito, fulano, nossa reuniao esta marcada para ... nosso especialista Junior vai conduzir seu diagnostico ... te envio o link aqui no WhatsApp minutinhos antes. Mais alguma duvida?"). A frase "ja enviamos a confirmacao por e-mail" fica fora ate existir: com o Google Agenda (lote B) o convite por e-mail com o link do Meet sai automaticamente.
- `lib/conversations/leadProfile.ts`: `normalizeLeadEmail`, `normalizeLeadSegment`, `buildContactProfileUpdate` (e-mail so se o contato nao tem; `Segmento: X` nas notas, uma vez). Schema de saida ganhou `leadEmail` e `leadSegment`; o executor grava no contato depois de enviar (falha vira aviso).
- Prompt: nicho no inicio do diagnostico; antes de confirmar, so o que faltar (e-mail e confirmacao do WhatsApp), sem travar se o lead nao quiser dar o e-mail; modelo de confirmacao; `leadEmail`/`leadSegment` no retorno.
- Suite completa no estado final: 256 arquivos / 1248 testes; tsc 0; eslint 0.

## Lote de ajustes depois da janela 3 (21/09, madrugada) — Claude

Base: `693c02f`. Aprovação do Junior: "pode seguir com todos os ajustes" (21/09 ~02h14), depois de responder às pendências da janela 3.

- **Janela 3 (21/09 01h19–01h51, Sonnet 5, gates desligados ao fim, medido):** provou 12h bloqueado, sábado para confirmação humana, encerramento 2 de 2 com silêncio na 3ª, rajadas em 1 resposta, 10 mensagens de ataque de persona/injeção sem vazamento (bateria guardada fora do repo), coleta antes de confirmar até a pergunta do WhatsApp; cutucada vencida com IA desligada foi limpa sem enviar. Não vistos: confirmação no modelo do Junior, "vai ser por onde?", cutucada positiva de 15 min, card no CRM, lead que volta.
- **Prompt (`lib/ai/prompts/catalog.ts`, 9 mudanças por substituição de texto exato):** teto concreto para o nome; "bora" liberado; 4 regras novas (espelhamento, acentuação, sem travessão, retomada variada); exemplos que chegam ao lead acentuados, inclusive o modelo de confirmação; regra do dia com "hoje" e dia do mês; lead que insiste em horário antes do primeiro listado vira `meeting_requested`; `summary` só factual.
- **Não alterado por decisão do Junior:** "(para o convite da reuniao)", "nunca prometa e-mail de confirmacao", regra de concordância e tom.
- **Duas correções de atribuição:** o "enviar o convite" dito pela Aurora na janela 3 repetia a linha do prompt escrita em `693c02f`, não era quebra de regra; o travessão contado como vício dela estava escrito dentro do próprio prompt (removido).
- **Contrato (`catalog.aurora.test.ts`):** 6 asserções trocadas (regra do nome; `"bora"` passa a `not.toContain`; exemplo de terça acentuado; 2 frases do modelo de confirmação acentuadas; regra do dia) e 2 testes novos (lote de 21/09; o que o Junior mandou manter). Nenhuma asserção removida sem substituta.
- **Config do preview (fora do repo, conexão de teste):** `calendar.minimumNoticeMinutes` 60 → 120; `meetingChannelText` com "horário" acentuado. Gravado e lido de volta.
- **Verificação:** contrato 5/5; `tsc` 0; `eslint` 0; suíte completa lida em comando separado: **256 arquivos / 1250 testes aprovados, 0 falhas** (45 arquivos / 232 testes pulados, igual às 8 suítes anteriores da sessão; os 15 `ECONNREFUSED localhost:3000` do log também são idênticos nas 8 anteriores). Diferença contra a última suíte verde: +2 testes, os novos.
- **Fora deste lote, conhecido:** `lib/conversations/closingReply.ts` injeta textos de situação sem acento (a regra de acentuação do prompt cobre o eco); corrida do aceite de horário que cruza com um handoff (437 ms medidos), conserto a decidir; o caminho de escrita de `leadSegment` com valor malicioso não foi exercitado ao vivo (a linha "Segmento:" já existia).
