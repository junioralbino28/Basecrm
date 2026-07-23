# Banco de dados — schema completo

> Parte da documentação-mãe. Índice geral em [docs/README.md](../README.md).
> Fonte: leitura integral das 55 migrations em `supabase/migrations/` (2026-07-23).
> Nada aqui foi derivado de banco vivo — tudo vem do SQL versionado.
> Produção (`main`) tem as 34 primeiras; as 21 restantes (funil/etiquetas) estão
> só na branch `feat/funil-construtor`.

O produto nasceu **single-tenant** (CRM Kanban + IA) e evoluiu para
**multi-tenant** (plataforma white-label: agência + clínicas), com camada
clínico-financeira e um **motor de automação de funil** (WhatsApp). Padrão de
defesa em profundidade: invariantes em CHECK, RLS por helper, `SECURITY DEFINER`
com `search_path` fixo, e FKs compostas `(organization_id, id)` anti-cross-tenant.

## 1. Migrations em ordem (resumo de 1 linha cada)

| Arquivo | Resumo |
|---|---|
| `20251201000000_schema_init` | Schema base: CRM single-tenant (deals/contacts/boards/activities), IA, segurança (audit/rate limit/consents), webhooks (pg_net), API keys, buckets `avatars`/`audio-notes`/`deal-files`; RLS inicial "USING(true)". |
| `20260205000000_add_performance_indexes` | Índices de performance. |
| `20260310000000_platform_provisioning` | White-label: `organization_editions`, `organization_domains`, `provisioning_runs`. |
| `20260310010000_platform_channel_connections` | `channel_connections` (canais WhatsApp por org). |
| `20260310020000_platform_conversations` | Inbox: `conversation_threads`, `conversation_messages`. |
| `20260310030000_profile_permissions` | Overrides de permissão por usuário. |
| `20260311010000_multi_tenant_policy_helpers` | Helpers RLS básicos. |
| `20260311013000_core_multi_tenant_rls` | Núcleo RBAC: `can_access/operate/configure_organization` + policies por tenant nas tabelas core. |
| `20260612000000_rls_hardening_clinic_pii` | Fecha 4 vazamentos cross-tenant antes da PII real. |
| `20260613..20260616` | Camada clínica: `professionals`, `atendimentos` (+invariantes de faturamento), config financeira (taxas, comissões, custos fixos). |
| `20260617000000_lead_sources` | Catálogo de origens de lead. |
| `20260618..20260619` | `tasks` + intervalo de nudge. |
| `20260620000000_fk_cross_org_hardening` | FKs compostas anti-cross-tenant (clínica). |
| `20260621000000_finance_reports_rpcs` | RPCs `get_revenue_report`, `get_commission_report`, `get_net_result`. |
| `20260622..20260623` | IA own-row · trigger anti-escalonamento de privilégio em `profiles`. |
| `20260624000000_finance_rpcs_fix` | Pró-rateio de custos fixos, bandeira normalizada, unique de comissão. |
| `20260625000000_deal_files_storage_tenant_rls` | Storage `deal-files` escopado por deal/tenant. |
| `20260626..20260629` | Integração Clinicorp: `clinicorp_config`, `appointments` (cache), `external_id` de profissional. |
| `20260630*_m6_*` | Endurecimento M6: fecha 8 tabelas "USING(true)", tranca secrets p/ service_role, `search_path` pinado, colunas-secret de `organization_settings`. |
| `20260631..20260634` | API keys por `can_configure` · `report_tokens` (credencial isolada) · FKs compostas CRM · convites com cargo+overrides. |
| `20260635000000_e2_server_permission_enforcement` | `role_permission_defaults` (snapshot v1, 35 chaves) + `has_permission()`. |
| `20260718*_funil_f1..f6` | Motor do funil: authoring → publicação imutável → outbox → scheduler pg_cron → waits/takeover → RPC do builder. |
| `20260720*_c1a + e3` | Passo `switch` N-ário + execução · snapshot v2 (+`automation.*`) · `automation_tick_health` + gate de envio real. |
| `20260722*_c2a + c2b` | Snapshot v3 (+`tags.*`/`lead_sources.*`, ATIVO) · taxonomia de etiquetas + ponte legada · origens auditáveis · dependências por UUID + "1 publicada por etiqueta" · **roteamento por esfriamento (5 dias)** · switch v3 (`deal.tag_ids`) · pausa por inbound. |

## 2. Grupos de tabelas

- **Tenant/auth:** `organizations`, `organization_settings` (config IA + quiet
  hours + `automation_live_enabled`), `profiles`, `profile_permissions`,
  `organization_invites`, `organization_editions`, `organization_domains`,
  `provisioning_runs`.
- **CRM core:** `boards`, `board_stages`, `contacts`, `crm_companies`, `deals`
  (`tags` TEXT[] é PONTE legada; `first/last_lead_source_id`), `deal_items`,
  `activities`, `deal_notes`, `deal_files`, `products`, `lifecycle_stages`
  (global), `custom_field_definitions`, `leads`, `quick_scripts`, `tags`.
- **Clínico-financeiro:** `professionals`, `atendimentos` (CHECK: `recebido ⟺
  paid_at`, `desconto ≤ valor`), `payment_method_fees`, `commission_rules`,
  `fixed_costs`, `commission_payments`, `appointments` (cache Clinicorp),
  `clinicorp_config` (secret), `lead_sources` + `lead_source_attributions`
  (histórico UTM auditável) + `lead_source_migration_reviews`, `tasks`.
- **Plataforma/conversas:** `channel_connections` (secrets, deny-all p/ cliente),
  `conversation_threads`, `conversation_messages` (estado de entrega da
  automação), `api_keys` (hash), `report_tokens`, `integration_inbound_sources`,
  `integration_outbound_endpoints`, `webhook_events_in/out`, `webhook_deliveries`.
- **IA/segurança:** `ai_conversations/decisions/audio_notes/suggestion_interactions`
  (own-row), `ai_prompt_templates`, `ai_feature_flags`, `user_settings`,
  `user_consents`, `audit_logs` (append-only), `security_alerts`,
  `system_notifications`, `rate_limits`.
- **Motor de automação:** `automations` → `automation_steps` →
  `automation_step_edges`; `message_templates`; `automation_versions`
  (IMUTÁVEL, `definition` jsonb + hash SHA-256); `automation_enrollments`
  (cursor `current_step_key`); `automation_jobs` (outbox com lease/retry/backoff,
  dead_letter após 5) → `automation_step_attempts`; `automation_waits` +
  `automation_inbox_events`; `automation_tick_health`;
  `automation_conversation_clocks` → `automation_routing_events` →
  `_candidates` + `_gates` (porteiro → `tasks`); `automation_tag_dependencies`;
  `tag_categories` → `tags` → `deal_tag_assignments`; `tag_migration_reviews`;
  `role_permission_defaults` + `permission_defaults_state`.

## 3. O fluxo do motor de automação (como as peças se ligam)

```
tag_categories ─< tags ─< deal_tag_assignments >─ deals
                    │
                    └─< automation_tag_dependencies >─ automations ─< steps ─< edges
                                                          │ published_version_id
                                                          ▼
                                                 automation_versions (imutável)
                                                          │
conversation_threads ─< automation_enrollments ───────────┤
        │                     ├─< automation_jobs ─< step_attempts
        │                     │        └─> conversation_messages (automation_job_id)
        │                     └─< automation_waits ─< inbox_events
        │
conversation_messages ─(trigger)─> conversation_clocks ─(cron 5min)─> routing_events
                                                            ├─< candidates
                                                            └─< gates ─> tasks (porteiro)
```

Regras vivas no banco: 1 automação publicada por etiqueta (guard) · versão
publicada imutável (trigger) · identidade de inscrição/job imutável · relógio de
esfriamento reinicia com QUALQUER mensagem da conversa (inbound ou outbound) ·
1 candidato → inscreve; 2+ → porteiro sem inscrição; nova mensagem cancela
porteiros abertos.

## 4. RLS — o padrão e as exceções

**Helpers** (`SECURITY DEFINER`, definidos em `20260311*`):
- `can_access_organization` → gate de SELECT (agência OU membro da org)
- `can_operate_organization` → mutação operacional (+ clinic_staff/vendedor)
- `can_configure_organization` → configuração (agency_admin/clinic_admin)
- `has_permission(key)` → snapshot ativo + override por usuário (ver §5)

**Exceções intencionais ao padrão:**
- Own-row (`user_id`): `user_settings`, `ai_*`, `user_consents`.
- Deny-all p/ cliente (só service_role): `channel_connections`,
  `clinicorp_config`, `rate_limits`, `role_permission_defaults`,
  `permission_defaults_state`, `automation_tick_health`.
- SELECT também restrito a admin: config financeira, `report_tokens`, convites,
  editions, webhooks, `security_alerts`.
- `organization_settings`: privilégio POR COLUNA — cliente não lê `ai_*_key`.
- Motor de automação: SELECT por permissão; **toda mutação via RPC service_role**
  (tabelas sem policy de INSERT/UPDATE para authenticated).
- `audit_logs` append-only.

## 5. Permissões de aplicação (snapshots versionados)

- Matriz `role_permission_defaults` (versão × papel × chave) com **trava de
  completude** na migration (v1=210 linhas · v2=222 · v3=246 = 41 chaves × 6 papéis).
- `permission_defaults_state.active_version = 3` (ATIVO).
- Checagem `has_permission(key)`: papel do perfil → default do snapshot ativo →
  override em `profile_permissions` (validado contra a org). Chave fora do
  snapshot ⇒ false.
- v3: `tags.manage`/`lead_sources.manage` = admin/agency_admin/agency_staff/
  clinic_admin · `*.assign` = + clinic_staff/vendedor · `automation.edit` só
  gestão, `automation.operate` inclui staff.

## 6. Scheduler (pg_cron + pg_net + Vault)

- **Único job agendado:** `automation-tick-every-5-minutes` → `request_automation_tick()`.
- A função lê URL+secret do **Vault** (`automation_tick_url`/`_secret`), faz
  `net.http_post` no endpoint `/api/internal/automations/tick` e registra tudo em
  `automation_tick_health` (estágios + `consecutive_failures`).
- `automation_scheduler_health_at` marca `degraded` (cron/pg_net ausentes, job
  inativo, >10min sem sucesso) — e o trigger `guard_automation_live_enable`
  **impede ligar envio real com scheduler doente**.
- O trabalho pesado roda no worker externo chamado pelo tick (RPCs
  `materialize/claim/complete`, `expire_due_automation_waits`,
  `process_due_automation_routing`).
- `cleanup_rate_limits` existe mas **não tem agendamento** (não verificado quem chama).

## 7. Storage

| Bucket | Público | Policies |
|---|---|---|
| `avatars` | SIM (select) | upload authenticated; update/delete só dono (M6) |
| `deal-files` | não (10 MB) | upload/read/delete escopados por deal via `can_*_deal` |
| `audio-notes` | não | **sem policy** → deny-all p/ cliente (uso não verificado) |

## 8. Resquícios e pontos de atenção

- **BUG verificado (2ª passada):** `get_contact_stage_counts()` é declarada SEM
  parâmetro no SQL, mas `lib/supabase/contacts.ts:214` a chama com `{ org_id }`
  no caminho multi-tenant (erro de assinatura PGRST202); a chamada sem
  parâmetro, por ser SECURITY DEFINER, **conta contatos de todas as orgs**
  (vazamento de agregado). Fix: migration com versão org-filtrada.
  `get_dashboard_stats()` **não tem nenhum chamador** no app — RPC morta,
  candidata a remoção.
- Realtime publicado só para: `deals`, `activities`, `contacts`, `crm_companies`,
  `board_stages`, `boards`. Tabelas do motor e da clínica NÃO estão no canal.
- Validação das chaves de `permission_overrides` do convite é app-side (sem CHECK).
- Secrets (Vault, `channel_connections.config`, `clinicorp_config.api_token`)
  não constam das migrations — semeados por rota/admin.
