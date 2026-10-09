-- VOLTA de 20261009180000_central_agentes_renomear_excluir.sql (renomear e excluir agente).
-- Antes de rodar: o código que chama as funções já saiu do ar. A volta não devolve agentes apagados (para isso
-- existe o dump do rito) e recusa se houver registro de exclusão: apagar o registro é decisão do Junior.
begin;

do $$
begin
  if exists (select 1 from public.ai_agent_deletions) then
    raise exception 'ai_agent_deletions tem registros: decidir com o Junior antes de apagar';
  end if;
end;
$$;

drop function public.rename_ai_agent(uuid, uuid, text);
drop function public.delete_ai_agent(uuid, uuid, text, integer, uuid);
drop table public.ai_agent_deletions;
delete from supabase_migrations.schema_migrations where version = '20261009180000';

commit;
