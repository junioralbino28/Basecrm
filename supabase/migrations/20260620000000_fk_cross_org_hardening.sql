-- =============================================================================
-- FK compostas (organization_id, id) — hardening cross-org (follow-up review F4)
-- =============================================================================
-- Achado da lente de segurança do review adversarial da F4 (confirmado): as
-- FKs single-column dos filhos clínico-financeiros aceitavam referenciar linha
-- de OUTRA org (se o UUID fosse conhecido) — a RLS WITH CHECK valida só o
-- organization_id da própria linha, e a validação de FK roda como dono da
-- tabela (bypassa RLS). Sem leak direto (SELECT continua RLS'd), mas:
--   (a) oráculo de existência cross-tenant;
--   (b) atribuição corrompida nos relatórios da F8 que confiam nesses joins.
-- Fix: o PRÓPRIO Postgres agora exige que filho e pai compartilhem a org —
-- vale até pra service_role (que bypassa RLS). Pré-requisito da F8.
--
-- Pais ganham UNIQUE INDEX (organization_id, id) — id já é PK, custo trivial.
-- Filhos trocam a FK single pela composta. Colunas nullable seguem MATCH
-- SIMPLE (default): referência NULL continua permitida.
-- =============================================================================

-- Pais (alvo das referências compostas)
create unique index if not exists uq_contacts_org_id on public.contacts(organization_id, id);
create unique index if not exists uq_deals_org_id on public.deals(organization_id, id);
create unique index if not exists uq_professionals_org_id on public.professionals(organization_id, id);
create unique index if not exists uq_products_org_id on public.products(organization_id, id);

-- atendimentos: contact/deal/professional/product na MESMA org
alter table public.atendimentos drop constraint if exists atendimentos_contact_id_fkey;
alter table public.atendimentos drop constraint if exists atendimentos_deal_id_fkey;
alter table public.atendimentos drop constraint if exists atendimentos_professional_id_fkey;
alter table public.atendimentos drop constraint if exists atendimentos_product_id_fkey;
alter table public.atendimentos
  add constraint atendimentos_contact_same_org_fkey
    foreign key (organization_id, contact_id) references public.contacts(organization_id, id),
  add constraint atendimentos_deal_same_org_fkey
    foreign key (organization_id, deal_id) references public.deals(organization_id, id),
  add constraint atendimentos_professional_same_org_fkey
    foreign key (organization_id, professional_id) references public.professionals(organization_id, id),
  add constraint atendimentos_product_same_org_fkey
    foreign key (organization_id, product_id) references public.products(organization_id, id);

-- commission_rules / commission_payments: professional na MESMA org
alter table public.commission_rules drop constraint if exists commission_rules_professional_id_fkey;
alter table public.commission_rules
  add constraint commission_rules_professional_same_org_fkey
    foreign key (organization_id, professional_id) references public.professionals(organization_id, id);

alter table public.commission_payments drop constraint if exists commission_payments_professional_id_fkey;
alter table public.commission_payments
  add constraint commission_payments_professional_same_org_fkey
    foreign key (organization_id, professional_id) references public.professionals(organization_id, id);

-- tasks: contact na MESMA org
alter table public.tasks drop constraint if exists tasks_contact_id_fkey;
alter table public.tasks
  add constraint tasks_contact_same_org_fkey
    foreign key (organization_id, contact_id) references public.contacts(organization_id, id);
