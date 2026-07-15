# E2 — Revisão do Claude · DESIGN-SERVIDOR (S0)

> Revisor: Claude (Opus 4.8). Data: 2026-07-15. Alvo: `DESIGN-SERVIDOR.md` (commits `3c2b002`, `add19d5`, `61fd26e`).
> Método: leitura crítica + verificação das alegações técnicas no código (não rubber-stamp).

## Veredito: ✅ APROVADO para abrir o S1 — com 2 refinamentos e 1 decisão do Junior

O desenho é sólido, seguro e endereça tudo que o PLAN-SERVIDOR pediu, com vários acertos finos. Pode abrir o S1 incorporando os refinamentos abaixo. Nada aqui é bloqueador.

## Alegações verificadas no código (não aceitei de palavra)

- **Policy `FOR ALL` + armadilha do OR: CONFIRMADO.** `atendimentos_mutate_by_tenant_operator` é `for all` (migration `20260614000000`, linha 50), e há `atendimentos_select_by_tenant` `for select` separada. Policies permissivas do mesmo comando combinam por OR → manter o `FOR ALL` ao granularizar abriria SELECT pra quem tem `manage` sem `view`. **A correção do Codex (remover FOR ALL, separar INSERT/UPDATE/DELETE) está certa.**
- **UPDATE old-row + new-row:** correto exigir tenant+permissão nas duas pontas (impede mover linha de A→B). ✅
- **Grant de staff via override:** o mapeamento `can_access AND has_permission` permite conceder a `clinic_staff` sem furar tenant. ✅
- **Nota de teste do Codex (usar `reports.finance` pro caso "grant sobre default negado", pq staff já tem `atendimentos.view/manage` por default):** confere com a matriz de defaults. Sinal de que ele checou de verdade. ✅

## Refinamento 1 — não refatorar o `permissions.ts` (toque só o necessário)

O desenho fala em extrair um "manifesto TS puro" e fazer o `permissions.ts` derivar dele. **Verifiquei: `ROLE_PERMISSION_DEFAULTS` (linha 152) e `getDefaultPermissionMap` (linha 161) já são `export`.** O gerador do snapshot pode **importar esses símbolos direto** pra emitir o SQL — sem reestruturar o `permissions.ts`, que é código do E1 **já em produção**. Refatorar E1 agora adiciona risco e escopo sem benefício. **Recomendação:** o gerador consome os exports atuais; só extrair manifesto se aparecer uma necessidade concreta (YAGNI).

## Refinamento 2 — versionamento dos defaults: justificar ou enxugar (sua chamada, Codex)

O snapshot versionado + ponteiro de versão ativa + troca atômica é defensável (permite "migration primeiro, app depois" sem janela de inconsistência). Mas para o **v1** — onde os defaults raramente mudam — é maquinário pesado. **Não é bloqueador; é um pedido de justificar-ou-enxugar:** ou (a) mantenha e justifique por que o v1 precisa da troca de ponteiro já, ou (b) entregue uma tabela de defaults de versão única agora (com uma **coluna de versão** pra deixar a porta aberta) e adicione a troca atômica quando a primeira mudança de default realmente exigir. As 3 travas anti-drift ficam de qualquer forma — são o que importa.

## Decisão do Junior — cobertura do `settings.finance` (o Codex sinalizou com honestidade)

O Codex foi transparente (seção 7): as 4 tabelas de **configuração** financeira (`payment_method_fees`, `commission_rules`, `fixed_costs`, `commission_payments`) continuam gated por `can_configure_organization` (papel). Este S1 cobre só os **RPCs de relatório** (`reports.finance`/`reports.professionals`). Consequência prática: **desligar `settings.finance` pra alguém NÃO vai impedir, no banco, a EDIÇÃO da config financeira** neste passo — só a leitura dos relatórios.
- **Minha leitura:** aceitável como follow-up (E2.2). Os relatórios são a leitura sensível; a edição de config já exige papel de admin, o que é razoável.
- **Decisão do Junior:** OK deixar a edição de config financeira pra um E2.2, ou quer incluir `settings.finance` nessas 4 tabelas já neste S1?

## Nota menor (não bloqueia) — client fail-open × banco fail-closed

O `loadPermissionOverrides` do TS falha pra `{}` (default do cargo) = pode falhar-aberto; o `has_permission` do banco falha-**fechado**. Efeito: numa operação sensível, se a leitura de override falhar, a tela pode aparecer (default do cargo) mas o dado é negado (403/vazio). É **seguro** (o dado é a barreira real e ele fecha), só gera leve inconsistência de UX. Alinhar o lado TS pra fail-closed em operação sensível fica como melhoria futura.

## O que está aprovado e deve ser mantido no S1

- `has_permission` sem `user_id` (usa `auth.uid()`), SECURITY DEFINER, STABLE, `search_path` vazio, EXECUTE revogado de public/anon — ✅ textbook.
- Algoritmo fail-closed (default ausente → nega antes do override; override cross-org → nega). ✅
- Policies separadas por operação; UPDATE nas duas pontas. ✅
- RPCs: `can_access AND has_permission` substituindo `can_configure`, **preservando as correções de junho** (fuso/desconto/pró-rateio/bandeira/desempate/sem_profissional). ✅
- Harness de teste que **recusa rodar se a URL for a de produção** + modo `REQUIRE_E2_MIGRATION` (ausência = falha, não skip) + asserções com usuário real (anon), service-role só pra fixtures. ✅ — exatamente a trava de segurança que eu queria.
- Rollback documentado/testado, nunca aplicado em prod sem o mesmo portão. ✅
- Aba Dados = escopo agência (commit `add19d5`). ✅

## Portão

S1 continua fechado até **aprovação explícita do Junior**. Mesmo no S1: tudo provado em Supabase local/branch (nunca prod) → nova revisão do Claude do SQL final → novo aval do Junior → só então aplicação controlada em produção.
