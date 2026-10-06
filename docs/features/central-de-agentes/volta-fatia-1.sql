-- VOLTA da fatia 1 da Central de Agentes (supabase/migrations/20260930000000_central_agentes_fundacao.sql).
-- ORDEM: primeiro tirar do ar o código que lê ai_agent_id e grava ai_reply_events (senão o portão da IA
-- falha e a IA para em todos os clientes); só depois rodar isto. Nunca em produção sem o OK do Junior.
-- Provada no banco local (Task 2, Step 3): aplicar -> voltar -> aplicar. Apaga junto os eventos de prova.
begin;
drop trigger if exists channel_connections_ai_agent_published on public.channel_connections;
alter table public.channel_connections drop constraint if exists channel_connections_ai_agent_fk;
drop index if exists public.channel_connections_ai_agent_id_idx;
alter table public.channel_connections drop column if exists ai_agent_id;
drop function if exists public.central_agentes_ligar_conexao(uuid, uuid, text, text, text, text, text, text);
drop function if exists public.central_agentes_ultima_resposta_nativa(uuid);
drop function if exists public.create_ai_agent_from_legacy_prompt(uuid, text, text, jsonb);
drop function if exists public.enforce_channel_connection_ai_agent_published();
drop table if exists public.ai_reply_events;
drop table if exists public.ai_agent_versions cascade;
drop table if exists public.ai_agents cascade;
drop function if exists public.prevent_ai_agent_version_update();
delete from supabase_migrations.schema_migrations where version = '20260930000000';
commit;
