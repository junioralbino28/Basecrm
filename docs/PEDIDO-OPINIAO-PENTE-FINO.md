# Pedido ao Codex — pente fino independente + opinião sobre o levantamento

Data: 2026-07-23 · Solicitante: Junior (dono do produto) · Redator: Claude
Branch: `feat/funil-construtor` (produção = `main` @ `be7fe35`, 34 migrations)

## Contexto

Fizemos um pente fino completo do sistema e nasceu a **documentação-mãe** em
`docs/` (commits `d9b0e33` → `ea505d4`). O Junior determinou: **antes de apagar
qualquer coisa**, o Codex passa o pente fino dele em cima do que foi achado e
dá opinião própria sobre (a) o que estava esquecido e dá pra aproveitar e
(b) o que ajuda a arrumar bugs e caminhos que estão quebrando hoje.

**Nada foi deletado.** Uma limpeza chegou a ser iniciada e foi REVERTIDA para
você ver o sistema intacto.

## O que ler antes de opinar (nesta ordem)

1. `docs/README.md` → `docs/STATUS.md` (matriz + 11 dívidas) → `docs/decisoes.md`
2. `docs/arquitetura/` (5 docs) e `docs/modulos.md`
3. `docs/historia-e-origens.md` — linhagem NossoCRM e o mapa da documentação
   fora do repo (workspaces, ledgers, auditoria sua de julho)
4. Este pedido.

## Método exigido (o de sempre)

Verifique CADA alegação no código/git antes de concordar — não herde nossas
conclusões. Onde discordar, diga "discordo porque X". Marque o que não conseguir
verificar. Você já nos corrigiu 3× neste projeto; é isso que esperamos.

## §1 — Lista de REMOÇÃO proposta (confirmar item a item ANTES de apagar)

Minha evidência de que são órfãos (grep de imports em app/components/features/
lib/context/hooks/test — só autorreferências):

| Item | Evidência minha | Sua verificação |
|---|---|---|
| `features/activities/components/ActivityFormModalV2.tsx` | nenhum import; V1 é a montada | ? |
| `features/contacts/components/ContactFormModalV2.tsx` | idem | ? |
| `features/boards/components/Modals/CreateDealModalV2.tsx` | idem | ? |
| `features/ai-hub/tools/crmTools.ts` (+ pasta `tools/`) | tools reais vivem em `lib/ai/tools.ts`; schemas sem `execute`, sem consumidor | ? |
| `lib/ai/actions.tsx` | stub `export {}` auto-declarado DEPRECATED | ? |
| `useUpdateDealStatus` em `useDealsQuery.ts:443` (+ linha no barrel `index.ts`) | o próprio JSDoc diz "not used anywhere"; grep confirma | ? |
| script `smoke:integrations` no `package.json` | `scripts/smoke-integrations.mjs` NÃO existe | ? |

Perguntas: algum desses tem consumidor que meu grep não pegou (import dinâmico,
string template, teste e2e)? Algum vale RESGATAR em vez de apagar (ex.: o
CreateDealModalV2 tem algo que o V1 não tem)?

## §2 — Bugs confirmados/candidatos (opinar sobre fix e ordem)

1. **`get_contact_stage_counts`** — declarada SEM parâmetro no SQL
   (`schema_init:858`), mas `lib/supabase/contacts.ts:214` chama com `{org_id}`
   no caminho multi-tenant (assinatura inexistente → erro); a chamada SEM
   parâmetro é SECURITY DEFINER e conta contatos de TODAS as orgs (vaza
   agregado cross-tenant). **Está em produção.** Proposta: migration com versão
   org-filtrada (gate `can_access_organization`) + ajustar o serviço.
   Você concorda com o diagnóstico e o fix? Qual a urgência real?
2. **`get_dashboard_stats`** — sem nenhum chamador no app. Remover na mesma
   migration?
3. **RLS de `lead_sources` em produção** (recepção pode excluir origem) —
   correção JÁ pronta na branch (C2A), chega no deploy da C2. Alguma ação
   antes do deploy?
4. **Botão Editar sem handler** (`DealDetailModal.tsx:755`) e **"Webhook CRM"
   mostrando "-"** (cosmético seu do multi-número) — prioridade?
5. **Módulo `decisions`** — 100% localStorage, `executeAction` é placebo.
   Opinião: reconstruir sobre infra real (a observabilidade N4 da C2D poderia
   absorver a ideia?) ou remover do produto?
6. **Fontes duplas** (`products` em SettingsContext × TanStack; projeção
   DealView duplicada; 3 serviços de consentimento; `createStaticAdminClient`
   em 2 lugares) — qual ordem de consolidação minimiza risco?

## §3 — Esquecidos aproveitáveis (opinar sobre valor e timing)

1. **Mapa célula-a-célula da planilha do Adel** (`ESTADO-v1-provisionamento.md`
   no workspace) — insumo do financeiro/caixa v2. Quando integrar?
2. **Cadência F1–F9** (PDF no workspace da Jéssica) + 12 vídeos comprimidos —
   é o conteúdo real das mensagens do funil (C3).
3. **Conceito 3-telas da secretária** (06-crm-secretaria) — conferir se o
   call-list de hoje honra o desenho original (registrar contato em 1 botão).
4. **Blueprint concierge multi-clínica** (`clinic-platform-blueprint.md`) —
   reativar quando entrar o 2º cliente?
5. **Docs da era março ainda válidos** (business-rules, playbook, navigation
   spec) — atualizar terminologia e promover pra doc-mãe, ou arquivar?
6. O que MAIS você viu no levantamento que nós não listamos?

## Entregável

`docs/OPINIAO-CODEX-PENTE-FINO.md` com: veredito item a item do §1 (pode
apagar? sim/não/resgatar), diagnóstico próprio do §2 com ordem de correção
recomendada, opinião do §3, e qualquer achado novo seu. NÃO delete nada e NÃO
implemente nada neste ciclo — é parecer. Regras de sempre: nada de banco de
produção, nada de push.
