# E2 — Revisão do Claude · S1 (migration + testes)

> Revisor: Claude (Opus 4.8). Data: 2026-07-15. Alvo: migration `20260635000000_e2_server_permission_enforcement.sql` + `test/e2ServerIsolation.local.test.ts` + `test/e2ServerEnforcement.test.ts` (commits `d22b51f`/`41d92d8`/`acec13e`).
> Método: leitura linha a linha do SQL + **verificação independente rodada pelo Claude** (não confiei no "27/27" do Codex).

## Veredito: ✅ APROVADO — pronto pra aplicar no prod APÓS aval explícito do Junior

A migration está correta, fail-closed em toda a cadeia, e **eu provei os testes na minha mão** contra o Supabase local. É seguro aplicar no banco da clínica com o aval do Junior.

## Verificação independente (rodada pelo Claude, não pelo Codex)

Subi o Supabase local (`supabase start`) e rodei:
- **Estático (`e2ServerEnforcement.test.ts`): 14/14 verdes** — gerador roda em `--check` (snapshot byte-a-byte) + cada valor do snapshot bate com `getDefaultPermissionMap` do TS pros 6 cargos.
- **Isolamento real (`e2ServerIsolation.local.test.ts`): 13/13 verdes** — usuários reais autenticados (não bypass de service-role) contra Postgres local.
- Total = 27/27, confere com o relatado.

## SQL revisado linha a linha — correto

| Item | Verificação |
|---|---|
| `role_permission_defaults` (210 linhas, 6×35) | Valores conferidos contra a taxonomia E1: agency_staff nega 4 (whatsapp.manage_connection/settings.finance/audit/users.manage); clinic_staff nega 16; admin=agency_admin, vendedor=clinic_staff. RLS on, revoke total, só service_role lê. Bloco `do $$` trava completude (210/6/35/v1). ✅ |
| `has_permission(key)` | STABLE, SECURITY DEFINER, `search_path=''`, sem `user_id` (usa `auth.uid()`). Fail-closed: uid nulo/key vazia→false; profile ausente/org nula→false; **default é pré-condição** (não achou→false antes do override); override cross-org→false; senão default. ✅ |
| RPCs replace vs overload | **Assinaturas idênticas** às de junho (`timestamptz, timestamptz, uuid`) → `create or replace` SUBSTITUI, não cria sobrecarga órfã. Verifiquei nas migrations 20260621/20260624. ✅ |
| Correções de junho preservadas | Fuso SP, desconto, pró-rateio (HIGH-1), bandeira normalizada (HIGH-2), desempate (HIGH-3), sem_profissional (MEDIUM-8) — todas presentes nos corpos novos. ✅ |
| Policies de Atendimentos | `FOR ALL` removida; SELECT/INSERT/UPDATE/DELETE separadas, cada uma `can_access/operate AND has_permission`. UPDATE nas duas pontas (USING+WITH CHECK). **Armadilha do OR fechada** — provado no teste `view=false` + `manage=true` → SELECT vazio. ✅ |
| Funções auxiliares | `normalize_profile_role`, `current_profile_organization_id`, `can_access/operate_organization` existem. normalize NÃO colapsa admin/vendedor, mas o snapshot semeia os 6 cargos idênticos → resultado bate com o TS. ✅ |
| Harness de segurança | `assertSafeE2SupabaseTarget` **recusa ativamente** URL com o ref de prod `eqidsihasmwwamkaqfka` (throw); loopback→local; remoto exige `E2_ALLOW_REMOTE_BRANCH=1`+https+*.supabase.co. Trava de prod real. ✅ |

## Impacto no prod (avaliação de risco da aplicação)

**Baixo risco pros usuários atuais da clínica:**
- clinic_admin e clinic_staff têm `atendimentos.view/manage`=true por default → **ninguém perde acesso a Atendimentos** (a Vitória continua operando).
- Finance: `reports.finance` é do clinic_admin (staff não tinha via `can_configure` mesmo) → sem regressão.
- Aditiva: nova tabela + nova função + substitui policies/RPCs por versões compostas. O que muda de fato = os overrides passam a valer no banco (que é o objetivo).

## Pendências herdadas (E2.2, não bloqueiam)

- 4 tabelas de config financeira seguem em `can_configure_organization` (decisão do Junior: `settings.finance` config = E2.2).
- Client TS `loadPermissionOverrides` fail-open `{}` × banco fail-closed — o banco é a barreira real; alinhar o TS depois (cosmético de UX).

## Portão final

Este é o ÚLTIMO portão antes do banco da clínica no ar. Aplicação em prod só após **aval explícito do Junior**. Aplicação = migration `20260635000000` no projeto `eqidsihasmwwamkaqfka` (via Supabase MCP `apply_migration` pelo Claude, ou pelo Codex/Junior). Depois do deploy do código E2 (que já espera essa migration), a clínica passa a ter tela + dado trancados de verdade.
