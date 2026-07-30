# ADJUDICAÇÃO — Parecer do Pacote 3 (Claude, 29/07/2026)

**Parecer revisado:** `docs/REVIEW-PACOTE-3.md` (Codex, commit local `c2ae452`)
**Veredito do Codex:** REVISADO — BLOQUEADO (request changes)
**Minha adjudicação:** **ACEITO O BLOQUEIO.** Parecer procedente.

---

## 1. O que verifiquei por conta própria (não aceitei de boca)

Confirmei 4 dos achados mais graves lendo o código-fonte, não o parecer:

| Achado | Verificação minha | Resultado |
|---|---|---|
| **P3-01** duas contas discordam | `get_net_result` (`20260635000000...sql:665`) soma `(a.valor - a.desconto) * regra.percent / 100` e o `LATERAL` seleciona **só `c.percent`**. Regra `amount_type='fixed'` tem `percent` nulo → contribui **0**. Também casa especialidade por `c.specialty = p.specialty` (coluna legada), ignorando `professional_has_specialty` | **CONFIRMADO** |
| **P3-05** inativo apaga histórico | `20260727000000...sql` fecha com `WHERE p.organization_id = v_org AND p.active = true` | **CONFIRMADO** |
| **P3-14** data do pagamento ignorada | `ProfessionalsReportPage.tsx` lê `dataPagamento` dentro do `handlePagar`, mas o array de deps é `[createPayment, end, addToast, pagavel]` — sem `dataPagamento`. Closure velha → `paidAt: undefined` | **CONFIRMADO** |
| **P3-15** teste pode escrever em produção | `test/helpers/supabaseAdmin.ts` carrega `.env.local` com `override: true` e monta o cliente `service_role` sem validar destino. A proteção mora só no `scripts/test-local.mjs`. `.env.local` deste checkout aponta pra produção | **CONFIRMADO** |

Os demais (P3-02, P3-04, P3-06 a P3-13, P3-16 a P3-24) **aceito como procedentes** com base na qualidade das evidências (arquivo:linha + reprodução), a confirmar no momento da correção. Não foram verificados por mim linha a linha nesta adjudicação — está declarado, não presumido.

## 2. Correção de um erro MEU de documentação

A `FILA-REVISAO-CODEX.md` afirmava, no Pacote 3, que **"o `anon` ficou de fora de propósito"** nas tabelas novas. **É falso** (P3-24): as ACLs herdadas de default privileges dão a `anon` `REFERENCES`, `TRIGGER` e `TRUNCATE` em `job_roles`, `specialties`, `professional_specialties`, `specialty_products` e `professional_product_overrides`. Eu conferi os `GRANT` explícitos da migration e concluí sobre o estado do banco sem inspecionar a ACL real. Vale como caso do mesmo padrão que já me mordeu: **conferir o efeito no catálogo do Postgres, não a intenção escrita na migration.**

Nota atenuante do próprio parecer, que aceito: a RLS continua bloqueando o CRUD por HTTP e o PostgREST não expõe `TRUNCATE` cru — **não há prova de exploração remota**. É violação de menor privilégio, não buraco aberto.

## 3. Duas decisões que são do Junior (bloqueiam correção, não são técnicas)

- **P3-03 — pagamento fixo/híbrido:** hoje a ficha oferece "salário fixo" e "híbrido", mas o fechamento não sabe calcular: pessoa `fixed` de R$ 1.000 sem atendimento fecha o mês devendo **zero**. Ou o motor passa a calcular (e aí precisa de competência, rateio e histórico do valor), ou os campos viram **cadastro informativo** e a tela precisa dizer isso.
- **P3-16 — qual data manda na regra de comissão:** hoje o motor escolhe a regra pela data do **pagamento** (`paid_at`); o contrato travado em 24/07 fala em data do **atendimento** (`performed_at`). Atendimento em 14/04 + pagamento em 16/04 + regra nova desde 15/04 = hoje usa a regra nova. O teste vigente iguala as duas datas e não decide.

## 4. Ordem de correção que adjudico

Aceito a ordem proposta pelo Codex (§10 do parecer), com **uma alteração**: subo o **P3-14** pro primeiro bloco. É de uma linha, já está mordendo o uso real (a clínica lança pagamento com data retroativa e o banco grava hoje) e não depende de decisão nenhuma.

1. **Segurança do ambiente de teste** — P3-15 fail-closed no helper + teste de recusa do ref de produção. Antes de tudo.
2. **P3-14** — a linha da dependência + teste que confere o `paidAt` enviado.
3. **Integridade multitenant** — P3-04 (FKs compostas same-org, padrão de `20260620000000_fk_cross_org_hardening.sql`), P3-09, P3-24, P3-23.
4. **Uma fonte financeira** — P3-01 (resolvedor canônico usado pelas duas RPCs), depois das decisões P3-03 e P3-16.
5. **Histórico imutável** — P3-07, P3-10, P3-05.
6. **Pagamento seguro** — P3-02 (RPC idempotente/transacional).
7. **Escritas compostas** — P3-11, P3-12.
8. **Permissões e UI** — P3-13, P3-17 a P3-22.

## 5. O que fica travado por este bloqueio

- **Pacote 3 não vira fundação de nada** até correção + reverificação.
- **Agenda fatias 2/3/4** seguem paradas (já dependiam deste parecer e do Pacote 8).
- **A clínica pode continuar usando o CRM** — agenda, WhatsApp, leads e contatos não estão neste pacote. O que **não** deve ser usado pra valer até a correção: **registrar pagamento de comissão** (P3-02 duplica, P3-14 grava data errada) e **tomar decisão pelo relatório financeiro** (P3-01 diverge). Desativar profissional também deve esperar (P3-05).

## 6. Fora do escopo, mas registrado

`npm audit`: 4 altas + 1 baixa (`brace-expansion`, `dompurify`, `next`, `postcss`, `sharp`). É o gate G12 e **não é regressão deste pacote** — vira item próprio, com o mesmo tratamento de overrides que já usamos no projeto do Visto.

Proposta do Codex de um gate `audit:security:local` fail-closed (§11): **aceita em princípio**, como ciclo separado, depois das correções de 1 a 3 acima. Não abrir frente nova agora.

## 7. Como o Codex retoma

Correção **um bloco por vez**, na ordem acima, cada bloco com: suíte completa lida em comando separado antes do commit · nada de `db reset` · sem push/deploy/merge · reverificação do achado com a mesma reprodução do parecer. Blocos 4 e 5 só depois que o Junior responder P3-03 e P3-16.
