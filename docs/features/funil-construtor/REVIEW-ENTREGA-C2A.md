# Revisão — Entrega C2A (fundação das etiquetas e origens)

Data: 2026-07-22
Entrega revisada: `4750150`, branch `feat/funil-construtor`
Método: verificação independente. Nenhuma alegação aceita sem conferir no código,
no banco ou executando.

---

## Veredito

**APROVADA, sem correção pendente.** Segunda entrega seguida sem defeito meu.

É a fatia mais delicada da série — 5 migrations, mudança de RLS e backfill de dado
legado — e passou limpa. A correção que impus no plano (§1) foi aplicada exatamente,
e as duas lacunas que ele mesmo levantou foram implementadas **acima do pedido** (§3).

---

## 1. Minha correção obrigatória — APLICADA (conferida no banco)

Consultei `role_permission_defaults` na versão **ativa**:

| Chave | admin | agency_admin | **agency_staff** | clinic_admin | clinic_staff | vendedor |
|---|---|---|---|---|---|---|
| `tags.manage` | ✓ | ✓ | **✓** | ✓ | ✗ | ✗ |
| `lead_sources.manage` | ✓ | ✓ | **✓** | ✓ | ✗ | ✗ |
| `tags.assign` | ✓ | ✓ | ✓ | ✓ | **✓** | **✓** |
| `lead_sources.assign` | ✓ | ✓ | ✓ | ✓ | **✓** | **✓** |

É exatamente o contrato: **a agência inteira e o admin da clínica gerenciam; a
secretária e o vendedor usam e nunca gerenciam.** Sem isso, quem monta o fluxo não
conseguiria criar o próprio gatilho (§N1.1 — a etiqueta de serviço nasce junto com
a automação).

**Versões antigas preservadas**, como exigido: `v1 = 222`, `v2 = 222`, `v3 = 246`
linhas (41 permissões × 6 cargos). Nada reescrito para trás.

## 2. O ponto onde ele me corrigiu — resolvido do jeito certo

`public.tags` **não foi recriada**: zero `create table public.tags` na migration de
taxonomia, e duas cláusulas `alter table public.tags` (`20260722010000:52,63`).
Evolução aditiva, preservando `id`/`name`/`color`. **Não há segunda fonte de
verdade** — que era o risco real de eu ter escrito "criar" no pedido.

**Meu achado sobre a rotina de limpeza também foi tratado:** o `delete()` de tags em
`DataStorageSettings.tsx` foi reordenado para ficar coerente com as FKs novas, com
comentário explicando por quê e **teste próprio** (`test/c2aDataCleanup.test.ts`).
Havia risco real de a limpeza de dados de uma clínica quebrar depois das ligações
novas.

## 3. As duas lacunas dele — implementadas ACIMA do pedido

**3.1 Dependências v2 materializadas** (a séria). Não é tabela vazia:
`refresh_published_tag_dependencies` e os `insert into automation_tag_dependencies`
(`20260722020000:418,454,497`) varrem gatilhos e switches de **drafts e versões
publicadas**, com FK composta para `automation_versions(id, automation_id,
organization_id)`. Sem isso, uma etiqueta viva seria arquivada e **o fluxo pararia
de disparar em silêncio** — o pior modo de falha para o piloto.

**3.2 Colisões sem fusão silenciosa.** Criou `tag_migration_reviews` com **três**
tipos, um a mais do que combinamos:
- `normalization_collision` — variantes que colidem;
- `orphan_tag` — as linhas com `organization_id` nulo (o problema que ele mesmo
  achou na tabela antiga), **sem fabricar tenant**;
- `v2_dependency_unresolved` — **acréscimo dele**: dependência v2 que não resolveu
  também vai para revisão em vez de sumir.

O terceiro tipo não estava no pedido e é a decisão certa: silêncio sobre dependência
não resolvida seria a mesma classe de erro que a fatia existe para evitar.

## 4. 🟢 A dívida de segurança de produção — PAGA

A RLS de `lead_sources` era `for all` com `can_operate_organization`, que inclui
`clinic_staff` e `vendedor` — **a recepção podia excluir origem de lead**, contra a
decisão explícita do Junior, e isso está em `main`.

`20260722030000_c2a_lead_sources.sql` troca o critério para
`has_permission('lead_sources.manage')` na gestão do catálogo e
`has_permission('lead_sources.assign')` no histórico (linhas 249-359). O `delete()`
do serviço foi substituído por arquivamento.

**Ressalva de deploy (não é defeito):** a correção **só chega em produção quando a
C2 for deployada**. Até lá, a policy errada segue no ar — com exposição prática
baixa (nenhuma tela chama o `delete`), mas segue. Registrado para não ser esquecido
na hora de subir.

## 5. Backfill — honesto, como adjudicado

`20260722020000:228-246` grava:

```sql
'legacy_migration',   -- provenance
null::timestamptz,    -- applied_at
null::uuid,           -- applied_by
now()                 -- recorded_at
```

**Data e autor originais ficam nulos**; só o instante da importação é real. É a
diferença entre um painel que diz "não sei quem etiquetou em março" e um painel que
**mente sobre março**. Cumprido à risca.

## 6. Verificação independente do dedupe

Tentei criar as três variantes (`Indicação` / `indicacao` / `  INDICAÇÃO  `)
direto no banco como `postgres`. **A função me recusou:**

```
ERROR: Sem permissão para gerenciar categorias de etiquetas.
```

Isso **não é um problema — é a prova de que o fail-closed funciona** mesmo para
superusuário sem contexto de sessão. Boa notícia de segurança.

Fui então ao teste dele (`c2aTagTaxonomy.local.test.ts:89-122`) e ele cobre o
cenário certo: **três `Promise.all` concorrentes** com as três variantes, exigindo
`new Set([...ids]).size === 1` e `normalized_name === 'indicacao'`. É exatamente a
corrida que GHL e Kommo não seguram.

## 7. Gates rodados na minha mão

| Gate | Resultado |
|---|---|
| `npm run test:local` | **848 / 848**, 186 arquivos, 0 falhas |
| `npm run lint` | verde (`--max-warnings 0`) |
| `npx tsc --noEmit` | verde |

**Produção intacta por verificação:** `main` segue em `be7fe35` com **34
migrations**; as 5 novas existem **apenas na branch**. Worktree limpo, sem push.

## 8. Ruído conhecido (não bloqueia)

Segue aparecendo `DELETE .../deal_notes ... 400 (Bad Request)` na limpeza de
fixtures. Não derruba teste (848/848) e já estava registrado na C1C. É teardown, não
produto.

---

## Próximo passo

**C2B** — o motor passa a rotear: executor v3 (`deal.tag_ids`), gravação atômica
(`add`/`remove`/`set-primary`, nunca "salvar lista"), **o gatilho que cria a
inscrição** (é o que resolve "publica mas ninguém entra"), carência/reentrada de 5
dias, **saída do fluxo quando a paciente responde** e a **tarefa-porteiro**.

A C2A deixou a fundação pronta para isso sem retrabalho: identidade estável,
dependências rastreadas e permissões separadas.
