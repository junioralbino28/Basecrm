# Registro de decisões travadas

> Parte da documentação-mãe. Índice geral em [docs/README.md](./README.md).
>
> Decisão travada é LEI: não se reabre sem o dono do produto (Junior) pedir.
> O histórico completo de cada uma vive nos documentos de ciclo em
> `docs/features/funil-construtor/` (PEDIDO → REVIEW-PLANO → IMPL-LOG →
> REVIEW-ENTREGA).

## Produto

| Decisão | Onde está o detalhe |
|---|---|
| **Etiquetas em duas famílias separadas** — SERVIÇO (escolhe a automação) e ORIGEM (atribuição/painel). O usuário **seleciona, nunca digita** etiqueta que o sistema lê. | `SPEC-ENTREGA-C.md` §N1.1 |
| **D1 — paciente muda de interesse no meio do fluxo:** responder tira do follow-up e leva pro atendimento humano; a secretária edita o procedimento e anota; se esfriar de novo, a reentrada usa a etiqueta atual. O caminho congela **dentro de uma passagem**; a passagem seguinte lê o estado novo. | `SPEC-ENTREGA-C.md` §N1.2 |
| **D2 — dois ou mais procedimentos SEM resposta:** tarefa-porteiro ANTES de inscrever; nenhum fluxo começa antes da decisão. É a EXCEÇÃO — caminho normal (1 procedimento, sem resposta) vai direto pro follow-up, sem tarefa. | `SPEC-ENTREGA-C.md` §N1.2 |
| **Etiquetar NÃO inscreve; o ESFRIAMENTO roteia** — 5 dias contados do último evento da conversa (inbound OU outbound). Revogou o "aplicar etiqueta cria inscrição". | `REVIEW-PLANO-C2B.md` |
| **Inbound sem espera casada PAUSA a inscrição** (`patient_inbound`) — fecha a fresta do "paciente responde 22h, follow-up das 8h dispara mesmo assim". | `REVIEW-ENTREGA-C2B.md` §5 |
| **Primeira etiqueta de uma categoria vira principal sozinha**; trocar a principal é 1 clique, nunca obrigatório. A tela jamais bloqueia a recepção para resolver disputa de roteamento. | `REVIEW-OPINIAO-ETIQUETAS.md` §5 |
| **Criar etiqueta NÃO acontece no card do negócio** (nem para admin): criação vive em Configurações → Etiquetas e no gatilho do construtor (o fluxo é dono do próprio gatilho). | adjudicação §3 do parecer de etiquetas |
| **Origem é entidade separada com primeira + última + histórico de toques.** Nunca array de origens; WhatsApp é canal, não origem. | `SPEC-ENTREGA-C.md` §N1.1 |
| **Arquivar é o fluxo normal; apagar é exceção** para entidade nunca usada. Renomear rótulo não pode quebrar automação publicada (identidade estável ≠ rótulo humano). | parecer de etiquetas |
| Ordem do menu lateral: **Conversas logo abaixo de Contatos**; **Automações antes de Configurações**. | pedido do Junior, 2026-07-22 |
| **Backlog aceito, não é agora:** tela de personalização self-service do CRM (cores, ordem de menus) — só depois de 100% funcional. | pedido do Junior, 2026-07-22 |
| **Backlog aceito, não é agora: CRM próprio da AGÊNCIA.** A agência passa a usar o produto para si — receber leads de anúncios e prospecção, funil de fechamento de clientes e funções agência-only. Hoje `/platform` é administração de tenants, não CRM. **Prioridade explícita: só DEPOIS de finalizar o lado clínicas/clientes** (lacunas 1–7 de `ativacao-cliente.md`). | decisão do Junior, 2026-07-23 |
| **Nomenclatura NEUTRA e leiga em todo o CRM genérico — "lead" fica (revoga o "paciente" no lugar de lead).** Termos simples que qualquer leigo entende E que servem a qualquer nicho (não prender o produto a clínicas): negócio no funil = **lead** · pessoa no cadastro = **contato** · lifecycle = Lead → Qualificado (nunca "MQL") → Oportunidade → **Cliente** → Outros/Perdidos. Exceção: módulos do vertical clínico (**Atendimentos, Agenda**) continuam dizendo "paciente" — ali é o domínio. Jargão técnico de marketing (MQL, SQL, pipeline em inglês) não aparece em tela. | decisão do Junior, 2026-07-24 |

## Arquitetura

| Decisão | Onde está o detalhe |
|---|---|
| **Snapshots de versão publicada são imutáveis.** Nunca reescrever versão publicada; evolução = versão nova. | parecer de etiquetas / C2A |
| **`schemaVersion: 3`**: gatilho por entidade grava `{ tag_id }`; executor v3 usa `deal.tag_ids`, v2 usa `deal.tags`, e o banco RECUSA mistura (trava dura nas duas direções). | `REVIEW-ENTREGA-C2B.md` §4 |
| **`caseId` é a identidade do ramo do switch e NÃO é o UUID da etiqueta** — ciclos de vida diferentes. | parecer de etiquetas |
| **API de etiquetas nunca expõe "salvar a lista"** — só add / remove / set-primary (a lição do Kommo: PATCH de array inteiro perde dado em corrida). | `PESQUISA-ETIQUETAS.md` |
| **Permissões por snapshot versionado** (v3 ativa): `tags.manage`/`lead_sources.manage` = admin, agency_admin, agency_staff, clinic_admin · `*.assign` = + clinic_staff, vendedor. `agency_staff` TEM manage (a etiqueta de serviço nasce junto com a automação). | C2A / `REVIEW-PLANO-C2A.md` |
| **Vercel FREE ⇒ scheduler é pg_cron + pg_net no Supabase**, dispatch por worker na VPS. | SPEC-ENTREGA-C |
| **Migração de dado legado não fabrica história**: `provenance = legacy_migration` com autor/data nulos — o painel nunca mente sobre o passado. | C2A |

## Processo

| Decisão | Detalhe |
|---|---|
| **Modelo invertido na UI:** eu (Claude) implemento → Junior testa ao vivo → Codex revisa. Motor/migrations: Codex implementa → eu reviso. O retorno do Junior operando a tela é PARTE DO ACEITE. | decisão do Junior, 2026-07-21 |
| **Adjudicação cruzada:** toda alegação técnica (minha ou do Codex) se verifica no código antes de aceitar. Placar até hoje: 3×3 em erros pegos. | prática desde a C1A |
| **Referência visual oficial:** `mockup-tela-real.html` (aprovado). Mapa navegável, NÃO canvas livre. | C1B |
