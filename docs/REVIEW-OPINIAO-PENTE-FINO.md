# Adjudicação — parecer do Codex sobre o pente fino

Data: 2026-07-23 · Parecer avaliado: `OPINIAO-CODEX-PENTE-FINO.md`
Método: cada discordância e achado novo verificado no código antes de aceitar.

## Veredito

**APROVADO SEM CORREÇÃO.** Das 6 discordâncias dele com alegações minhas,
**as 6 procedem** — verifiquei todas de forma independente. Os achados novos
também se confirmaram. É o parecer mais denso que recebemos neste projeto.

## O que verifiquei na minha mão (evidência independente)

| Alegação dele | Minha verificação | Resultado |
|---|---|---|
| Tela de contatos NÃO quebra; método defeituoso é órfão | `useContactStageCounts` conta no cliente via `getAll(orgId)` (`useContactsQuery.ts:211-229`); nada chama `getStageCounts` | ✅ confirmado — minha alegação de quebra CAI |
| `get_dashboard_stats` agrava (métricas financeiras globais) | SQL: soma `pipeline_value`/`won_value` de TODAS as orgs, SECURITY DEFINER, grant a `authenticated` | ✅ confirmado (exposição por inferência do SQL, como ele marcou) |
| 4 rotas de canal devolvem `config` cru (com secrets) a gestores | `connect:156,163` · `healthcheck:121,128,156,162` · `disconnect:97,104` · `send-test:119,126,154,157` — todas selecionam `config` e devolvem `channel: updated` sem `toPublicChannelConnection` (o GET da conexão sanitiza; essas não) | ✅ confirmado, sucesso E erro |
| `decisions` não é 100% placebo — dispara mutações reais SEM await | `useDecisionQueue.ts`: `addActivity(...)`/`updateDeal(...)`/`updateActivity(...)` sem await → `return true` → `approveDecision` marca aprovado (`:178-182`) | ✅ confirmado — falha vira "sucesso" |
| Call-list descarta o resultado do modal | `CallListPage.tsx:69-73`: `onSave={() => { handleMarkDone(...) }}` — o payload (outcome/duração/notas) é jogado fora | ✅ confirmado |
| "12 vídeos prontos" é FALSO no meu doc de ativação | `02-followup/README.md`: decisão escrita "**Sem vídeo nos follows**" (criativos já rodam em anúncio); cadências .md são texto-only; 1 MP4 corrompido (`moov atom not found` via ffprobe dele) | ✅ confirmado — corrijo `ativacao-cliente.md` |
| `smoke:integrations` deve ser RESGATADO | git: criado em `3c99d29` (261 linhas, E2E de Public API + webhook), removido em `dfb7c19` "local only"; suíte atual não cobre o percurso | ✅ confirmado — resgatar com trava anti-produção |
| `RSCChat.tsx` também é órfão | `git grep RSCChat` → só o próprio arquivo | ✅ confirmado — entra na limpeza |
| `getAll` com `.limit(10000)` silencioso | `contacts.ts:297` e `:653` | ✅ confirmado — contagens mentem acima de 10k |
| Duas verdades para origem (texto × UUID auditável) | consistente com o inventário (Visão Geral agrupa `contacts.source` texto); não re-verifiquei linha a linha | aceito (ele cita arquivo:linha) |

## Pontos de método que subscrevo

- A recusa dele em "fingir prova de runtime" (marcar `[Inferred]` no
  `get_dashboard_stats` porque o escopo proibia banco) é exatamente o padrão
  que queremos — a prova vira o primeiro teste do hotfix.
- A distinção P1 (RPCs) antes de P2 (DTOs de canal) antes do visual está certa:
  segurança de dado > segurança de segredo operacional > UX.
- `decisions` NÃO entra na C2D — concordo e retiro minha sugestão anterior:
  observabilidade do motor lê `jobs/attempts/waits/enrollments`, não uma fila
  local de navegador.
- O gate do deploy da C2 ganhou um item novo e correto: rotular/corrigir a
  dupla verdade de origem antes de vender o painel como auditável.

## Correções aplicadas na doc-mãe (por este review)

1. `STATUS.md` — dívida 7 reescrita (texto sugerido dele, §3.1); linha de
   `decisions` e do webhook atualizadas; dívidas novas: 4 DTOs de canal,
   origem em dupla verdade, call-list descartando outcome, `limit(10000)`.
2. `ativacao-cliente.md` — afirmação dos vídeos corrigida para: "12 fontes
   localizadas; 11 MP4 tecnicamente válidos; payload editorial NÃO aprovado
   (decisão vigente: sem vídeo nos follows até haver mídia nova)".
3. `modulos.md` — ai-hub: pasta `tools/` é DESCONECTADA (não "execução em
   outro lugar"); decisions atualizado (dois executores, sem await, não
   tenantizado).

## Ordem final (a dele, que eu subscrevo) — aguardando aval do Junior

1. **Hotfix de segurança (Codex, migrations):** remover/substituir as 2 RPCs
   legadas com prova PostgREST dois-tenants no local.
2. **Sanitizar as 4 rotas de canal** (sucesso e erro) + testes.
3. **Limpeza de mortos** (6 aprovados + schemas órfãos + RSCChat) + snapshot
   de cache + docs.
4. **Resgate do smoke** local-only com trava anti-produção.
5. **Correções operacionais:** quarentenar decisions · botão Editar · status
   do webhook pós-sanitização · call-list persistindo outcome.
6. **Deploy C2** com gates: RLS origens + dupla verdade rotulada.
7. **C2D** (observabilidade nativa do motor).
8. Consentimento (contrato real + gate) → produtos → DealView → static admin.

Vídeos → C3 como fixture técnica (não conteúdo). Planilha do Adel → fatia
financeira pós-C2D. Blueprint → matriz as-built×lacunas no 2º cliente.
