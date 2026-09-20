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
