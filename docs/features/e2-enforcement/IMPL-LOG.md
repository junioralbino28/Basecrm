# E2 — Log de implementação do lote client/foundation

> Data: 2026-07-15
>
> Branch: `feat/e2-enforcement`
>
> Estado: lote autorizado concluído localmente; aguardando revisão do diff pelo Claude. Sem push e sem deploy.

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

## Decisões e ajustes incorporados

- Os componentes de Produtos, Profissionais, Financeiro e Integrações permanecem inline em `features/settings/SettingsPage.tsx`. Nenhum arquivo artificial foi criado para separá-los.
- Os links de relatório Financeiro e Profissionais encontrados em `components/Layout.tsx` foram incluídos no gate. A busca em `components/navigation` não encontrou uma segunda cópia desses links que exigisse alteração.
- A antiga decisão por papel em Configurações e Equipe foi substituída pelo mapa de permissões resolvido. Isso permite tanto negação explícita para admin quanto concessão por override para staff no client.
- A aba Dados permaneceu sem gate porque não existe uma chave correspondente definida no PLAN/SPEC para este lote.
- Rotas diretas de Configurações inicializam a aba a partir do pathname, evitando montar brevemente conteúdo protegido antes do efeito de sincronização.
- A tela Equipe não chama os endpoints de usuários, convites ou tenants enquanto `settings.users.manage` não for explicitamente `true`.
- O endpoint de foundation é apenas leitura das permissões resolvidas. Nenhum enforcement de servidor foi adicionado neste lote.

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

## Trava da futura fase de servidor

A decisão aprovada é B: enforcement no banco por RLS/policies e validações permission-aware nos RPCs. Esta aprovação arquitetural não autoriza implementação nem aplicação agora.

Antes de qualquer banco ser tocado, a fase futura exige:

1. migration pequena, aditiva e revisável;
2. testes de isolamento entre tenants, além de grants, denies, defaults e RPCs `SECURITY DEFINER`;
3. revisão do Claude;
4. aprovação explícita do Junior sobre a migration;
5. somente então uma execução controlada no banco da clínica em produção.

## Fora do lote

Não foram implementados: enforcement de servidor de Equipe, Financeiro ou Atendimentos; client de Atendimentos; migration; policy; alteração de banco; push; PR; deploy.
