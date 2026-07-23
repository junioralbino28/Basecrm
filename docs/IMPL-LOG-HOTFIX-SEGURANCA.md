# IMPL-LOG — Hotfix de segurança das RPCs e ações de canal

Data: 2026-07-23

Branch: `feat/funil-construtor`

Base recebida: `b693d63`

Pedido: `docs/PEDIDO-HOTFIX-SEGURANCA.md`

## 1. Limites respeitados

- Supabase usado exclusivamente em `http://127.0.0.1:54321`.
- Nenhuma consulta ou alteração no projeto de produção.
- Migration aplicada somente com `supabase migration up --local`.
- Nenhum `db reset`.
- Nenhum push ou deploy.
- Nenhuma alteração de UI, C2 ou C2D.

A primeira tentativa de invocar a CLI com o filtro `rtk npx` foi recusada pelo
próprio wrapper antes de iniciar o Supabase (`Missing script: "supabase"`).
Portanto, não houve tentativa parcial de migration nem alteração no banco. A
invocação foi corrigida para `rtk proxy npx supabase migration up --local`, que
aplicou a migration local com sucesso.

## 2. Prova RED anterior à migration

O teste final `test/contactStageCountsSecurity.local.test.ts` foi executado
antes da migration, via PostgREST local, com dois tenants e dois usuários
`clinic_admin`.

As quatro chamadas legadas foram aceitas e retornaram agregados globais:

| Chamada | Resultado local anterior ao hotfix |
|---|---|
| Tenant A → `get_contact_stage_counts()` | `null: 1`, `CUSTOMER: 1`, `LEAD: 99` |
| Tenant B → `get_contact_stage_counts()` | exatamente os mesmos agregados |
| Tenant A → `get_dashboard_stats()` | `total_deals: 80`, `pipeline_value: 24550`, `total_contacts: 101` |
| Tenant B → `get_dashboard_stats()` | exatamente os mesmos agregados |

Os números são exclusivamente do ambiente local semeado e das fixtures
descartáveis do teste. O RED terminou com 1 teste passando e 4 falhando:

- as duas RPCs zero-arg ainda existiam;
- a assinatura tenantizada ainda não existia;
- o acesso cruzado e o acesso anônimo ainda não podiam ser recusados por ela.

## 3. Correção das RPCs

Migration:
`supabase/migrations/20260723000000_hotfix_tenant_stage_counts.sql`.

Alterações:

- revogação e remoção, sem `CASCADE`, de:
  - `public.get_contact_stage_counts()`;
  - `public.get_dashboard_stats()`;
- `get_dashboard_stats()` não foi recriada porque não possui consumidor vivo;
- criação de
  `public.get_contact_stage_counts(p_organization_id uuid)` com:
  - `SECURITY INVOKER`;
  - `STABLE`;
  - `SET search_path = ''`;
  - recusa explícita para organização nula, usuário anônimo ou tenant sem acesso;
  - erro `42501` nos casos de autorização;
  - filtro explícito por `organization_id` e `deleted_at is null`;
  - estágio nulo agrupado como `UNKNOWN`;
  - `EXECUTE` somente para `authenticated`.

Aplicação local:

```text
Applying migration 20260723000000_hotfix_tenant_stage_counts.sql...
Migrations applied
```

O serviço passou a exigir `organizationId`, chamar apenas a assinatura
`{ p_organization_id }` e recusar UUID inválido antes do PostgREST. O hook
`useContactStageCounts` passou a usar a RPC segura, removendo a contagem no
browser limitada a 10 mil contatos.

Provas pós-fix:

- as duas assinaturas zero-arg não existem mais;
- tenant A recebe apenas A;
- tenant B recebe apenas B;
- A consultando B recebe `42501`;
- `p_organization_id: null` recebe `42501`;
- `anon` não possui permissão de execução;
- soft-delete não entra na contagem;
- estágio nulo retorna como `UNKNOWN`.

A suíte PostgREST final, agora com 6 testes, passou duas vezes consecutivas no
mesmo banco, sem reset.

Commit: `bf8f9df fix(security): isola contagem de contatos por tenant`.

## 4. Prova de que `channel` não era consumido pelas quatro actions

A busca nos clientes por consumo de `data.channel`/`connectData.channel`
encontrou somente:

```text
features/platform/tenants/TenantChannelsPage.tsx:488
const connectionId = String(data?.channel?.id || '');
```

Essa linha consome a resposta do `POST /channels`, que cria a conexão, antes de
chamar a action `/connect`; ela não consome a resposta de nenhuma das quatro
actions do hotfix.

Consumidores verificados das actions:

- `TenantChannelsPage.tsx`: linhas 492, 530, 563, 662 e 713;
- `TenantConversationsPage.tsx`: linhas 632 e 662.

Eles usam somente `pairing`, `webhook`, `healthcheck`, `send_test` ou `error` e
recarregam o DTO seguro. Nenhum lê `channel` das actions. Por isso o campo pôde
ser omitido sem alteração de UI.

## 5. Sanitização das ações de canal

Rotas corrigidas:

- `connect`;
- `healthcheck`;
- `disconnect`;
- `send-test`.

Alterações comuns:

- remoção de `channel` das respostas;
- `select` pós-update reduzido a `id`;
- mensagens do resolvedor de credenciais substituídas por mensagens genéricas;
- redação de valores literais e URL-encoded de `apiKey`/`webhookSecret`;
- redação de atribuições textuais e JSON, inclusive `"apiKey":"..."`;
- testes de sucesso, erro do resolvedor, erro de persistência e erro do
  provedor nas quatro rotas;
- warnings de webhook testados em `connect` e `healthcheck`.

A revisão independente encontrou que payloads brutos da Evolution eram
persistidos em `metadata`, enquanto `toPublicChannelConnection` saneava apenas
`config`. Isso permitiria que um segredo ecoado pelo provedor reaparecesse em
uma leitura posterior.

Foi acrescentada sanitização recursiva:

- propriedades `apiKey`/`webhookSecret` e variações são removidas;
- strings aninhadas têm valores conhecidos redigidos;
- payloads são saneados antes de persistir;
- `config` e `metadata` são saneados novamente pelo DTO público.

Os quatro achados da revisão independente ficaram fechados:

1. payloads persistidos/DTO;
2. chave JSON entre aspas;
3. erros de persistência das quatro actions;
4. organização nula provada em runtime.

Commit: `c036fb8 fix(security): remove secrets das ações de canal`.

## 6. Gates finais

### Testes direcionados

- RPC serviço/hook/migration estática: `13/13`.
- PostgREST local final: `6/6`, duas vezes consecutivas.
- Rotas, redator, DTO público e consumidores: `35/35`.

### Suíte local completa

```text
Test Files  203 passed (203)
Tests       932 passed (932)
```

O resultado confere com o baseline aprovado: `890 + 42 testes novos = 932`.
As respostas HTTP 401/400 exibidas durante a suíte pertencem a casos
adversariais que confirmam recusas; o processo terminou com código zero.

### Precheck

```text
lint:      limpo, zero warnings
typecheck: limpo
test:run:  785 passed | 147 skipped
```

`npm run precheck:fast` terminou com código zero.

### Banco

```text
supabase db lint --local --level error
No schema errors found
```

## 7. Estado final

- Banco local preservado com os dados da C2C.
- Migration aplicada localmente sem reset.
- Produção intacta.
- Sem push.
- Sem deploy.
- Entrega dividida nos commits de RPC, endpoints e este registro documental.
