-- VOLTA da fatia 2 da Central de Agentes (supabase/migrations/20261007120000_central_agentes_editor.sql).
-- ORDEM: primeiro tirar do ar o código das telas e das rotas da Central (sem as funções, Salvar, Publicar e
-- Restaurar respondem erro); só depois rodar isto. Nunca em produção sem o OK do Junior.
-- Provada no banco local (Task 2, Step 3): aplicar, voltar, aplicar.
-- Não apaga versões publicadas pela tela: elas continuam versões válidas do agente, e o runtime as lê.
begin;
drop function if exists public.restore_ai_agent_version(uuid, uuid, integer, integer, integer, text);
drop function if exists public.publish_ai_agent_version(uuid, uuid, integer, integer, text);
drop function if exists public.save_ai_agent_draft(uuid, uuid, integer, text);
drop function if exists public.central_agentes_variavel_desconhecida(text);
delete from supabase_migrations.schema_migrations where version = '20261007120000';
commit;
