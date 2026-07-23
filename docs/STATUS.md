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
| 3 | `decisions` = protótipo localStorage com ação placebo | UX engana | [modulos.md](./modulos.md) |
| 4 | Custom fields + tags legadas em localStorage | perda de dado entre máquinas | [modulos.md](./modulos.md) |
| 5 | 3 serviços de consentimento LGPD coexistindo | manutenção | [arquitetura/camada-de-dados.md](./arquitetura/camada-de-dados.md) |
| 6 | Duplicatas V1/V2 (modais, cockpit, rotas whatsapp/inbox) | confusão de dev | [modulos.md](./modulos.md) · [arquitetura/rotas-e-navegacao.md](./arquitetura/rotas-e-navegacao.md) |
| 7 | **P1 — RPCs legadas** (corrigido pelo parecer do Codex): `get_contact_stage_counts()` legado é SECURITY DEFINER sem filtro de tenant e precisa ser removido/substituído; o método parametrizado do serviço tem assinatura inválida mas está ÓRFÃO — a tela conta no cliente via `getAll(orgId)` e fica limitada aos primeiros 10 mil contatos (`limit(10000)`). `get_dashboard_stats` é PIOR: agrega métricas financeiras de todas as orgs (`[Inferred]` do SQL/grant; prova PostgREST vira o 1º teste do hotfix). Fix: migration removendo as duas + versão org-filtrada SECURITY INVOKER + prova dois-tenants. | **hotfix nº 1** | [REVIEW-OPINIAO-PENTE-FINO.md](./REVIEW-OPINIAO-PENTE-FINO.md) |
| 7b | **P2 — 4 rotas de canal devolvem `config` cru** (com `webhookSecret`/`apiKey`) a gestores, em sucesso E erro: connect, healthcheck, disconnect, send-test — sem `toPublicChannelConnection`. "Webhook CRM: -" é consequência da redação correta na LISTA; corrigir os DTOs ANTES do visual. | **hotfix nº 2** | idem |
| 7c | **P2 — origem do lead com duas verdades**: C2 grava histórico auditável por UUID, mas Visão Geral ainda agrupa `contacts.source` por TEXTO (com fallback de texto livre no form de contato). Rotular/corrigir antes de vender o painel como auditável — gate do deploy C2. | gate do deploy | idem |
| 7d | **P2 — call-list descarta o resultado**: o modal coleta outcome/duração/notas e `CallListPage:69-73` joga fora; "Feita" conclui sem registrar o que houve. O núcleo "registrar contato em 1 toque" do conceito da secretária não foi entregue. | correção operacional | idem |
| 8 | `smoke:integrations` aponta pra script inexistente | gate quebrado | [arquitetura/apis-e-integracoes.md](./arquitetura/apis-e-integracoes.md) |
| 9 | Módulos sem teste: activities, dashboard, cockpit, decisions, ai-hub, profile | regressão silenciosa | [modulos.md](./modulos.md) |
| 10 | `products`/`lifecycleStages` com fonte de dado dupla | divergência de estado | [arquitetura/camada-de-dados.md](./arquitetura/camada-de-dados.md) |
| 11 | Docs da era março defasados (termo antigo, pré-sweep) + candidatos a `docs/arquivo/` | dev novo lê coisa errada | [historia-e-origens.md](./historia-e-origens.md) |

## Baseline de qualidade

`test:local` = **888/888** (2026-07-23) · lint `--max-warnings 0` · tsc strict.
Histórico em [operacao/testes-e-gates.md](./operacao/testes-e-gates.md).
