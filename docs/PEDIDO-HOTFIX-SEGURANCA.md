# Pedido ao Codex — hotfix de segurança (itens 1–2 da ordem aprovada)

Data: 2026-07-23 · Aprovado pelo Junior · Origem: `OPINIAO-CODEX-PENTE-FINO.md`
(seu próprio parecer, §4.1 e §4.2) + adjudicação `REVIEW-OPINIAO-PENTE-FINO.md`.

## Escopo (pequeno e independente — cherry-pickável sem carregar a C2)

### 1. Migration das 2 RPCs legadas (P1)

Implementar exatamente o que você recomendou no §4.1:

- **`get_contact_stage_counts()`**: revogar execução e REMOVER a versão
  zero-arg (não basta criar overload); criar
  `get_contact_stage_counts(p_organization_id uuid)` como **SECURITY INVOKER**
  com filtro explícito e recusa para tenant sem acesso; grant só a
  `authenticated`. Ajustar `lib/supabase/contacts.ts`: `organizationId`
  obrigatório, sem fallback, e ligar `useContactStageCounts` à RPC segura
  (hoje conta no cliente com `limit(10000)` — a RPC resolve a contagem certa).
- **`get_dashboard_stats()`**: remover na mesma migration, sem CASCADE.
- **Prova obrigatória (o teste que você mesmo desenhou):** teste `*.local.test`
  com DOIS tenants fictícios chamando via PostgREST local — registrar o
  comportamento pré-fix, aplicar, provar que a zero-arg não existe mais e que
  nenhuma métrica cross-tenant retorna.

### 2. Sanitizar as 4 rotas de canal (P2)

`connect` · `healthcheck` · `disconnect` · `send-test` — respostas de **sucesso
E erro** hoje devolvem `config` cru (`channel: updated`). Aplicar
`toPublicChannelConnection` ou omitir o campo `channel` (o frontend recarrega o
DTO seguro — você verificou que ignora o campo; se optar por omitir, confirme
isso de novo no código). Testes garantindo ausência de `apiKey`/`webhookSecret`
em TODOS os DTOs dessas rotas, incluindo os caminhos de erro.

## Fora do escopo (NÃO fazer neste ciclo)

- UI do "Webhook CRM: -" (vem depois da sanitização, no meu trilho).
- Consolidação de consentimento/produtos/DealView (ciclo posterior).
- Qualquer coisa da C2/C2D.

## Regras de sempre

Supabase LOCAL apenas (127.0.0.1) · nada de banco de produção · sem push/deploy ·
`npm run test:local` verde no baseline (888 + os seus novos) · lint/tsc limpos ·
IMPL-LOG registrando o que fez · eu reviso a entrega com verificação
independente antes do aval do Junior.

## Contexto de branch

Trabalhe na `feat/funil-construtor` (estado atual). A limpeza de código morto
do parecer já foi aplicada por mim (commit desta data) — não conflita com o
seu escopo.
