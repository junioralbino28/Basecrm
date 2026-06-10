# Adendo ao Plano v1 — Design System + Features nascidas no mockup aprovado

> **Complementa** `2026-06-09-basecrm-v1-motor-vitoria.md` (9 fases, 72 tasks). NÃO substitui nada — adiciona o que o loop de mockups (2026-06-10, aprovado pelo Junior) criou além do plano.
> **Mockup aprovado (fonte da verdade visual):** `WorkSync/workspaces/Dra Jessica Barros/08-sistema-central/mockup-recepcao/index.html` (+ screenshots-v2/). Método de execução: o mesmo do plano (TDD, bite-sized, playbook 6 etapas, DoD).

## Estratégia de entrega (regra do Junior: zero deploy de ajuste)

- **Branch única de provisionamento: `feat/v1-provisionamento`** — TODO o build (fases do plano + este adendo) acontece nela. Merge na `main` + deploy Vercel **uma vez**, quando o Junior aprovar o conjunto rodando localmente.
- Migrações de banco: aplicar no `nossocrmv3` conforme as fases avançam (banco é compartilhado com prod, mas as tabelas novas são aditivas e RLS'd — não afetam o app antigo em produção).
- Critério de sucesso do provisionamento (linguagem natural): *"abro o sistema local com o usuário da Vitória e ele é o mockup funcionando de verdade: Hoje com call-list real, agendar pela agenda, registrar atendimento com recebido/desconto, tarefas com lembrete Julia-first, conversas estilo WhatsApp; com o usuário do Adel vejo Financeiro com líquido real e Profissionais com comissão."*

## Fase D — Design System (ANTES de qualquer tela nova; F3+ nascem com a cara certa)

**Files:** `app/globals.css` (Tailwind v4 `@theme`) · `tailwind.config.js` · `app/layout.tsx` (next/font) · `components/Layout.tsx` (shell)

1. **Tokens**: portar a paleta do mockup pro `@theme` — `brand` (50:#eaf4f0 100:#cfe7df 200:#a6d3c6 **300:#5fd0b6 ← DEFINIR (bug 2× no mockup: tom usado e inexistente)** 500:#1a9b82 600:#0e7d69 700:#0b6354 800:#0a4f43 900:#083d34), `gold` (50:#f6efe1 100:#ecdfc4 500:#b0883f 600:#946b2c 700:#7c5a23), `wa` #1fa855, e os semânticos canvas/card/surface/line/ink/muted/faint com os valores light/dark do mockup (`:root`/`html.dark`). Matar a paleta `primary` azul-céu (mapear usos existentes → brand) — **grep antes, migração mecânica com teste visual por tela**.
2. **Tipografia**: Fraunces (serif, títulos) + Plus Jakarta Sans (corpo) via `next/font/google`; remover Inter/Space Grotesk/Cinzel.
3. **Tema padrão**: usuários de clínica nascem no claro (mockup é light-first; dark continua disponível) — ajustar default de `user_settings.dark_mode` no provisionamento do tenant e o fallback do ThemeProvider pra roles de clínica.
4. **Shell**: sidebar/topbar do workspace clínica seguem o mockup (grupos "Clínica · Adel" e "Agência" por role, item ativo `bg-brand-50 text-brand-700`, avatar do usuário no rodapé). Reusar `components/Layout.tsx` existente — é re-estilização, não rewrite.
5. Gate: typecheck+lint+build + smoke visual nas telas existentes (boards/contatos/settings) nos 2 temas.

## Mapa mockup → plano (o que JÁ estava coberto)

| Tela do mockup | Fase do plano | Ajustes vindos do mockup |
|---|---|---|
| Hoje / call-list ("Seguir hoje" + badges F1-F9 + Ligar/WhatsApp) | F6 | + lembretes vencendo hoje entram na lista (ver N2) |
| Registrar atendimento (drawer) | F4 | + campos `desconto` (já anotado) e **total a receber** calculado; toggle "recebido" = `paid_at` |
| Agenda (dia + horários livres + drawer agendar) | F7 | layout do mockup; "Lembrar" no sem-confirmação dispara msg |
| Financeiro (P&L cascata + taxas + contas fixas) | F5+F8 | + **donut "pra onde vai o dinheiro"** + **barras "recebido por semana"** (recharts; RPCs do F8 já retornam os agregados) + export PDF (estender `features/reports/utils/generateReportPDF.ts`) |
| Profissionais (tabela + matriz comissão) | F3+F5+F8 | + **paga vs a pagar com ação "pagar"** → tabela nova `commission_payments` (org_id, professional_id, amount, paid_at, period) — alimenta o "Paga/A pagar" |
| Visão Geral (KPIs + funil + origem) | F8 (parcial) | ver N5 — leitura inteligente é workstream novo |

## Workstreams NOVOS (não existiam no plano)

### N1 — Origens de lead editáveis
Tabela `lead_sources` (id, organization_id, name, active; RLS select `can_access`, mutate `can_operate`) + seed das padrão (Anúncio Meta, Instagram, Indicação, Google/GMN) no provisionamento + select de origem no form de contato/lead + agregação por origem na Visão Geral. **v1** (pequeno, e o Adel pediu na prática).

### N2 — Tarefas & lembretes (o maior; núcleo novo)
- Tabela `tasks` (id, organization_id, contact_id nullable, type `call|reminder|message`, title, note, due_date, due_time nullable, status `open|done|snoozed`, julia_first boolean, created_by, completed_at; RLS operate). Índice (organization_id, due_date, status).
- Preferência de contato: coluna `contacts.contact_preference` (`any|whatsapp_only`) — **call-list EXCLUI whatsapp_only** e a ficha mostra o badge.
- Anotações de ligação: usar `activities` (type CALL) com `description` = nota + resultado (`atendeu|nao_atendeu|ligar_depois|so_whatsapp`) em campo/convention — "ligar_depois" cria task nova com hora; "so_whatsapp" seta a preferência.
- **Automação Julia-first (o squad-keeper em miniatura):** na due_date, job manda a msg via Evolution (template por tipo) → cron (Vercel cron ou n8n, decidir na task) verifica resposta em 24h → sem resposta = task vira `call` e entra na call-list. **v1 com escopo honesto:** criação+listas+done+preferência+notas = v1; a automação Julia-first entra atrás de flag e pode ser operada manualmente no início (guardrail: caminho manual sempre funciona).
- Auto-lembrete pós-atendimento ("manutenção 6 meses") = regra opcional na F4 (checkbox no registrar) — v1.1 se apertar.
- UI: tela Tarefas (Vence hoje/Próximas) + drawer Nova tarefa + integração no "Seguir hoje" — mirror do mockup.

### N3 — Nudge pop-up de tarefas
`organization_settings` ganha `task_nudge_interval_minutes` (null=off; 15/30/60) — **editável só por `can_configure`** (UI admin). Componente client no workspace clínica: timer + busca tasks abertas do dia + card (mirror mockup: Ver tarefas/+30min/X). Snooze = estado local. **v1** (pequeno e é adoção).

### N4 — Conversas estilo WhatsApp + mídia + áudio
- Re-layout do Inbox existente (`features/inbox/`) pro 2-painéis do mockup (lista c/ pills Tudo/Não lidas/Julia · chat c/ bolhas/check-check · header Ficha do paciente + Devolver pra Julia — handoff já existe no modelo `ai_active/human_*`).
- **Enviar arquivo/imagem**: upload → storage bucket por tenant (⚠️ resolver junto o follow-up de segurança do bucket `deal-files` — mesmo hardening) → Evolution `sendMedia`. **Enviar áudio**: MediaRecorder no browser → Evolution (endpoint de áudio/ptt). Bolhas de mídia (player de áudio, doc com download) — mirror mockup.
- "Script da cadência" no menu de anexo: lê os `quick_scripts` existentes (tabela já existe!) com os textos F1-F9. **v1**: layout+texto+mídia receber/enviar; áudio gravado pode escorregar pra v1.1 se o MediaRecorder+Evolution der atrito (decidir na execução, não travar a entrega).

### N5 — Visão Geral + leitura inteligente
- KPIs + funil do mês + origem (RPCs F8 estendidos) + **Leads por dia** (recharts area).
- **Leads parados por etapa**: query `deals`/`contacts` sem atividade há N dias por stage (usar `last_stage_change_date` que já existe em deals) + CTA "mandar pra fila" (cria tasks em lote).
- **Notas de atenção**: regras determinísticas v1 (sem resposta 48h+; faltas sem remarcação; orçamentos abertos = deals em estágio orçamento há X dias; horários livres amanhã via cache da agenda) com botão "resolver" → ação concreta (criar tasks/cadência).
- **Insights da Julia**: **v1.1** (gerados por IA semanalmente sobre os agregados; v1 mostra o card com insights determinísticos simples ou oculto atrás de flag).

### N6 — Funil follow-up F1–F9
Board novo "Follow-up · Cadência F1–F9" criado no provisionamento do tenant (9 stages com nomes/subtítulos do mockup) + switcher de board (UI de boards já suporta múltiplos — conferir o seletor atual em `features/boards/`). **Avanço AUTOMÁTICO por dia = v1.1/fase posterior** (guardrail: sistema não move oportunidade sozinho no MVP); v1 = board + movimentação manual + a call-list lê o estágio pra etiqueta.

### N7 — Planilhas conectadas (link vivo =IMPORTDATA)
Pedido do Junior 2026-06-10 (mockup v9-01, card no Financeiro). "Conectar planilha": gera link secreto READ-ONLY por relatório (atendimentos pagos, comissão, leads) → endpoint público CSV (`app/api/public/v1/...` — reusar o padrão da public API existente + `api_keys` p/ token revogável + `rate_limits`) → Adel cola `=IMPORTDATA(link)` no Google Sheets dele = espelho vivo. UI: card "Planilhas conectadas" no Financeiro (listar/copiar/revogar). Segurança M6: token por relatório+org, sem PII além do relatório, revogação imediata, rate limit. **v1** (é o critério de sucesso materializado: "as planilhas dele se preenchem sozinhas"). Formatos custom via n8n/Make = v1.1.

## Ordem de execução do provisionamento (branch `feat/v1-provisionamento`)

1. **Fase D** (design system) → 2. **F3** professionals+catálogo → 3. **F4** atendimentos (c/ desconto/total) → 4. **F5** configs financeiras + `commission_payments` → 5. **N1** origens + **N2** tarefas (núcleo) → 6. **F6** call-list (integra N2) + **N3** nudge → 7. **F8** relatórios+gráficos (Financeiro/Profissionais/Visão Geral N5) → 8. **N4** conversas → 9. **F7** agenda (precisa `subscriber_id`/`code_link`/`business_id` do Clinicorp) → 10. **N7** planilhas conectadas → 11. **N6** board F1-F9 + **F2** seed 202 (precisa aba LEAD.xlsx→CSV) → review final + merge + **1 deploy**.

**Dependências humanas (Junior/Adel):** (a) aba canônica da LEAD.xlsx → CSV; (b) arquivos reais das planilhas do Adel (pré-req F4 — validar campos); (c) credenciais one-time do Clinicorp pra F7. Nada disso bloqueia os passos 1-8.

**Fora (reconfirmado):** nota fiscal · anamnese (gate de segurança) · MRR/recorrentes/lucro com contas no Dashboards (v1.1) · avanço automático da cadência (posterior).
