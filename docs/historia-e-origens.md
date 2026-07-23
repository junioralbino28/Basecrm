# História, origens e mapa da documentação dispersa

> Parte da documentação-mãe. Índice geral em [README.md](./README.md).
> Responde: de onde este sistema veio, que nomes já teve, e ONDE vive cada
> documento que não está neste repositório. Levantado em 2026-07-23.

## A linhagem: NossoCRM → Base CRM

O Basecrm **não veio** de um protótipo separado — ele **É** o protótipo, evoluído
no mesmo repositório. A prova está no próprio código: o `README.md` do repo
ainda se apresenta como "NossoCRM", o `supabase/config.toml` diz "NossoCRM -
CRM multi-tenant SaaS", e o pacote interno se chama `crmia-next`. O projeto
Supabase de produção também carrega o nome antigo.

| Era | Quando | O que era |
|---|---|---|
| Semente | fev/2026 | spec formal do "Inbox Unificado Omnichannel" (`.specswarm/`) — origem da ideia de inbox, vinda de outro ambiente |
| **NossoCRM / crmia-next** | dez/2025 → mar/2026 | CRM single-tenant com IA (1º commit 2025-12-14); virou plataforma multi-tenant white-label (era dos docs de março) |
| Rebrand **Base CRM** | jun/2026 | piloto Dra. Jéssica: plano-mestre "Motor da Vitória" (9 fases/72 tasks), camada clínico-financeira, RLS provada |
| Endurecimento | jul/2026 | permissões granulares (E1/E2), auditoria de segurança do Codex (3 Critical corrigidos), sweep de terminologia saúde |
| Construtor de funil | jul/2026 → hoje | fatias A→C2C na branch `feat/funil-construtor` (docs em `features/funil-construtor/`) |

## Onde vive a memória do projeto (fora do repo)

### 1. Workspace `WorkSync/workspaces/Cenoura Squad Mapper/`

| Documento | O que é | Status |
|---|---|---|
| `historico/RECONSTRUCAO-COMPLETA-2026-07-15.md` | **A âncora histórica**: linha do tempo Fase 0→6 reconstruída da fonte (JSONL + git + banco), com prova | memória canônica até 15/07 |
| `LEDGER-SESSAO-*.md` (7 arquivos, jun–jul/2026) | registro narrativo de cada sessão (piloto, escopo v1, mockups, reviews adversariais, auditoria) | fonte bruta atrás da reconstrução |
| `ESTADO-v1-provisionamento.md` | estado detalhado da v1 + **mapa célula-a-célula da planilha do Adel** (molde v17.6, regras de Ticket Médio, backlog caixa v2) | ⚠️ único lugar com o mapa da planilha — NÃO descartar |
| `relatorio-auditoria-basecrm-codex/` | auditoria de segurança completa do Codex (jul/2026) + triagem + plano de correção | histórico de alto valor (achados já corrigidos em `0cd928f`) |
| `codex-audit/` | bundle de ENTRADA da auditoria (dossiês + 21 fontes OWASP/Supabase/testing) | biblioteca de referência |
| `pesquisa-motor-automacao-2026-07-07.md` | pesquisa que fundou o design do motor de automação | fundamento histórico — o motor JÁ FOI construído (ver `features/funil-construtor/`) |
| `mockup-v2-previews/` (18 PNGs) | screenshots dos mockups aprovados da v1 | fonte visual histórica |
| `historico/fontes/` | espinhas de conversa (2,4 MB), digest de decisões, gitlog 479 commits | prova bruta — arquivo |
| `STATE.md` | estado do PRODUTO Squad Mapper (negócio Cenoura) — menciona o CRM só como "Produto 2" | fora do escopo CRM |

### 2. Workspace `WorkSync/workspaces/Dra Jessica Barros/`

| Item | O que é | Status |
|---|---|---|
| `06-crm-secretaria/` (README + mockup-crm.html/png, 05/06) | o CONCEITO original do "CRM da secretária": 3 telas (Hoje / Registrar contato / Novo paciente) para a Vitória, mapeadas ao funil F1–F9 | origem do lado-recepção do produto; o "falta decidir A/B/C" do doc está obsoleto (decisão: app web, já construído) |
| `02-followup/Funil-9-Mensagens-...pdf` | a cadência F1–F9 (D+0 a D+25) que virou o funil de follow-up | fonte da cadência (não verificado) |
| `07-diagnostico-comercial/` | diagnóstico com o Adel (ground truth de números) | base do escopo |
| `08-sistema-central/mockup-recepcao/` | mockup aprovado, "fonte da verdade visual" da v1 | histórico |

### 3. Dentro do repo — docs pré-existentes (duas gerações)

**Era março/2026** (`docs/` raiz) — escritos para o NossoCRM plataforma:

| Ainda vale (com risco de termo antigo¹) | Superado/arquivável |
|---|---|
| `crm-business-rules.md` (regras anti-regressão) | `clinic-whatsapp-mvp-status.md` (foto de março) |
| `product-operating-model.md` (agência × clínica) | `evolution-channels.md` (pré-inbox atual) |
| `platform-admin-operations.md` (runbook admin) | `n8n-agente-crm-mvp.md` (pivô p/ automação nativa em 07/07) |
| `workspace-navigation-spec.md` (regras de navegação) | `legacy-tenant-migration.md` (one-off, path morto) |
| `basecrm-engineering-playbook.md` (método 6 etapas) | `multi-tenant-hardening-audit/plan.md` (concluído; superado pela auditoria Codex) |
| `public-api.md` + `webhooks.md` + `mcp.md` | `implementation-journal.md` (parou em março) |
| `release-checkpoints.md` | `.specswarm/` (semente de fev, outro ambiente) |
| `clinic-platform-blueprint.md` (visão multi-clínica) | `tenant-data-map.md` (não cobre tabelas clínicas de junho) |

¹ escritos ANTES do sweep de terminologia de 07/07 (Negócio→Paciente,
Board→Funil) — conferir termos ao usar.

**Era junho–julho/2026:**

- `docs/plans/2026-06-09-basecrm-v1-motor-vitoria.md` — o plano-mestre da v1
  (488 KB!) + adendo de design de 10/06. Executados; espinha do que existe.
- `docs/spec|plan-permissoes-granulares-e-convite.md` — feature E1 (entregue).
- `docs/features/` — o modelo de trabalho por feature (README + ONBOARDING-CODEX
  vivos) e os ciclos `e2-enforcement/`, `multi-numero-inbox/` e
  `funil-construtor/`.

## Regras derivadas deste levantamento

1. **Memória canônica:** história até 15/07 = `RECONSTRUCAO-COMPLETA` (+ ledgers
   como fonte bruta); de 15/07 em diante = `features/funil-construtor/` + este
   `docs/` + checkpoints do cenoura-brain.
2. **Qualquer doc anterior a 20/07 que fale do motor de automação está
   desatualizado** — o motor foi construído (fatias A→C2C).
3. O mapa da planilha do Adel (`ESTADO-v1-provisionamento.md`) é insumo vivo do
   produto — migrar para cá quando a v2 do financeiro/caixa entrar em pauta.
4. Candidatos a arquivar (coluna direita da era março) não se apagam — movem-se
   para `docs/arquivo/` quando alguém precisar mexer neles.

## Não verificado nesta varredura

- Estado de conclusão exato de `e2-enforcement` e `multi-numero-inbox` (os SPECs
  marcam status antigo; o banco indica E2 aplicado — migration `20260635`).
- Conteúdo dos PDFs/HTMLs dos workspaces da Jéssica (catalogados, não lidos).
