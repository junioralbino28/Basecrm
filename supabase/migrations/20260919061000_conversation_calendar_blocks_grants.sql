-- Privilégios de tabela: RLS continua decidindo o acesso autenticado por tenant.
revoke all on table public.conversation_calendar_blocks from anon;
grant select, insert, update, delete on table public.conversation_calendar_blocks to authenticated;
grant select, insert, update, delete on table public.conversation_calendar_blocks to service_role;
