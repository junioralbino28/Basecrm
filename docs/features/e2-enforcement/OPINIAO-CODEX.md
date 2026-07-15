# E2 — Opinião do Codex

> **Decisão registrada em 2026-07-15.** A recomendação abaixo foi aprovada pelo Junior para a futura fase de servidor. Esta etapa não autoriza migration, alteração de policy nem acesso ao banco de produção.

## Arquitetura

Concordo com a arquitetura em duas camadas descrita no SPEC:

1. o cliente esconde navegação e conteúdo para oferecer uma UX coerente;
2. o servidor ou o banco impede que uma chamada direta devolva ou altere dados.

O gate de cliente nunca deve ser tratado como barreira de segurança. Para superfícies que já passam por Route Handlers, o padrão existente `requireTenantAccess({ requiredPermissions })` continua sendo o caminho mais simples. Para superfícies acessadas diretamente pelo cliente Supabase, a barreira efetiva precisa permanecer no banco.

## Decisão A/B: recomendação B aprovada

Recomendo **B — policies/RPCs no banco consultando as permissões do usuário** para Financeiro e Atendimentos.

A opção A, apenas roteando o código da aplicação por APIs novas, não fecharia o acesso atual: um usuário autenticado ainda poderia chamar diretamente a tabela `atendimentos` pelo PostgREST ou executar os RPCs financeiros com o próprio JWT. Para A virar enforcement real seria necessário também revogar o acesso direto de `authenticated` e executar as operações por um cliente privilegiado no servidor. Isso aumenta a superfície de API, duplica o CRUD existente e ainda exige alteração de grants/policies.

B preserva o desenho atual, mantém o banco como última barreira e permite compor isolamento de tenant com permissões granulares:

- `atendimentos.view` para `SELECT`;
- `atendimentos.manage` para `INSERT`, `UPDATE` e `DELETE`;
- `reports.finance` e `reports.professionals` nas validações internas dos RPCs `SECURITY DEFINER`;
- `settings.finance` nas tabelas/RPCs de configuração financeira correspondentes.

### Trava obrigatória para a fase de servidor

A implementação de B fica para uma fase posterior e deve cumprir, antes de tocar qualquer banco:

1. migration aditiva, pequena e reversível;
2. helper SQL permission-aware sem recursão de RLS e com `search_path` explícito;
3. preservação do isolamento por `organization_id` — permissão nunca substitui tenant access;
4. testes de isolamento cobrindo tenant A versus tenant B, negação explícita, permissão concedida e defaults por papel;
5. testes dos RPCs `SECURITY DEFINER`, inclusive chamada direta por usuário autenticado;
6. revisão do Claude e aprovação explícita do Junior sobre a migration;
7. somente depois, aplicação controlada no banco. Nenhuma migration ou policy será criada/aplicada no lote atual.

## Correções ao PLAN verificadas no código

Os componentes `FinanceiroSettings`, `ProductsSettings`, `ProfessionalsSettings` e `IntegrationsSettings` não existem em arquivos separados: são componentes inline em `features/settings/SettingsPage.tsx`. O gate será mantido nesse arquivo, sem separação/refatoração especulativa.

O menu Financeiro/Profissionais é montado em `components/Layout.tsx`, com componentes auxiliares em `components/navigation`. Esse ponto não aparece na lista de arquivos da Task 1, mas precisa entrar no gate de cliente para cumprir o critério do SPEC de esconder a navegação.

## Riscos e lacunas a acompanhar

- `loadPermissionOverrides` hoje converte qualquer erro em `{}`. Para um papel cujo default permite acesso, uma negação explícita pode falhar aberta se a leitura de overrides falhar. A fase de servidor deve definir comportamento fail-closed para operações sensíveis sem derrubar o restante do CRM.
- Os RPCs financeiros atuais validam papel com `can_configure_organization`; isso não representa overrides que concedem ou negam permissão. A futura migration precisa substituir/compor esse gate sem enfraquecer o tenant check.
- Complementar `requireAdminTenantContext` com uma checagem depois do gate por papel permite negar acesso a admins, mas não permite que um override conceda acesso a staff. A semântica de concessão deve ser decidida antes do enforcement de servidor de Equipe.
- O carregamento client-side de permissões precisa ter estado de erro definido para não produzir spinner infinito nem piscar conteúdo protegido.
- Alterações de permissão durante uma sessão podem deixar cache/UI defasados; `refreshProfile`, troca de tenant e login/logout devem manter o mapa sincronizado.

## Escopo do lote atual

Este lote implementa apenas foundation (Tasks 0.1–0.3) e gates de cliente de Financeiro, Configurações, Equipe e navegação, sempre com TDD. Ficam explicitamente de fora: servidor de Equipe, servidor de Financeiro/Atendimentos, cliente de Atendimentos, migrations, push e deploy.
