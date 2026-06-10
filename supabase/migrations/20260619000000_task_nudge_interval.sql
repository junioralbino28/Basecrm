-- =============================================================================
-- organization_settings.task_nudge_interval_minutes — nudge de tarefas (N3)
-- =============================================================================
-- Adendo 2026-06-10: pop-up "N tarefas de hoje em aberto" no workspace clínica.
-- null = desligado (default) · 15/30/60 = aviso a cada N minutos.
--
-- SÓ ARQUIVO — quem aplica é o orquestrador (via MCP), nunca esta execução.
--
-- RLS: NENHUMA policy nova. organization_settings já tem no core
-- (20260311013000_core_multi_tenant_rls.sql):
--   select = can_access_organization  (o nudge da recepção LÊ o intervalo)
--   mutate = can_configure_organization (só admin configura — "editável só
--   por quem pode configurar a org", ex.: Adel; a Vitória não muda)
--
-- Invariante de domínio NO BANCO (lição F4 — defense-in-depth):
--   intervalo é null OU um de 15/30/60 — nada de "aviso a cada 7 minutos".
-- =============================================================================

alter table public.organization_settings
  add column if not exists task_nudge_interval_minutes integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'organization_settings_task_nudge_interval_chk'
  ) then
    alter table public.organization_settings
      add constraint organization_settings_task_nudge_interval_chk
      check (
        task_nudge_interval_minutes is null
        or task_nudge_interval_minutes in (15, 30, 60)
      );
  end if;
end $$;
