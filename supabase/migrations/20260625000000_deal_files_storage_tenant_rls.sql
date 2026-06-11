-- =============================================================================
-- deal-files (storage.objects) — isolamento por tenant (follow-up F1 + pré-req N4)
-- =============================================================================
-- Furo confirmado: o bucket `deal-files` não é público (ok) e a TABELA de
-- metadados `public.deal_files` já é tenant-scoped (can_access_deal). MAS as
-- policies de storage.objects checavam só `bucket_id = 'deal-files'` —
-- qualquer authenticated de QUALQUER clínica lia/apagava/subia arquivo de
-- QUALQUER outra pelo path. Com o N4 (conversas de paciente recebendo mídia
-- nesse mesmo storage), isso vira vazamento de anexo clínico entre clínicas.
--
-- Fix: escopar as 3 operações ao tenant dono do DEAL.
--   • Path de upload = `${dealId}/${uuid}.${ext}` → a 1ª pasta é o deal_id.
--   • READ/DELETE casam pelo metadado (fonte de verdade: deal_files.file_path)
--     e validam can_access_deal / can_operate_deal — robusto, sem parse frágil.
--   • UPLOAD (INSERT) ainda não tem metadado (o app sobe o arquivo ANTES de
--     inserir a linha), então usa o deal_id da 1ª pasta do path, com guarda de
--     formato UUID antes do cast (path inválido → nega, sem erro).
-- can_access_deal/can_operate_deal já existem e escopam via deals.organization_id.
-- =============================================================================

-- UPLOAD: o usuário precisa poder OPERAR o deal cujo id é a 1ª pasta do path.
drop policy if exists "deal_files_upload" on storage.objects;
create policy "deal_files_upload"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'deal-files'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    and public.can_operate_deal(((storage.foldername(name))[1])::uuid)
  );

-- READ: só arquivos cujo metadado pertence a um deal que o tenant ACESSA.
drop policy if exists "deal_files_read" on storage.objects;
create policy "deal_files_read"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'deal-files'
    and exists (
      select 1
      from public.deal_files df
      where df.file_path = storage.objects.name
        and public.can_access_deal(df.deal_id)
    )
  );

-- DELETE: só quem pode OPERAR o deal do arquivo.
drop policy if exists "deal_files_delete" on storage.objects;
create policy "deal_files_delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'deal-files'
    and exists (
      select 1
      from public.deal_files df
      where df.file_path = storage.objects.name
        and public.can_operate_deal(df.deal_id)
    )
  );
