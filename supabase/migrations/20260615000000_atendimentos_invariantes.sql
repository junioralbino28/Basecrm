-- =============================================================================
-- atendimentos — invariantes do faturamento garantidas no BANCO
-- =============================================================================
-- Defense-in-depth: o app já valida (schema zod no submit + service carimba
-- paid_at coerente com recebido), mas o banco é a última linha de defesa.
--   1. recebido ⟺ paid_at: faturamento conta SÓ quando recebido = true,
--      e recebido = true exige paid_at preenchido (nunca estado ambíguo).
--   2. valores: valor ≥ 0, desconto ≥ 0, desconto ≤ valor (total a receber
--      = valor − desconto nunca negativo) e installments ≥ 1.
-- SEM trigger de now()-stamping DE PROPÓSITO: o seed F2/backfill histórico
-- precisa inserir paid_at no passado (planilha do Adel).
-- =============================================================================

alter table public.atendimentos
  add constraint atendimentos_recebido_paid_at_chk
  check ((recebido = false and paid_at is null) or (recebido = true and paid_at is not null));

alter table public.atendimentos
  add constraint atendimentos_valores_chk
  check (valor >= 0 and desconto >= 0 and desconto <= valor and installments >= 1);
