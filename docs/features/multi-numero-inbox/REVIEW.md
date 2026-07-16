# Multi-número / Caixa unificada — Revisão do Claude

> Revisor: Claude (Opus 4.8). Data: 2026-07-16. Alvo: branch `feat/multi-numero-inbox` @ `47fd3d6` (10 commits sobre `main`=`fd84dff` = E1+E2).
> Método: diff lido arquivo a arquivo + **`npm run precheck:fast` rodado pelo próprio Claude** (não confiei no relatório do Codex).

## Veredito: ✅ APROVADO — pronto pra Junior validar no localhost (1 ajuste cosmético, não bloqueia)

O lote está correto, fail-safe e cobre as 3 peças + a peça transversal do SPEC. Verifiquei a suíte na minha mão e revisei o núcleo linha a linha. **Nenhuma migration, nenhum acesso a prod, nada pushado/deployado** — confere com o IMPL-LOG.

## Verificação independente (Claude)

- **`precheck:fast` na minha máquina:** lint **0**, typecheck **0**, **653 testes passando / 14 skip (667 total), 0 falha**. (Codex relatou 666/1 porque rodou com o Supabase local no ar → os 13 testes de isolamento real rodaram pra ele; sem o banco eles dão skip pra mim. Total idêntico, zero falha nos dois. Os `401` no fim = ruído pré-existente `describe.skip`.)
- Confirmei que `THREAD_SELECT` (`lib/conversations/server.ts:136`) traz `channel_connection_id` → o filtro/selo por número funcionam em runtime (não só no tipo).

## Revisão do diff — correto

| Área | Verificação |
|---|---|
| **E2 intacto** (`scripts/generate-e2-role-permission-defaults.mjs`) | Mudança é **só line-ending** (calcula `\r\n`/`\n` do arquivo e normaliza o snapshot antes de splicar) → evita falso drift no Windows `autocrlf`. **Valores/conteúdo do E2 NÃO mudaram.** Fora do escopo mas legítimo e seguro. ✅ |
| **`createEvolutionInstance`** (`lib/channels/evolution.ts`) | `POST /instance/create` com `{ instanceName, qrcode:true, integration:'WHATSAPP-BAILEYS', groupsIgnore:true, rejectCall:true, alwaysOnline:true }` — bate com a skill evolution-api (R8). Parsing robusto de QR/código (múltiplos formatos de payload). Melhora o erro pra expor a mensagem da Evolution (habilita detecção de duplicidade). ✅ |
| **Connect create-first idempotente** (`connect/route.ts`) | Cria a instância; se sem QR → fallback pareamento; se `create` lança erro de **duplicidade reconhecida** → fallback pareamento; outros erros → propagam (visíveis). Gate subiu p/ `whatsapp.manage_connection`. **Seta o webhook server-side** (usa o `webhookSecret` no servidor, não no browser). ✅ |
| **POST auto-instanceName** (`channels/route.ts`) | `createInstanceName(name)` = slug sem acento + sufixo aleatório de 8. `aiEnabled` default `true`. `webhookSecret` auto (já era). Pede só nome+telefone. ✅ |
| **DELETE (excluir)** (`[connectionId]/route.ts`) | Gate `whatsapp.manage_connection` + `isAllowedOrigin`. Logout Evolution **best-effort** (try/catch→warning, não bloqueia) → `delete` **tenant-scoped**. Conversas preservadas via FK `ON DELETE SET NULL`. ✅ |
| **PATCH parcial (bônus: bug corrigido)** | O PATCH antigo **apagava** `instanceName/apiUrl/webhookUrl` ao editar só um campo (ex.: toggle de IA) — data-loss latente. Reescrito p/ merge parcial de verdade (só mexe no que veio no payload). `aiEnabled` mesclado corretamente. ✅ |
| **Gate de IA por número** (`webhook/route.ts` + `routing.ts`) | `getConversationStatusAfterInbound(status, aiEnabled)`: `aiEnabled===false`→`human_queue` (mantendo human/closed antes). Thread nova em número IA-off nasce `human_queue`; `processDeferredAIReply` tem **curto-circuito** `if (aiEnabled===false) return` no topo; o gate final só roda IA se `threadStatus==='ai_active'`. **Proteção dupla.** `aiEnabled !== false` (default true) → **zero regressão** da Julia atual. ✅ |
| **Redação de segredo** (`publicChannel.ts`) | Agora `apiKey`+`webhookSecret` são **redigidos pra TODO usuário do browser** (inclusive manager) — mais seguro que antes. Expõe `aiEnabled`/`hasApiKey`/`hasWebhookSecret`/`apiKeyLast4`. Atende o requisito do Junior. ✅ |
| **Caixa unificada** (`TenantConversationsPage.tsx`) | `selectedConnectionId` (default 'all', separado do `activeConnectionId` do modal); filtro `thread.channel_connection_id !== selectedConnectionId`; `<select>` "Todos os números" + 1 por conexão, **visível pra todos com Conversas** (não gateado); **selo de origem** por conversa com fallback "Número removido" (trata o SET NULL). Reset a 'all' se a conexão some. ✅ |

## ⚠️ 1 ajuste cosmético (não bloqueia go-live)

- **`getCrmWebhookUrl` (`TenantChannelsPage.tsx:326`) ainda lê `config.webhookSecret` no client** — que agora é redigido. Efeito: o campo "Webhook CRM:" mostra "**-**" pro manager e o card "Copiar URL do webhook" não renderiza. **Não quebra nada** (o connect passou a setar o webhook **automaticamente** no servidor, então ninguém precisa mais colar a URL na mão). Fica só um "-" meio confuso. **Sugestão (E-next):** esconder esse campo ou trocar por "configurado automaticamente ao parear". Se um dia precisar da URL manual de novo, expor via endpoint server-side (nunca reenviar o secret pro browser).

## Impacto no prod (avaliação de risco da aplicação)

**Baixo.** Sem migration, sem mudança de schema (`aiEnabled` mora no `config` jsonb; conexões existentes sem o campo = `aiEnabled !== false` = IA ligada, comportamento atual preservado, sem backfill). Tudo aditivo. Excluir número não apaga conversa.

## Pré-requisito operacional pra validar no localhost

Pra **parear um número de verdade** (não só rodar os testes, que mockam a Evolution), a **credencial global da Evolution da agência** (apiUrl + token) precisa estar configurada e a Evolution acessível. Sem ela, o "Gerar QR" não cria a instância. A UI da tela de Conexões (Painel Agência) tem o campo de credencial global.

## Portão final

Aprovado pra **Junior validar no localhost** (adicionar 2 números, parear, alternar na caixa, testar IA on/off). Depois do OK dele → deploy (FF `feat/multi-numero-inbox`→`main`). Sem deploy até o aval explícito.
