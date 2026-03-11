# Legacy Tenant Migration

Objetivo:

- mover dados operacionais do tenant legado da conta master para a clinica correta
- fazer isso com auditoria antes de executar
- abortar por padrao quando o tenant de destino ja tiver dados

Script:

- [legacy-tenant-migration.mjs](/c:/Users/PC%20Gamer/Downloads/Projeto%20CRM/Basecrm/scripts/legacy-tenant-migration.mjs)

Pre-requisitos:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SECRET_KEY` ou `SUPABASE_SERVICE_ROLE_KEY`

Uso:

```bash
node scripts/legacy-tenant-migration.mjs audit \
  --source-org <uuid-legado> \
  --target-org <uuid-clinica>
```

```bash
node scripts/legacy-tenant-migration.mjs run \
  --source-org <uuid-legado> \
  --target-org <uuid-clinica> \
  --yes
```

Escopo padrao:

- `crm_companies`
- `contacts`
- `products`
- `boards`
- `board_stages`
- `deals`
- `deal_items`
- `activities`

Escopo estendido:

- `organization_settings`
- `ai_prompt_templates`
- `ai_feature_flags`
- `channel_connections`
- `conversation_threads`
- `conversation_messages`
- `integration_inbound_sources`
- `integration_outbound_endpoints`
- `webhook_events_in`
- `webhook_events_out`
- `webhook_deliveries`
- `api_keys`

Para incluir esse segundo bloco:

```bash
node scripts/legacy-tenant-migration.mjs audit \
  --source-org <uuid-legado> \
  --target-org <uuid-clinica> \
  --extended
```

```bash
node scripts/legacy-tenant-migration.mjs run \
  --source-org <uuid-legado> \
  --target-org <uuid-clinica> \
  --extended \
  --yes
```

Regras de seguranca:

- `audit` nao altera dados
- `run` aborta se o tenant de destino ja tiver dados nas tabelas do escopo principal
- `--force` so deve ser usado quando a mistura de dados no destino for intencional
- `organization_settings` exige destino vazio por padrao, porque costuma ser singleton por clinica

Ordem recomendada:

1. criar e validar a clinica de destino
2. rodar `audit`
3. conferir contagens
4. rodar `run` sem `--extended`
5. validar boards, deals, contatos e produtos na clinica
6. so depois considerar `--extended`
