# Adjudicação — plano do Codex para a C2A

Data: 2026-07-22
Plano avaliado: parecer + plano de execução devolvidos antes de codar (base `447daa4`)
Método: cada alegação conferida no código antes de concordar.

---

## Veredito

**APROVADO com 1 correção obrigatória e 2 confirmações.**

Ele **me corrigiu e está certo** (§1). As **duas lacunas que levantou procedem** e
uma delas é séria (§2). Mas a interpretação dele de *"só admin"* **quebraria o
contrato §N1.1** e trava justamente quem monta o fluxo (§3) — essa parte não passa
como está.

---

## 1. "`public.tags` já existe" — ELE ESTÁ CERTO, erro meu

Confirmado em `20251201000000_schema_init.sql:366-373`:

```sql
CREATE TABLE IF NOT EXISTS public.tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    color TEXT DEFAULT 'bg-gray-500',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    UNIQUE(name, organization_id)
);
```

Escrevi **"criar `tags`"** no `PEDIDO-C2A.md` §1. Estava errado. **Evoluir de forma
aditiva, preservando `id`, `name` e `color`** — criar tabela paralela produziria
duas fontes de verdade, exatamente o que a fatia existe para evitar.

**Três achados meus ao verificar, que reforçam a posição dele:**

1. **`organization_id` é ANULÁVEL** e a unicidade é `(name, organization_id)` —
   ou seja, hoje o banco aceita etiqueta sem dono. A proposta dele (mandar essas
   linhas para revisão **sem fabricar tenant**) é a única correta: inventar
   organização para uma linha órfã é decidir a quem pertence um dado, e isso não é
   decisão de migração.
2. **A tabela já foi endurecida** em `20260612000000_rls_hardening_clinic_pii.sql:48-55`
   — a policy original era `FOR ALL TO authenticated USING (true)` (aberta a
   qualquer autenticado!) e virou `tags_select_by_tenant` +
   `tags_mutate_by_tenant_operator`. Então a evolução tem que **respeitar essas
   policies**, não recriar as antigas.
3. **Só existe um uso na aplicação:** `DataStorageSettings.tsx:159-163`, um
   `delete()` por organização dentro de uma rotina de limpeza de dados. Não há
   leitura em tela nenhuma. **Consequência para o plano:** ao evoluir a tabela,
   verificar se essa limpeza continua coerente — se `deal_tag_assignments` passar a
   referenciar `tags` com FK, esse `delete` pode falhar ou cascatear. **Quero isso
   coberto por teste.**

## 2. As duas lacunas — PROCEDEM, a segunda é séria

**2.1 Colisões legadas.** Aceito na íntegra: variantes que normalizam para o mesmo
nome vão para fila de revisão, **nenhuma atribuição é criada para o grupo ambíguo**,
`deals.tags` permanece intacto, linhas sem organização também vão para revisão.
Isso é o "não fundir em silêncio" cumprido de verdade — o Kommo e o GHL falharam
justamente aqui.

**2.2 Dependências v2 precisam ser materializadas — PROCEDE e é a mais importante.**
Ele está certo: **criar `automation_tag_dependencies` vazia não protege nada.** Eu
pedi bloqueio de arquivamento para etiqueta em uso, mas se a tabela nasce vazia, o
bloqueio não enxerga nada do que **já existe publicado**. Uma etiqueta usada por um
gatilho v2 ativo seria arquivada sem aviso, e o fluxo pararia de disparar **em
silêncio** — o pior modo de falha possível para o piloto.

Aceito: migrar as dependências dos gatilhos textuais e dos switches v2, manter
sincronizado em salvamento/publicação v2, e bloquear com base nelas.

## 3. 🔴 CORREÇÃO OBRIGATÓRIA — a interpretação de "só admin" quebra o §N1.1

Ele propõe `tags.manage` e `lead_sources.manage` **apenas** para `agency_admin`,
`admin` e `clinic_admin`, deixando **`agency_staff` de fora**.

**Isso não passa.** Verifiquei no banco (`defaults_version = 2`):

```
agency_staff | automation.edit   | t
agency_staff | settings.general  | t
agency_staff | settings.products | t
```

`agency_staff` **monta automação** e **já administra catálogo** (produtos da
clínica). E o contrato `SPEC-ENTREGA-C.md` §N1.1 diz, sobre a etiqueta de serviço:

> **Quem cria:** *junto com a automação — o fluxo é dono do próprio gatilho*

Se `agency_staff` monta o fluxo mas não pode criar etiqueta, ele **monta o fluxo e
não consegue criar o gatilho dele**. A fatia trava exatamente quem faz o trabalho.

**A decisão do Junior era sobre a secretária, não sobre a agência.** Palavras dele:
*"essa parte de automação fica visível apenas para **agência** e usuário adm da
clínica"* — agência inteira, e `agency_staff` é agência.

**Correto:**

| Chave | Recebe por padrão |
|---|---|
| `tags.manage` · `lead_sources.manage` | `admin`, `agency_admin`, **`agency_staff`**, `clinic_admin` |
| `tags.assign` · `lead_sources.assign` | os acima **+ `clinic_staff` + `vendedor`** |

`clinic_staff` e `vendedor` **usam e nunca gerenciam** — isso sim é o contrato.

## 4. Onde concordo sem ressalva

- **Não usar `db reset` por padrão** — foi exatamente o que apagou a conta local do
  Junior numa rodada anterior.
- Migrations só por `supabase migration up --local`.
- v1 e v2 de defaults **byte a byte imutáveis**; v3 ativada atomicamente;
  `has_permission` fail-closed.
- **`applied_at`/`applied_by` nulos no backfill**, com `recorded_at` como o instante
  real da importação. É a forma honesta de dizer "não sei quem etiquetou em março"
  — e é o que impede o painel de mentir.
- Campos de auditoria protegidos contra falsificação pelo cliente autenticado.
- `contacts.source` preservado como ponte textual, **sem fabricar histórico a partir
  dele**.
- Origem desconhecida explícita, sem inventar origem de marketing.
- Trocar o `delete()` do serviço por arquivamento.
- Prosseguir **sem MCP do Supabase**, com o CLI local protegido pelo runner:
  aprovado.

## 5. Confirmação sobre produção

Ele registrou corretamente: *"produção não foi consultada e a migration não pode
assumir que também esteja vazia"*. **Está certo e deve continuar assim** — ninguém
consulta o banco da clínica. A migração precisa ser segura **sem saber o conteúdo**,
tratando volume desconhecido, colisões e linhas órfãs como casos normais.

## 6. Estimativa

Ele estimou 4–6 horas. Não tenho como auditar isso, mas o escopo (5 blocos com TDD,
migrations de schema + RLS + backfill) é coerente com o tamanho. **Se passar muito
disso, prefiro que ele pare e reporte** a entregar pela metade em silêncio.

---

## Resposta enviada

**[E] Aprovado com 1 correção:** incluir `agency_staff` em `tags.manage` e
`lead_sources.manage`. As duas lacunas dele entram no escopo. O ponto do
`public.tags` está aceito — o erro era meu.
