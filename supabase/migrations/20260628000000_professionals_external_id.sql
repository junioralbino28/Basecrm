-- =============================================================================
-- professionals.external_id — mapa dentista local ↔ Clinicorp (Dentist_PersonId)
-- =============================================================================
-- Populado pelo sync da agenda (POST /api/agenda/professionals-sync). NÃO é secreto.
-- O índice único (organization_id, external_id) é o arbiter do upsert onConflict do sync.
-- NULLs distintos no Postgres → dentistas manuais (sem mapa) não colidem entre si.
-- =============================================================================

alter table public.professionals
  add column if not exists external_id text;

create unique index if not exists uniq_professionals_org_external_id
  on public.professionals (organization_id, external_id);
