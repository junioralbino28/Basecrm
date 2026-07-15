# E2 — Revisão do Claude (lote foundation + client)

> Revisor: Claude (Opus 4.8). Data: 2026-07-15.
> Alvo: `feat/e2-enforcement`, commits `d92498f..7e2c00a` (8 commits do Codex).
> Método: leitura linha a linha do núcleo de segurança + verificação independente (`precheck:fast` rodado pelo próprio Claude, não confiei no relatório do Codex).

## Veredito: ✅ APROVADO (lote client/foundation)

O lote está correto, **fail-closed** em toda a cadeia, testado e verificado. Pode seguir. NÃO é a segurança final — ela depende da fase de servidor (RLS/B), que continua travada.

## Verificação independente (rodada pelo Claude)

`npm run precheck:fast`:
- ESLint `--max-warnings 0`: passou.
- `tsc --noEmit`: passou.
- Vitest: **614 passed | 1 skipped** (135 arquivos). Exit 0. Confere com o relatado.

## Núcleo de segurança — revisado e correto

| Peça | Verificação |
|---|---|
| `app/api/me/permissions/route.ts` | `getUser()` (seguro), 401 sem user, 404 sem profile, devolve só as permissões do PRÓPRIO usuário. Sem vazamento cross-user. ✅ |
| `lib/auth/useHasPermission.ts` | `permissions == null` → `undefined` (carregando); senão `permissions[key] ?? false` (chave ausente = negado). Fail-closed. ✅ |
| `context/AuthContext.tsx` | Carrega permissões após o profile; **no erro seta `DENY_ALL_PERMISSIONS` (fail-closed)** — endereça o risco fail-open que o Codex apontou; reseta em signOut e em sessão nula. ✅ |
| `features/settings/SettingsPage.tsx` | `renderContent()` checa `activePermission` ANTES do switch: `undefined`→`PageLoader`, `false`→`AccessDenied`, `true`→conteúdo. **Fecha o bypass por URL direta.** Tabs escondem por chave granular. ✅ |
| `features/reports/FinanceReportPage.tsx` + `ProfessionalsReportPage.tsx` | Mesmo padrão fail-closed (`undefined`→loader, negado→AccessDenied). ✅ |
| `features/settings/UsersPage.tsx` | Gate por `settings.users.manage`; além do bloqueio de tela, os fetches (`if (canManageUsers !== true) return`) não disparam durante carregamento nem quando negado. ✅ |
| `components/Layout.tsx` | Links Financeiro/Profissionais escondidos por `reports.finance`/`reports.professionals`; `undefined` (carregando) é falsy → link escondido (sem flash pra quem não pode). ✅ |
| `components/AccessDenied.tsx` | Componente reutilizável e acessível; unifica o card de bloqueio que antes era reimplementado inline. ✅ |

## Pontos anotados (não são bloqueadores)

1. **Enforcement é só client neste lote — por design.** A segurança REAL do dado (impedir a leitura direta ao banco) é a fase de servidor (RLS/B), ainda travada. Consequência prática: hoje a tela some pra quem não tem permissão, mas o dado ainda não está trancado no servidor. **Não liberar acesso à Vitória tratando o dado como protegido até a fase RLS.**
2. **Aba "Dados" das Configurações ficou sem gate** (`activePermission = true` pra `data`) — intencional, não há chave na taxonomia do E1. A confirmar com o Junior se o conteúdo da aba é sensível; se for, criar uma chave (`settings.data`?) num E2.2.
3. **Inconsistência de estilo trivial:** `SettingsPage` usa `=== true` nas tabs; `Layout` usa truthy (`canViewFinance ?`). Ambos fail-closed (undefined é falsy). Sem impacto — não pedir mudança.

## Próximo passo recomendado

Não fazer deploy deste lote isolado — client-only sem servidor pode dar falsa sensação de "trancado". Seguir pra **fase de servidor (RLS/B)** na mesma branch, e só então subir o E2 como unidade completa (tela + dado trancado). A fase RLS exige, antes de tocar o banco: helper SQL permission-aware (sem recursão, `search_path` explícito), testes de isolamento tenant A×B + grant/deny/defaults, migration aditiva revisável, e aprovação explícita do Junior — como o próprio Codex travou no `OPINIAO-CODEX.md`.
