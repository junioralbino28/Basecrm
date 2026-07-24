# REVIEW — Adjudicação da entrega do hotfix de segurança

Data: 2026-07-23 · Revisor: Claude · Entrega: Codex (`bf8f9df` → `c036fb8` → `b501728`)
Pedido: [PEDIDO-HOTFIX-SEGURANCA.md](./PEDIDO-HOTFIX-SEGURANCA.md) · IMPL-LOG: [IMPL-LOG-HOTFIX-SEGURANCA.md](./IMPL-LOG-HOTFIX-SEGURANCA.md)

## Veredito: **APROVADA SEM CORREÇÃO**

Toda alegação do IMPL-LOG foi verificada de forma independente (código lido,
banco local consultado direto no Postgres, suíte rodada na minha mão). Nenhuma
divergência encontrada.

## O que verifiquei e como

### Item 1 — RPCs (commit `bf8f9df`)

| Alegação | Verificação independente | Resultado |
|---|---|---|
| Zero-arg removidas, sem CASCADE | `pg_proc` do banco local: só existe `get_contact_stage_counts(p_organization_id uuid)`; `get_dashboard_stats` não existe | ✅ |
| SECURITY INVOKER + grant só `authenticated` | ACL no catálogo: `{postgres=X/postgres,authenticated=X/postgres}` — sem anon, sem PUBLIC | ✅ |
| Recusa `42501` (org nula / anon / cross-tenant) | Migration lida linha a linha + teste 2-tenants roda verde na minha execução | ✅ |
| Filtro explícito + `deleted_at is null` + `UNKNOWN` | Migration confere; teste assere contagens exatas (soft-delete fora) | ✅ |
| Serviço exige org / hook usa RPC segura | Diff de `lib/supabase/contacts.ts` e `useContactsQuery.ts`: sem fallback zero-arg, fim da contagem client-side com `limit(10000)` | ✅ |
| RED pré-fix | Não re-executável (funções já removidas) — aceito como documentado no IMPL-LOG §2; o lado GREEN é prova de máquina na minha mão | ✅ (com essa ressalva de método) |

### Item 2 — rotas de canal (commit `c036fb8`)

| Alegação | Verificação independente | Resultado |
|---|---|---|
| 4 actions sem campo `channel` | Grep de `channel:` nas 4 rotas: nenhuma resposta contém o campo; respostas só têm `ok`/`pairing`/`webhook`/`healthcheck`/`send_test`/`error` | ✅ |
| Nenhum cliente lia `channel` das actions | Meu próprio grep em `features/`: único `data?.channel?.id` é do `POST /channels` (criação) em `TenantChannelsPage.tsx:488` — não é action | ✅ |
| Redação em sucesso E erro | `connect/route.ts` lido inteiro: resolver → mensagem genérica; updateError/pairingError → `redactChannelSecrets`; demais rotas conferidas por grep de todos os `json({...})` | ✅ |
| Sanitização recursiva antes de persistir | `redactChannelPayload` remove propriedades `apiKey`/`webhookSecret` e redige strings aninhadas (literal + URL-encoded + atribuição JSON); aplicado em `lastPairingPayload` etc. | ✅ |
| DTO público sanitiza `metadata` além de `config` | `publicChannel.ts`: `redactChannelPayload` em ambos, override após o spread | ✅ |

### Gates e regras de sempre

| Gate | Minha execução | Resultado |
|---|---|---|
| `test:local` | **932/932** (203 arquivos) — bate com 890 baseline + 42 novos | ✅ |
| lint `--max-warnings 0` | limpo | ✅ |
| `tsc --noEmit` | exit 0 | ✅ |
| Banco local SEM reset | Ambiente C2C do Junior intacto ANTES e DEPOIS da minha suíte: Funil de Vendas com 6 etapas, 5 deals, 3 logins `@local.test`; fixtures antigas de suítes anteriores ainda presentes (prova de não-reset) | ✅ |
| Produção intocada / sem push / sem deploy | 3 commits locais na branch; nada em remote | ✅ |
| Teste local-only | `contactStageCountsSecurity.local.test.ts` lança erro se o alvo não for local | ✅ |

## Notas de registro

1. O commit intermediário `4704ca1` (visto por mim mid-flight) foi reescrito em
   `bf8f9df` antes da entrega — aceitável, commits nunca saíram da máquina.
2. As linhas 401/400 no output da suíte são casos adversariais esperados
   (recusas provadas), como documentado no IMPL-LOG §6.
3. Limite conhecido e aceito da redação: cobre valor literal, URL-encoded e
   atribuições `apiKey:`/`webhookSecret:` textuais/JSON; um segredo re-codificado
   pelo provedor em outra forma (ex.: base64 dentro de payload) não é detectável
   por redação genérica — mitigado porque propriedades sensíveis são REMOVIDAS
   dos payloads persistidos, não apenas redigidas.

## Efeitos na doc-mãe

- Dívida **7** (RPCs P1) → resolvida (`bf8f9df`).
- Dívida **7b** (rotas de canal P2) → resolvida (`c036fb8`).
- Baseline de qualidade → `test:local` = **932/932**.
- Destravado: trilho da UI "Webhook CRM: -" (dependia da sanitização).
