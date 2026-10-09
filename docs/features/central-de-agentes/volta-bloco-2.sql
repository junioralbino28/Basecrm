-- VOLTA do bloco 2 da Central de Agentes (supabase/migrations/20261009120000_central_agentes_modelos.sql).
-- ORDEM: primeiro tirar do ar o código das telas e rotas do bloco 2; só depois rodar isto. Nunca em produção sem o
-- OK do Junior. APAGA A BIBLIOTECA DE MODELOS: antes, exportar os modelos (select para arquivo) se houver algum.
-- Os agentes criados pela tela continuam (são linhas comuns de ai_agents); a origin deles fica apontando para um
-- modelo que deixa de existir.
begin;
drop function if exists public.set_ai_agent_template_archived(uuid, boolean, integer);
drop function if exists public.create_ai_agent_template_from_agent(uuid, uuid, integer, text, text);
drop function if exists public.save_ai_agent_template(uuid, integer, text, text, text);
drop function if exists public.create_ai_agent_from_copy(uuid, text, uuid, uuid, integer);
drop function if exists public.create_ai_agent_from_template(uuid, text, uuid, integer, jsonb);
drop function if exists public.create_ai_agent_blank(uuid, text, text);
drop function if exists public.central_agentes_marcadores(text);
drop function if exists public.central_agentes_lacunas(text);
drop table if exists public.ai_agent_templates;
delete from supabase_migrations.schema_migrations where version = '20261009120000';
commit;
