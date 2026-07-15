# E2 — Design da fase de servidor (S0)

> Status: proposta para revisão do Claude e aprovação do Junior.
>
> Este documento não contém migration nem SQL executável. O portão S1 continua fechado.

## Decisão resumida

Recomendo um `public.has_permission(permission_key text)` que resolve somente a permissão efetiva do usuário autenticado. O helper não recebe tenant e nunca substitui os helpers de isolamento existentes. Toda superfície protegida deve compor as duas decisões: `tenant AND permission`.

Para os defaults de cargo, recomendo a opção **(a), endurecida com geração e verificação de drift**: uma tabela versionada `role_permission_defaults` no banco recebe um snapshot gerado da mesma fonte canônica usada pelo TypeScript. Não recomendo reescrever manualmente as listas de allow/deny na migration.

## 1. Fonte única dos defaults de cargo

### Recomendação

Os dados hoje construídos em `lib/auth/permissions.ts` continuam sendo a fonte funcional, mas devem ser extraídos no S1 para um manifesto TypeScript puro e versionado, consumido por dois caminhos:

1. `permissions.ts` deriva `APP_PERMISSIONS`, `ROLE_PERMISSION_DEFAULTS`, aliases legados e o fallback de cargo desse manifesto;
2. um gerador determinístico produz o snapshot da migration que alimenta `role_permission_defaults`.

O manifesto deve representar explicitamente:

- a versão da matriz;
- todas as chaves da taxonomia;
- os seis valores de role aceitos (`agency_admin`, `agency_staff`, `clinic_admin`, `clinic_staff`, `admin` e `vendedor`);
- o booleano efetivo de cada par role × permission;
- a equivalência atual de `admin` com o default de `agency_admin` e de `vendedor` com o default de `clinic_staff`;
- o fallback atual de role desconhecido para a matriz operacional de `clinic_staff`/`vendedor`.

A migration futura não importa TypeScript em runtime. Ela contém um snapshot gerado e imutável. A tabela no banco é uma cópia implantada da fonte canônica, não uma segunda fonte editada à mão.

### Versionamento e prevenção de drift

`role_permission_defaults` deve guardar snapshots por versão, e uma linha de estado deve indicar qual versão está ativa. Uma mudança futura nos defaults segue este fluxo:

1. alterar o manifesto e incrementar sua versão;
2. gerar uma migration nova — nunca editar uma migration já aplicada;
3. inserir o snapshot completo da nova versão;
4. validar completude e só então trocar atomicamente a versão ativa;
5. executar os testes de contrato e de integração antes do deploy da aplicação.

O S1 deve criar três travas contra divergência:

- teste de geração em modo `--check`, que falha se o snapshot versionado não corresponder byte a byte ao manifesto;
- teste de completude que exige exatamente um booleano para cada role × chave e rejeita chave/role órfãos;
- teste contra Supabase local/branch que compara o snapshot ativo do banco com `getDefaultPermissionMap` para todos os roles, incluindo os legados.

Se alguém mudar a taxonomia/default no TS e esquecer a migration, o primeiro teste falha. Se a migration no ambiente de teste não estiver sincronizada, o terceiro falha. Em produção, a ordem futura deve ser migration primeiro e aplicação depois; enquanto a estrutura estiver ausente ou incompleta, o banco nega.

### Por que não a opção (b)

Manter `can_configure_organization` como gate de cargo e aplicar apenas overrides não reproduz a semântica do client:

- uma concessão para `clinic_staff` continuaria bloqueada pelo gate coarse;
- `agency_staff` tem relatórios liberados por default no TS, mas `can_configure_organization` o bloqueia hoje;
- uma negação granular para um admin exigiria exceções sobrepostas ao gate de cargo.

Essa opção evita a tabela, mas não implementa o modelo aprovado de “default sobrescrito por override”. Ela deve ser descartada.

## 2. Contrato de `has_permission`

Assinatura conceitual: `public.has_permission(permission_key text) returns boolean`.

Propriedades obrigatórias:

- `STABLE`, porque a resolução é constante dentro do statement;
- `SECURITY DEFINER`, para ler `profiles`, defaults e `profile_permissions` sem depender das policies dessas tabelas;
- `search_path` vazio e todas as referências qualificadas por schema;
- sem parâmetro de `user_id`: a identidade vem exclusivamente de `auth.uid()`, impedindo consulta da permissão de outra pessoa;
- `EXECUTE` revogado de `public` e `anon`; `authenticated` pode executar porque a resposta revela somente um booleano do próprio usuário e as policies precisam chamá-lo;
- owner controlado pela migration, sem objetos mutáveis por `authenticated` no caminho de resolução.

### Algoritmo de resolução

Para a chave recebida, o helper:

1. obtém `auth.uid()`; identidade nula resulta em `false`;
2. carrega exatamente o próprio `profiles.id`; profile ausente resulta em `false`;
3. normaliza o role com a semântica já existente de `normalize_profile_role`;
4. lê o default da versão ativa para role normalizado + chave;
5. lê no máximo um override de `profile_permissions` para o mesmo `user_id` + chave;
6. valida que o `organization_id` do override é igual ao do profile; override malformado/cross-org torna a decisão `false`, em vez de cair no default;
7. retorna `override.enabled` quando há override íntegro; caso contrário, retorna o default; ausência de ambos retorna `false`.

As constraints existentes garantem unicidade de override por usuário/chave. A tabela de defaults deve garantir unicidade por versão/role/chave. Qualquer exceção de leitura aborta o statement; não há captura que transforme erro em acesso concedido.

O helper deliberadamente não verifica organização alvo. Isso mantém responsabilidades separadas e torna impossível uma chamada a `has_permission` sozinha ampliar tenant. A composição obrigatória fica nas policies e nos RPCs.

## 3. Composição `tenant AND permission`

### Atendimentos

Matriz desejada:

| Operação | Gate de tenant | Gate granular |
| --- | --- | --- |
| SELECT | `can_access_organization(organization_id)` | `atendimentos.view` |
| INSERT | `can_operate_organization(organization_id)` | `atendimentos.manage` |
| UPDATE — linha atual e linha nova | `can_operate_organization(organization_id)` | `atendimentos.manage` |
| DELETE | `can_operate_organization(organization_id)` | `atendimentos.manage` |

A policy atual de mutação é `FOR ALL`. Ela não deve ser preservada nesse formato: policies permissivas aplicáveis ao mesmo comando combinam por `OR`, então a policy de mutação poderia abrir SELECT para alguém com `manage=true` e `view=false`. O S1 deve remover a policy `FOR ALL` e criar policies separadas para INSERT, UPDATE e DELETE. Assim, o único caminho de SELECT exige `atendimentos.view`.

No UPDATE, tanto a linha existente quanto a versão nova precisam satisfazer tenant e permissão. Isso impede usar um update autorizado em A para mover a linha para B.

### RPCs financeiros `SECURITY DEFINER`

Mapeamento:

| RPC | Permissão |
| --- | --- |
| `get_revenue_report` | `reports.finance` |
| `get_net_result` | `reports.finance` |
| `get_commission_report` | `reports.professionals` |

Cada RPC continua resolvendo `v_org` pelo parâmetro opcional ou pelo profile atual, mas o preâmbulo de autorização passa a exigir:

1. organização efetiva não nula;
2. `can_access_organization(v_org)`;
3. `has_permission` para a chave do RPC.

O gate coarse `can_configure_organization` deve ser substituído nessa decisão, não mantido como um terceiro `AND`. O isolamento continua em `can_access_organization`; a autorização funcional passa para `has_permission`. Isso permite grant para `clinic_staff`, mantém clinic A fora de B e alinha `agency_staff` aos defaults do TS.

Falhas de tenant e de permissão devem retornar o mesmo erro genérico de privilégio insuficiente, sem revelar se a organização existe. Por serem `SECURITY DEFINER`, os RPCs mantêm filtros explícitos por `v_org` em todas as consultas, `search_path` vazio, referências qualificadas e os revokes/grants atuais.

O S1 deve partir das definições efetivas mais recentes: receita em `20260621000000` e comissão/líquido já corrigidos por `20260624000000`. As correções de fuso, desconto, pró-rateio, bandeira, desempate e `sem_profissional` não podem ser perdidas ao substituir o preâmbulo.

## 4. Semântica de concessão e negação

O banco deve espelhar `resolvePermissionMap`: override íntegro vence o default nos dois sentidos.

- default `true` + override `false` → nega;
- default `false` + override `true` → concede;
- sem override → usa o default versionado;
- chave desconhecida, matriz incompleta, profile ausente ou identidade ausente → nega.

Uma concessão nunca altera o escopo do usuário. `clinic_staff` de A com `reports.finance=true` pode acessar o relatório de A, mas não de B. Roles de agência mantêm o comportamento cross-tenant intencional já expresso por `can_access_organization`, ainda sujeito à permissão granular.

Observação para os testes: no default atual, `clinic_staff` já possui `atendimentos.view` e `atendimentos.manage`. Portanto, o caso inequívoco de “grant sobre default negado” deve usar `reports.finance`/`reports.professionals`. Em Atendimentos, os testes devem provar deny explícito e a restauração por override `true`.

## 5. Fail-closed

O desenho fecha por padrão em todas as ambiguidades:

- `coalesce` final conceitual para `false` quando default/override não existem;
- versão ativa ausente ou snapshot incompleto não concede;
- chave inválida não encontra default nem override válido;
- override com organização inconsistente nega;
- erro interno do helper aborta a operação;
- RLS aplica tenant e permissão em conjunto;
- RPC aborta antes de consultar tabelas quando qualquer gate falha;
- mensagem de erro não distingue tenant inexistente de permissão negada.

Não haverá fallback equivalente ao `loadPermissionOverrides` do servidor TS. Em operação sensível no banco, indisponibilidade da fonte de permissões é negação/erro.

## 6. Plano de testes do S1

### Ambiente seguro

Os testes mutáveis devem exigir credenciais dedicadas de Supabase local ou branch e um opt-in explícito. O harness deve recusar execução se a URL coincidir com o projeto de produção configurado. Service role será usado apenas para fixtures/cleanup; todas as asserções de acesso usarão usuário real autenticado pela publishable/anon key.

O skip pré-migration pode continuar no `precheck:fast`, com aviso claro. A validação obrigatória do S1 terá um modo `REQUIRE_E2_MIGRATION` no qual helper/tabela/RPC ausente é falha, nunca skip. O relatório para revisão deve vir desse modo em ambiente não produtivo.

### Contratos estáticos e drift

- snapshot gerado corresponde ao manifesto e à versão;
- matriz completa para todas as chaves e roles;
- aliases legados equivalem aos cargos canônicos esperados;
- migration nova contém helper endurecido, revokes/grants e policies separadas;
- cada RPC preserva `SECURITY DEFINER`, `STABLE`, `search_path` vazio, tenant explícito e a chave correta;
- testes de negócio existentes dos RPCs continuam verdes para impedir regressão das correções de junho.

### Integração real — helper e defaults

- admin e staff recebem os defaults esperados para as chaves protegidas;
- `admin` e `vendedor` legados espelham suas matrizes atuais;
- override `false` nega um default permitido;
- override `true` concede um default negado;
- override com `organization_id` diferente do profile é tratado como inválido e nega;
- chave desconhecida e usuário sem profile retornam `false`/erro sem dado.

### Integração real — Atendimentos/PostgREST

- user de A com permissões concedidas faz SELECT sem filtro: vê A e nunca B;
- permissão concedida não permite INSERT em B nem mover linha de A para B;
- `atendimentos.view=false` retorna conjunto vazio no SELECT direto, inclusive quando `manage=true`;
- `atendimentos.manage=false` recusa INSERT;
- UPDATE e DELETE negados deixam a linha inalterada, confirmado depois via service role;
- override `true` restaura acesso somente dentro de A;
- chamadas são feitas diretamente ao PostgREST com JWT real, sem Route Handler do app.

### Integração real — RPCs financeiros

- `clinic_admin` usa os defaults e obtém apenas os números de A;
- `clinic_admin` de A pedindo B recebe erro genérico;
- deny de `reports.finance` bloqueia diretamente receita e líquido, sem payload;
- deny de `reports.professionals` bloqueia diretamente comissão, sem payload;
- `clinic_staff` com grant de `reports.finance` acessa receita/líquido de A e continua bloqueado em B;
- `clinic_staff` com grant de `reports.professionals` acessa comissão de A;
- `agency_staff` segue seu default do TS, mas sempre pela composição explícita de tenant + permission;
- os RPCs são chamados diretamente pelo endpoint RPC/PostgREST com JWT real.

## 7. Limites e reversibilidade do S1

O S1 deverá ser uma migration nova; migrations históricas não serão editadas. A ordem interna futura será: estruturas/versionamento dos defaults, snapshot completo, helper e privilégios, policies de Atendimentos, e por fim substituição dos três RPCs. Tudo deve ocorrer atomicamente no ambiente de teste.

O rollback planejado restaura as policies anteriores e os preâmbulos anteriores dos RPCs, desativa a nova versão do manifesto e só então remove objetos novos sem dependentes. Esse rollback será documentado/testado no S1, mas nunca executado em produção sem o mesmo portão de aprovação.

As quatro tabelas de configuração financeira (`payment_method_fees`, `commission_rules`, `fixed_costs`, `commission_payments`) continuam protegidas por `can_configure_organization`. O PLAN-SERVIDOR limita este S1 aos RPCs `reports.*`; portanto, alinhar grants de `settings.finance` nessas tabelas é uma superfície remanescente e exige decisão/revisão própria, não será incluída silenciosamente.

## 8. Portão

Nenhuma migration, policy, função SQL ou teste que escreva em banco será criada antes de:

1. revisão deste documento pelo Claude;
2. aprovação explícita do Junior para abrir o S1.

Mesmo no S1, nada será aplicado ao banco de produção sem testes obrigatórios em Supabase local/branch, nova revisão do Claude e novo aval explícito do Junior sobre o SQL final.
