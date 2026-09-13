# IMPL-LOG 3b — Marcos de conversão por negócio (agendou / compareceu / faltou / fechou)

**Data:** 2026-09-13
**Branch:** `feat/funil-construtor`
**Construído por:** Claude (Claude constrói, inclusive motor; Codex revisa este pedaço fechado)
**Estado:** implementado, provado no Supabase local, **aguardando revisão pontual do Codex** e rollout
**SPEC:** `SPEC.md` nesta pasta (frente 3; esta é a segunda peça, depois da 3a)

## 1. Decisão que originou

Requisito (10/09, Jéssica): a segunda ponta que precisa viver na mesma linha do lead é **o momento do
agendamento**, que a recepção marca; depois compareceu e fechou com valor. E a regra de tempo: o
evento vai para a Meta **na hora em que o status muda**, nunca num lote. Para isso o CRM precisa saber
o momento exato, por negócio, sem depender de alguém lembrar de marcar.

## 2. O que existia antes

- `appointments` tinha `contact_id` mas **não `deal_id`**: não dava para juntar "agendou" com o funil
  sem ambiguidade (um contato pode ter vários negócios).
- Status `compareceu`/`faltou` existia como texto atual da consulta, sobrescrito a cada mudança, sem
  data própria e sem histórico.
- O ganho é gravado por **UPDATE direto em 9 lugares** (tela do negócio, cockpit, inbox, API pública,
  ferramenta da IA, `deals.ts`), não só pela RPC `mark_deal_won`.

## 3. O que foi construído — `supabase/migrations/20260913010000_conversao_marcos_por_negocio.sql`

| Peça | O que faz |
|---|---|
| `appointments.deal_id` | FK na mesma organização, `on delete set null`, índice parcial. **Backfill só do vínculo** (consulta antiga com contato aponta o negócio aberto mais recente), rodado **antes** de ligar os gatilhos: nenhum marco retroativo |
| `deal_conversion_events` | append-only: `event_type` (`replied` · `scheduled` · `attended` · `no_show` · `won`), `occurred_at`, `source`, `value`, `appointment_id`, `idempotency_key` único por org, **`meta_event_id`** único (o id que impede a Meta de contar duas vezes), `meta_status` (`pending` · `sent` · `error` · `skipped`), tentativas/erro/data do envio, `created_by`. RLS: autenticado só lê a própria organização; **escrita só dos gatilhos e do service_role**. `REVOKE ALL FROM public, anon, authenticated` antes do `GRANT SELECT` (os defaults do Supabase davam TRUNCATE) |
| gatilho `appointments_link_deal` (BEFORE) | se a recepção não escolheu o negócio, liga a consulta ao negócio **aberto mais recente** do contato (mesma regra do webhook para a conversa). Sem contato (espelho do Clinicorp) ou sem negócio aberto: não liga |
| gatilho `appointments_conversion_events` (AFTER) | consulta ligada a negócio → `scheduled` (agora); status vira `compareceu` → `attended` **na hora da consulta**; vira `faltou` → `no_show` já `skipped` (nunca vai à Meta). Arrependimento: sair de `compareceu` antes do envio marca o `attended` pendente como `skipped`. Mesmo status de novo, ou update sem mudar status: nada |
| gatilho `deals_conversion_events` (AFTER) | `is_won` de falso para verdadeiro (ou inserido já ganho) → `won` com o **valor do negócio** e `closed_at`; `source` = `reception` se há usuário logado, `system` se não. Reabrir antes do envio marca o `won` pendente como `skipped`; ganhar de novo gera marco novo |

Todas as funções de gatilho: `SECURITY DEFINER`, `search_path = ''`, EXECUTE revogado de public/anon/
authenticated. Tipos em `types/types.ts` (`DealConversionEvent`, `Appointment.dealId`).

**Não construído, de propósito:** botão novo para a recepção (ela marca onde já marca); `replied`
(é a 3d, nasce no webhook); relatório do funil (vai junto com a 3c); `dealId` no serviço da agenda no
navegador (o gatilho preenche; a tela não precisa saber ainda).

## 4. Provas

| Prova | Resultado |
|---|---|
| Migration aplicada no Supabase local | ledger em `20260913010000`; 3 gatilhos ativos; funções `DEFINER`, `search_path=""`, `anon=false auth=false`; `appointments.deal_id` presente; backfill: 0 consultas com contato no local, 0 marcos retroativos |
| ACL da tabela, conferida no catálogo depois do revoke | `anon`: nada · `authenticated`: só SELECT · `service_role`: tudo |
| `test/conversaoMarcosMigration.test.ts` (estático) | 5/5, incluindo a ordem backfill → gatilhos e o revoke antes do grant |
| **`test/conversaoMarcos.local.test.ts`** (gatilhos reais) | **6/6**: consulta aponta o negócio aberto **mais recente** (não o antigo) e gera `scheduled`; `compareceu` gera `attended` na hora da consulta, repetir não duplica, update sem status não gera nada, voltar atrás vira `skipped`; `faltou` vira `no_show` já `skipped`; consulta sem contato (Clinicorp) ou de contato sem negócio não liga nada; ganho por UPDATE direto gera `won` com valor 1.500 e `closed_at`, repetir não duplica, reabrir vira `skipped`, ganhar de novo gera marco novo; admin autenticado lê os próprios, não lê os de outra org e recebe `42501` ao tentar inserir |
| `tsc --noEmit` · ESLint `--max-warnings 0` nos arquivos tocados | limpos |
| Suíte completa `npm run test:local` | **243 arquivos / 1.174 testes, zero falhas** (190 s). Eram 241 / 1.163: os +2 / +11 são exatamente os testes novos. A primeira rodada acusou 1 falha de ORDENAÇÃO no teste de ponta a ponta da 3a (dois toques no mesmo segundo); corrigido o teste (relógio próprio por mensagem + desempate por `recorded_at`), 3× verde isolado e suíte inteira verde na segunda rodada. Saída em arquivo, lida em comando separado antes do commit |

## 5. Auto-revisão adversarial (escrita antes de declarar pronto)

1. **Primeira versão do backfill quebrou a migration** (`UPDATE ... FROM LATERAL` referenciando a
   tabela alvo, `42P10`). Como o arquivo roda em transação, nada ficou aplicado pela metade; reescrito
   como subconsulta correlacionada. E o backfill foi **movido para antes dos gatilhos**: na ordem
   original ele dispararia `scheduled` para toda consulta antiga, o que o requisito proíbe.
2. **Defaults do Supabase deram TRUNCATE a anon/authenticated** na tabela nova (mesmo achado R-09 da
   reverificação). Só apareceu porque conferi o catálogo depois de aplicar, não a migration. Corrigido
   na migration (ainda não commitada) e aplicado no local com o mesmo comando; travado no teste
   estático. **As outras tabelas do produto continuam com o R-09 aberto** (fora desta peça).
3. **"Negócio aberto mais recente" pode errar** quando o contato tem dois negócios abertos e a
   consulta é do outro. A recepção pode passar `deal_id` explicitamente (a coluna existe); a tela ainda
   não oferece isso. Preferi errar para o mais recente a não ligar nada.
4. **`occurred_at` do `scheduled` é o momento da marcação (`now()`), não a data da consulta.** É o
   que a Meta quer ("quando o lead agendou"). O `attended` usa a hora da consulta porque comparecer
   acontece ali; se a recepção marcar semanas depois, a 3c vai descartar pela janela.
5. **`won` por inserção já ganha** (importação) gera marco com `closed_at` antigo. A 3c aplica a janela
   e marca `skipped`; não é lixo, é fato registrado.
6. **Arrependimento só protege o que ainda não foi enviado.** `attended`/`won` já `sent` ficam como
   estão; estornar na Meta é decisão da 3c.
7. **`source` do ganho = `reception` quando há `auth.uid()`**, mesmo que o caminho seja a ferramenta da
   IA chamada por um usuário logado. É "quem estava logado", não "quem decidiu". Aceitável para a Meta;
   registrado.
8. **Gatilho `AFTER UPDATE OF status, deal_id`** não dispara em update de `contact_id` sozinho; o
   `BEFORE` de vínculo cobre `contact_id` e `deal_id`. Se o vínculo mudar por troca de contato, o
   `deal_id` novo dispara o AFTER via `deal_id`. Conferido nos testes só o caminho principal.
9. **Cascata:** apagar o negócio apaga os marcos (`on delete cascade`); apagar a consulta deixa o marco
   com `appointment_id` nulo. Fatos sobrevivem à consulta, não ao negócio. Escolha consciente.
10. **Sem PII nova:** a tabela guarda ids, tipo, data e valor. Nada de procedimento.

## 6. Próximos passos

- **Codex:** revisão pontual (1 migration + 2 testes + tipos).
- **3c:** envio à Meta pelo CRM: config por cliente, dispatcher na hora + varredura no tick, janela
  confirmada na doc, `no_show` nunca sai, valor só no `won` se o Junior quiser.
- **3d:** `replied` no webhook com critério de região.
- **Rollout:** com a cadeia do Pacote 3. Preflight extra: contar `appointments` com contato e sem
  negócio aberto (ficam sem vínculo) e negócios abertos em duplicidade por contato.
