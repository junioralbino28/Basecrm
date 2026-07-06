-- =============================================================================
-- FK compostas (organization_id, id) — hardening cross-org do CRM core
-- Fix do achado High 4 (auditoria Codex 2026-07-03), defesa em profundidade.
-- =============================================================================
-- A API pública gravava FKs (board/stage/contact/company) vindas do body validando
-- só o formato UUID; o insert usa service_role (bypassa RLS). Permitia uma linha da
-- org A referenciar objeto da org B (oráculo de existência + corrupção de join).
--
-- Defesa 1 (código, já aplicada): assertBelongsToOrg nas rotas públicas de
--   deals/contacts/activities → 422 se o FK não pertence à org.
-- Defesa 2 (esta migração): o PRÓPRIO Postgres exige que filho e pai compartilhem a
--   org — vale até para service_role.
--
-- Complementa 20260620000000 (que cobriu atendimentos/tasks/commission_*). Aqui:
-- deals e contacts. NULLs seguem MATCH SIMPLE (referência NULL continua permitida).
--
-- ESCOPO CONSERVADOR: as FKs de deals/contacts eram todas NO ACTION (sem ON DELETE),
-- então a composta NÃO muda semântica de delete. `activities` FICA DE FORA daqui de
-- propósito — suas FKs têm ON DELETE CASCADE (deal_id) e SET NULL (contact_id), e
-- SET NULL é impossível numa composta com organization_id NOT NULL; activities segue
-- protegida pela Defesa 1 (código).
--
-- PRÉ-REQUISITO (rodar ANTES via MCP, no Gate Gaara): confirmar ZERO linhas cross-org
-- órfãs — senão o ALTER falha. Query de diagnóstico no fim deste arquivo (comentada).
-- =============================================================================

-- Pais que ainda não tinham UNIQUE (organization_id, id) — id já é PK, custo trivial.
create unique index if not exists uq_boards_org_id on public.boards(organization_id, id);
create unique index if not exists uq_board_stages_org_id on public.board_stages(organization_id, id);
create unique index if not exists uq_crm_companies_org_id on public.crm_companies(organization_id, id);

-- deals: board/stage/contact/company na MESMA org
alter table public.deals drop constraint if exists deals_board_id_fkey;
alter table public.deals drop constraint if exists deals_stage_id_fkey;
alter table public.deals drop constraint if exists deals_contact_id_fkey;
alter table public.deals drop constraint if exists deals_client_company_id_fkey;
alter table public.deals
  add constraint deals_board_same_org_fkey
    foreign key (organization_id, board_id) references public.boards(organization_id, id),
  add constraint deals_stage_same_org_fkey
    foreign key (organization_id, stage_id) references public.board_stages(organization_id, id),
  add constraint deals_contact_same_org_fkey
    foreign key (organization_id, contact_id) references public.contacts(organization_id, id),
  add constraint deals_company_same_org_fkey
    foreign key (organization_id, client_company_id) references public.crm_companies(organization_id, id);

-- contacts: client_company na MESMA org
alter table public.contacts drop constraint if exists contacts_client_company_id_fkey;
alter table public.contacts
  add constraint contacts_company_same_org_fkey
    foreign key (organization_id, client_company_id) references public.crm_companies(organization_id, id);

-- -----------------------------------------------------------------------------
-- DIAGNÓSTICO cross-org (rodar via MCP ANTES de aplicar; deve retornar 0 linhas):
-- -----------------------------------------------------------------------------
-- select 'deals.board' t, count(*) from public.deals d join public.boards p on p.id=d.board_id where d.board_id is not null and p.organization_id <> d.organization_id
-- union all select 'deals.stage', count(*) from public.deals d join public.board_stages p on p.id=d.stage_id where d.stage_id is not null and p.organization_id <> d.organization_id
-- union all select 'deals.contact', count(*) from public.deals d join public.contacts p on p.id=d.contact_id where d.contact_id is not null and p.organization_id <> d.organization_id
-- union all select 'deals.company', count(*) from public.deals d join public.crm_companies p on p.id=d.client_company_id where d.client_company_id is not null and p.organization_id <> d.organization_id
-- union all select 'contacts.company', count(*) from public.contacts c join public.crm_companies p on p.id=c.client_company_id where c.client_company_id is not null and p.organization_id <> c.organization_id;
