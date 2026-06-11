-- =============================================================================
-- clinicorp_config.business_id: integer → bigint (correção)
-- =============================================================================
-- O business_id do Clinicorp (ex.: 6322553945194496, 16 dígitos) NÃO cabe em
-- `integer` (4 bytes, máx 2.147.483.647) — o seed da clínica piloto estourava
-- "integer out of range". bigint (8 bytes) comporta. clinicorpTypes já usa
-- number (JS Number aguenta até 2^53), só a coluna do banco estava errada.
-- =============================================================================

alter table public.clinicorp_config
  alter column business_id type bigint;
