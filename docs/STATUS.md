# STATUS — matriz viva do sistema

> Parte da documentação-mãe. Índice em [README.md](./README.md).
> **Este arquivo se atualiza a cada fatia entregue.** Última revisão: 2026-07-23
> (branch `feat/funil-construtor`; produção = `main` @ 34 migrations).
>
> Legenda: 🟢 pronto e testado · 🟡 funciona com ressalvas · 🟠 parcial/em obra ·
> 🔴 protótipo ou quebrado · ⬜ ainda não construído

## Módulos de produto

| Módulo | Estado | Em produção? | Ressalvas |
|---|---|---|---|
| Boards (Kanban) | 🟡 | sim | cobertura de teste fraca; botão Edit sem handler no modal; custom fields em localStorage; CreateDealModal V1/V2 |
| Contatos | 🟡 | sim | ContactFormModal V1/V2 duplicados |
| Conversas (WhatsApp) | 🟡 | sim | "Gravar áudio" não implementado; auto-reply da IA envia REAL (ver visão-geral) |
| Atividades | 🟡 | sim | sem nenhum teste; FormModal V1/V2 |
| Tarefas | 🟢 | sim | — |
| Atendimentos | 🟢 | sim | — |
| Hoje (call-list) | 🟢 | sim | — |
| Relatórios (financeiro/profissionais) | 🟢 | sim | — |
| Visão Geral | 🟢 | sim | — |
| Dashboard (rota de aterrissagem) | 🟡 | sim | sem testes; TODO de refactor em métrica |
| Configurações (RBAC, catálogos, financeiro) | 🟡 | sim | custom fields + tags legadas em localStorage (saem com deploy da C2) |
| Configurações → Etiquetas (C2C) | 🟢 | **não** (branch) | aguardando aceite do Junior + revisão Codex |
| Etiquetas/Origem no lead (C2C) | 🟢 | **não** (branch) | idem |
| Construtor de automações | 🟢 | **não** (branch) | fatias A→C2C prontas; C2D/C3 pendentes |
| Inbox (central por negócio) | 🟡 | sim | cobertura de teste fraca |
| Agenda (Clinicorp) | 🟠 | sim | sem item de menu; `book` cria AO VIVO no Clinicorp |
| Cockpit do negócio | 🟠 | sim | duas versões em transição (cockpit vs cockpit-v2); sem testes |
| Plataforma (agência/tenants) | 🟡 | sim | REST-based; provisioning wizard |
| Decisions (fila de decisões) | 🔴 | sim (oculto) | protótipo local NÃO tenantizado; a UI dispara mutações reais SEM await e pode marcar falha como aprovada (parecer Codex §3.3). Quarentenar; NÃO absorver na C2D |
| AI Hub (chat com tools) | 🟠 | sim (sem menu) | execução das tools fora da pasta; sem testes |
| Perfil | 🟢 | sim | — |
| Instalador self-host | 🟠 | sim | não exercitado recentemente (não verificado) |

## Motor de automação (branch, tudo em simulação)

| Peça | Estado | Prova |
|---|---|---|
| Authoring + builder (F1/F6) | 🟢 | `test:local` |
| Publicação imutável (F2) | 🟢 | idem |
| Outbox + scheduler pg_cron (F3/F4) | 🟢 | `automation_tick_health` + testes |
| Waits + takeover humano (F5) | 🟢 | idem |
| Switch N-ário (C1A) | 🟢 | idem |
| Tela do builder (C1B/C1C) | 🟢 | 9+ defeitos de uso corrigidos ao vivo |
| Taxonomia de etiquetas + RLS lead_sources (C2A) | 🟢 | 848/848 |
| Roteamento por esfriamento + porteiro (C2B) | 🟢 | 888/888 |
| Telas de etiqueta (C2C) | 🟢 | 888/888 · em aceite pelo Junior |
| Tarefas/mover etapa + observabilidade (C2D) | ⬜ | próxima fatia |
| Mídia (bucket + worker ffmpeg) + lifecycle tenant (C3) | ⬜ | depois |
| **Envio real de WhatsApp pelo funil** | ⬜ | `automation_live_enabled=false` + gate de saúde |

## Dívidas técnicas priorizadas

| # | Dívida | Risco | Onde documentada |
|---|---|---|---|
| 1 | RLS de `lead_sources` permissiva EM PRODUÇÃO (corrigida só na branch) | segurança (baixa exposição) | [operacao/deploy-e-producao.md](./operacao/deploy-e-producao.md) |
| 2 | Auto-reply da IA fora da trava de simulação (chave separada) | consciência operacional | [arquitetura/visao-geral.md](./arquitetura/visao-geral.md) |
| 3 | `decisions` QUARENTENADO em `b693d63` (rota redireciona pra /visao-geral; código preservado, NÃO absorver na C2D — dispara mutações sem await e marca falha como aprovado) | mitigada (quarentena) | [modulos.md](./modulos.md) |
| 4 | Custom fields + tags legadas em localStorage | perda de dado entre máquinas | [modulos.md](./modulos.md) |
| 5 | 3 serviços de consentimento LGPD coexistindo | manutenção | [arquitetura/camada-de-dados.md](./arquitetura/camada-de-dados.md) |
| 6 | Duplicatas V1/V2 (modais, cockpit, rotas whatsapp/inbox) | confusão de dev | [modulos.md](./modulos.md) · [arquitetura/rotas-e-navegacao.md](./arquitetura/rotas-e-navegacao.md) |
| 7 | ✅ **RESOLVIDA (hotfix `bf8f9df`, 2026-07-23)** — P1 RPCs legadas: `get_contact_stage_counts()` e `get_dashboard_stats()` zero-arg REMOVIDAS (revoke+drop sem CASCADE); criada `get_contact_stage_counts(p_organization_id)` SECURITY INVOKER com recusa `42501` (org nula/anon/cross-tenant), grant só `authenticated`; serviço exige org, hook usa a RPC (fim do `limit(10000)` no browser). Prova PostgREST 2-tenants em `test/contactStageCountsSecurity.local.test.ts`. Adjudicado em [REVIEW-HOTFIX-SEGURANCA.md](./REVIEW-HOTFIX-SEGURANCA.md). | resolvida | [REVIEW-OPINIAO-PENTE-FINO.md](./REVIEW-OPINIAO-PENTE-FINO.md) |
| 7b | ✅ **RESOLVIDA (hotfix `c036fb8`, 2026-07-23)** — P2 rotas de canal: connect/healthcheck/disconnect/send-test não devolvem mais `channel`/`config` cru (sucesso E erro); redação de `apiKey`/`webhookSecret` (literal, URL-encoded e atribuição JSON) via `lib/channels/redactChannelSecrets.ts`; payloads do provedor sanitizados ANTES de persistir em `metadata`; `toPublicChannelConnection` sanitiza `config` E `metadata`. Provado que nenhum cliente lia `channel` das 4 actions. "Webhook CRM: -" na UI agora pode ser tratado (trilho meu). | resolvida | idem |
| 7c | **P2 — origem do lead com duas verdades**: C2 grava histórico auditável por UUID, mas Visão Geral ainda agrupa `contacts.source` por TEXTO (com fallback de texto livre no form de contato). Rotular/corrigir antes de vender o painel como auditável — gate do deploy C2. | gate do deploy | idem |
| 7d | ✅ **RESOLVIDA (`b693d63`, 2026-07-23)** — call-list agora PERSISTE o resultado do modal: `handleSaveCallResult` grava outcome/duração/notas em `activity.description` ou `task.note` e conclui; guardrail "não move deal" mantido; 2 testes de regressão. | resolvida | idem |
| 8 | ✅ **RESOLVIDA (`b693d63`, 2026-07-23)** — smoke resgatado de `3c99d29` em `test/integration/smoke-integrations.mjs` com trava anti-produção (loopback-only + recusa ref do projeto prod); `package.json` atualizado. | resolvida | [arquitetura/apis-e-integracoes.md](./arquitetura/apis-e-integracoes.md) |
| 9 | Módulos sem teste: activities, dashboard, cockpit, decisions, ai-hub, profile | regressão silenciosa | [modulos.md](./modulos.md) |
| 10 | `products`/`lifecycleStages` com fonte de dado dupla | divergência de estado | [arquitetura/camada-de-dados.md](./arquitetura/camada-de-dados.md) |
| 11 | Docs da era março defasados (termo antigo, pré-sweep) + candidatos a `docs/arquivo/` | dev novo lê coisa errada | [historia-e-origens.md](./historia-e-origens.md) |
| 12 | Rename `lifecycle_stages` **MQL→"Qualificado"** aplicado só no banco LOCAL (2026-07-24, decisão de nomenclatura neutra); o deploy precisa da mesma correção via migration de dado (domínio Codex, junto do gate C2) | rótulo técnico volta em produção | [decisoes.md](./decisoes.md) |

## Baseline de qualidade

`test:local` = **968/968** (207 arquivos, 2026-07-27 — inclui Reforma 2 do construtor, módulo de remuneração por vigência, catálogos de cargo/especialidade, várias especialidades por funcionário, comissão dentro da ficha da pessoa, procedimento por especialidade e ações em massa nas chaves) · lint `--max-warnings 0` · tsc strict.
Histórico em [operacao/testes-e-gates.md](./operacao/testes-e-gates.md).
