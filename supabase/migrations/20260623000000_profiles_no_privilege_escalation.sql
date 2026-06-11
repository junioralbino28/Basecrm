-- =============================================================================
-- CRÍTICO — trava de escalonamento de privilégio em profiles
-- =============================================================================
-- Achado do review adversarial F8 (lente de segurança, confirmado): a policy
-- `profiles_update` (schema_init) era USING/WITH CHECK (id = auth.uid()) SEM
-- restrição de coluna. Qualquer authenticated podia reescrever o PRÓPRIO
-- `role` e `organization_id`:
--   • clinic_staff (Vitória) → role='clinic_admin' → can_configure vira true
--     → libera TODO o financeiro do Adel + grava commission_payments;
--   • qualquer um → organization_id = outra org → quebra o multi-tenant inteiro.
-- A RLS por linha não pega isso (a linha continua sendo a do próprio usuário).
--
-- Fix: trigger BEFORE UPDATE que CONGELA role e organization_id pra usuário
-- comum. Só backend confiável (service_role / migrações) e admin de agência
-- reatribuem. SECURITY INVOKER de propósito — precisamos do `current_user`
-- REAL do caller (definer mascararia como o dono da função).
-- =============================================================================

create or replace function public.prevent_profile_privilege_escalation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- current_user = 'authenticated' SÓ em request de usuário logado via PostgREST.
  -- service_role / postgres (migração, admin API, handle_new_user) caem fora →
  -- reatribuição legítima de papel/org continua funcionando. Admin de agência
  -- também pode reatribuir.
  if current_user <> 'authenticated' or public.is_agency_admin_role() then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'não é permitido alterar o próprio papel (role)';
  end if;
  if new.organization_id is distinct from old.organization_id then
    raise exception 'não é permitido alterar a própria organização';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_profile_privilege_escalation on public.profiles;
create trigger trg_prevent_profile_privilege_escalation
  before update on public.profiles
  for each row
  execute function public.prevent_profile_privilege_escalation();
