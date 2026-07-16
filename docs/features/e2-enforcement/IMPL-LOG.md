# E2 — Log de implementação

> Data: 2026-07-15
>
> Branch: `feat/e2-enforcement`
>
> Estado: client/foundation e S1 de servidor concluídos localmente; S1 aguarda revisão do SQL pelo Claude e aprovação do Junior antes de qualquer aplicação em produção. Sem push e sem deploy.

## Escopo entregue

| Área | Implementação | Commit |
| --- | --- | --- |
| Passo 0 | Opinião de arquitetura, recomendação B/RLS, riscos e trava da futura migration | `23c69e8` |
| Foundation 0.1 | `GET /api/me/permissions` retorna o mapa resolvido do usuário autenticado | `f09f716` |
| Foundation 0.2 | `AuthContext` carrega, limpa e expõe permissões; `useHasPermission` trata carregamento e falha de modo fechado | `a1b5334` |
| Foundation 0.3 | `AccessDenied` reutilizável e acessível | `aac5140` |
| Financeiro e navegação | Gates de `reports.finance`, `reports.professionals` e `settings.finance`; links escondidos de forma independente | `84a2a78` |
| Configurações | Gates granulares em todas as abas mapeadas e bloqueio do bypass por URL | `fd7b5fd` |
| Equipe | Gate interno por `settings.users.manage`, sem fetch enquanto a permissão está negada ou pendente | `e927932` |
| Dados | Aba e rota direta restritas ao escopo de agência | `add19d5` |
| S1 servidor | Snapshot v1, `has_permission`, policies de Atendimentos e três RPCs de relatório | `d22b51f` |
| Testes S1 | Contratos estáticos, harness seguro e isolamento real em Supabase local | `41d92d8` |

## Decisões e ajustes incorporados

- Os componentes de Produtos, Profissionais, Financeiro e Integrações permanecem inline em `features/settings/SettingsPage.tsx`. Nenhum arquivo artificial foi criado para separá-los.
- Os links de relatório Financeiro e Profissionais encontrados em `components/Layout.tsx` foram incluídos no gate. A busca em `components/navigation` não encontrou uma segunda cópia desses links que exigisse alteração.
- A antiga decisão por papel em Configurações e Equipe foi substituída pelo mapa de permissões resolvido. Isso permite tanto negação explícita para admin quanto concessão por override para staff no client.
- A aba Dados usa escopo de agência, não uma permissão granular: clínica não vê a aba e recebe `AccessDenied` pela URL direta.
- Rotas diretas de Configurações inicializam a aba a partir do pathname, evitando montar brevemente conteúdo protegido antes do efeito de sincronização.
- A tela Equipe não chama os endpoints de usuários, convites ou tenants enquanto `settings.users.manage` não for explicitamente `true`.
- O endpoint de foundation é apenas leitura das permissões resolvidas. Nenhum enforcement de servidor foi adicionado naquele lote client original.

## Evidência TDD

O ciclo usado em cada tarefa foi teste falhando, implementação mínima e teste passando.

- Foundation: testes do endpoint, do carregamento/reset/falha fechada no `AuthContext`, do hook e do `AccessDenied` foram escritos junto das respectivas unidades.
- Financeiro/navegação: os testes cobrem conteúdo permitido/negado e visibilidade independente dos links. A suíte completa revelou mocks antigos de `useAuth` sem o novo campo `permissions`; um teste de regressão foi incluído e o hook passou a preservar compatibilidade durante o carregamento.
- Configurações — RED: 9 falhas e 1 cenário já verde (Financeiro). GREEN: 12/12 testes direcionados, cobrindo abas negadas, grant para `clinic_staff`, sete rotas diretas e estado pendente.
- Equipe — RED: 3/3 falhas, demonstrando override negativo ignorado, fetch durante carregamento e grant positivo bloqueado pelo role. GREEN: 3/3 cenários; 15/15 ao executar em conjunto com os testes de Configurações.

## Validação

Antes de cada commit de código foi executado `npm run precheck:fast` conforme o PLAN.

- Após Financeiro/navegação: lint e typecheck aprovados; 134 arquivos, 605 testes aprovados e 1 ignorado.
- Após Configurações: lint e typecheck aprovados; 134 arquivos, 611 testes aprovados e 1 ignorado.
- Após Equipe: lint e typecheck aprovados; 135 arquivos, 614 testes aprovados e 1 ignorado.

As mensagens HTTP 401 de consultas Supabase que aparecem ao fim da suíte já existiam nos testes e não alteram o resultado: os comandos encerraram com código 0.

## S1 — enforcement de servidor

### Implementação

- A migration `20260635000000_e2_server_permission_enforcement.sql` cria `role_permission_defaults` como snapshot de versão única com `defaults_version = 1`, sem tabela/ponteiro de versão ativa neste v1.
- O gerador importa diretamente `APP_PERMISSIONS`, `ROLE_PERMISSION_DEFAULTS` e `getDefaultPermissionMap` de `lib/auth/permissions.ts`; nenhum manifesto paralelo nem refactor do E1 foi criado.
- As três travas anti-drift são: gerador determinístico em modo `--check`, validação de completude dentro da migration (6 cargos × 35 permissões = 210 linhas) e comparação do banco local com `getDefaultPermissionMap` para todos os cargos.
- `has_permission(permission_key text)` usa apenas `auth.uid()`, é `STABLE`, `SECURITY DEFINER`, tem `search_path = ''` e fecha em `false` para usuário/profile/default ausente, chave órfã ou override de outra organização. Override válido vence o default tanto para grant quanto para deny.
- A policy permissiva `FOR ALL` de Atendimentos foi removida. SELECT, INSERT, UPDATE e DELETE agora têm policies separadas; tenant continua obrigatório e é composto com `atendimentos.view` ou `atendimentos.manage`. UPDATE protege linha antiga e nova.
- `get_revenue_report` e `get_net_result` exigem `can_access_organization AND reports.finance`; `get_commission_report` exige `can_access_organization AND reports.professionals`. As correções financeiras efetivas de junho foram preservadas e negação retorna SQLSTATE `42501` sem detalhe sensível.
- As quatro tabelas de configuração financeira continuam fora deste S1, conforme decisão E2.2: nenhuma policy de `settings.finance` foi adicionada nelas.

### TDD e isolamento

O ciclo RED → GREEN foi executado fora de produção:

- os contratos falharam antes de existir migration, snapshot, helper, policies e gates dos RPCs;
- após a implementação, o primeiro teste real alcançou a diferença do Postgres/RLS em UPDATE/DELETE negado (zero linhas, sem erro), e a asserção passou a comprovar retorno vazio e persistência intacta via service role;
- um reset limpo revelou que o baseline local não concedia DML aos papéis PostgREST. `test/fixtures/e2-local-grants.sql` replica esses ACLs somente no Supabase local e reaplica os hardenings de `organization_settings` e `role_permission_defaults`; o arquivo declara explicitamente que não é migration e não deve ir para produção;
- `SUPABASE_TEST_TARGET=local` impede que helpers legados recarreguem `.env`/`.env.local`, e o harness E2 recusa explicitamente o project ref de produção. As credenciais usadas vieram apenas de `npx supabase status -o env`, com host validado como loopback.

### Evidência local em 2026-07-15

1. `npx supabase db reset --local` terminou com código 0 e aplicou todas as migrations, incluindo `20260635000000_e2_server_permission_enforcement.sql`.
2. O catálogo local confirmou migration registrada, tabela e helper presentes, 210 defaults v1, e ausência de SELECT de `authenticated` sobre a coluna secreta `organization_settings.ai_google_key` e sobre `role_permission_defaults`.
3. `npm run e2:permissions:snapshot:check`: código 0; snapshot sincronizado com `permissions.ts`.
4. `REQUIRE_E2_MIGRATION=1 npm run test:e2:server`, usando `E2_SUPABASE_*` locais: 2/2 arquivos e 27/27 testes aprovados. A cobertura inclui helper/defaults/aliases/fail-closed, grant/deny, override cross-org, leitura direta da matriz negada, Atendimentos por operação, tenant A×B e os três RPCs.
5. `npm run precheck:fast` no mesmo alvo local e com a migration obrigatória: lint e typecheck aprovados; 137/137 arquivos de teste, 648 testes aprovados e 1 ignorado.

## Portão para produção

A decisão B foi implementada somente na migration e no Supabase local. Isso não autoriza aplicação no banco da clínica.

Antes de o banco de produção ser tocado, a fase futura exige:

1. revisão do SQL final e dos testes pelo Claude;
2. aprovação explícita do Junior sobre a migration revisada;
3. somente então uma execução controlada, separada e autorizada no banco da clínica em produção.

## Fora do S1

Não foram implementados: `settings.finance` nas quatro tabelas de configuração financeira (E2.2), enforcement de servidor de Equipe, client de Atendimentos, aplicação em produção, push, PR ou deploy.
