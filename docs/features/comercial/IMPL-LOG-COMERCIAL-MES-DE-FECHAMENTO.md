# IMPL-LOG — Comercial por mês de fechamento

**Data:** 2026-09-04
**Branch:** `feat/funil-construtor`
**Construído por:** Claude (modelo de trabalho desde 04/09: Claude constrói, inclusive motor;
Codex revisa pedaços fechados — este é um deles)
**Estado:** implementado, testado localmente, **aguardando revisão pontual do Codex** e rollout

## 1. Decisão que originou

Junior, 04/09: *"o mais importante pra gente hoje é metrificar o comercial; esse CRM vai
atender as necessidades gerais de clientes que vamos assumir o comercial e acompanhar, e
ser nossa central OPS mais pra frente."* E sobre a régua: *"para metrificar o ganho do lead
metrifica no mês de fechamento, mas o dinheiro só consta em caixa quando ele realmente
entrar."*

Leitura confirmada por ele (*"é isso mesmo pode seguir"*): cada relatório numa régua só —
**Comercial** pelo mês em que o lead virou ganho · **Financeiro** = caixa · **Profissionais**
= competência. Nunca subtrair uma régua da outra.

Origem (*"pode seguir na sua recomendação"*): **primeiro toque** como padrão (de onde o lead
veio) e **campanha do último toque** como detalhe (o que converteu).

## 2. O que existia antes (mapa de 04/09)

- **Dashboard:** "Receita (Ganha)", "Conversão", "Pipeline Total" — **por coorte de
  ENTRADA** (dos negócios criados no período, quantos ganharam). Há um TODO no código
  admitindo que "ganhos neste mês independente de criação" é outra pergunta.
- **Visão Geral:** leads novos / por dia / por origem (`contact.source`), funil do mês por
  coorte de contatos.
- **`lead_source_attributions`** (UTM, campanha, fbclid, gclid): **gravada por
  `record_lead_source_attribution` e nunca lida** por relatório algum.
- **`deals.first_lead_source_id` / `last_lead_source_id`**: mantidos pela RPC de atribuição.
- **Planilha pública** (`/api/public/v1/reports/summary`, CSV por report token): recebido,
  leads do mês/total, agendamentos futuros — nada de fechamento, valor ou origem.

Nada disso responde "o que fechou neste mês, quanto vale, de onde veio". Era exatamente a
pergunta do Junior.

## 3. O que foi construído

### Motor — `supabase/migrations/20260904020000_comercial_por_mes_de_fechamento.sql`

Duas funções, uma conta:

| Função | Papel | Segurança |
|---|---|---|
| `commercial_report_data(org, inicio, fim)` | a conta canônica; usada pela tela (via RPC) **e** pela planilha pública (como `service_role`) | `SECURITY INVOKER`, `search_path = ''`, `REVOKE … FROM PUBLIC, anon, authenticated`, `GRANT … TO service_role` |
| `get_commercial_report(inicio, fim, org?)` | entrada da tela | `SECURITY DEFINER`, `search_path = ''`, gate `can_access_organization(v_org) AND has_permission('reports.view')`, `42501` fail-closed, `22023` período inválido; `REVOKE … FROM PUBLIC, anon`, `GRANT … TO authenticated` |

Semântica do JSON (`regime: 'fechamento'`):

- **`fechamento`** — negócios com `closed_at` no período: `ganhos {qtd, valor}`,
  `perdidos {qtd, valor, motivos[]}`, **`taxa_fechamento`** = ganhos ÷ (ganhos + perdidos)
  do período (decisões do mês, não coorte), `ticket_medio`, `ciclo_medio_dias` (média de
  `closed_at − created_at` dos ganhos).
- **`entrada`** — coorte do mesmo período, só contexto: `leads` (contatos criados),
  `negocios` (negócios criados), `valor`.
- **`por_origem`** — pelo **primeiro toque** (`deals.first_lead_source_id` → `lead_sources.name`;
  sem vínculo = "Sem origem"): ganhos qtd/valor e perdidos qtd, ordenado por valor ganho.
- **`por_campanha`** — pela atribuição **mais recente** de cada negócio ganho
  (`DISTINCT ON (deal_id) … ORDER BY observed_at DESC`), campanha =
  `coalesce(utm_campaign, campaign)`; último toque sem campanha = "Sem campanha".

Dois índices: `idx_deals_org_closed_at` (parcial, `closed_at IS NOT NULL`) e
`idx_lead_source_attributions_deal_observed`.

### Aplicação

- `types/types.ts` — `CommercialReport`, `CommercialReportOrigem`, `CommercialReportCampanha`.
- `lib/supabase/reports.ts` — `DbCommercialReport`, `transformCommercial`,
  `reportsService.getCommercialReport` (tolera resposta vazia/antiga).
- `lib/query/queryKeys.ts` — `dashboard.commercialRoot` / `dashboard.commercial(start, end)`.
- `lib/query/hooks/useFinanceReports.ts` — `useCommercialReport(start, end)` (mesmo padrão dos
  financeiros: `enabled` aguarda auth + tenant). Exportado em `hooks/index.ts`.
- `features/visao-geral/VisaoGeralPage.tsx` — seção **"Comercial do mês"** (`ComercialDoMesSection`,
  exportada para teste), entre os KPIs e a leitura inteligente, gateada por `reports.view` na
  UI (o RPC gateia de novo no servidor). Seis KPIs (fechados, perdidos, taxa, ticket, ciclo,
  entraram no mês) + "Fechados por origem" (barras, no estilo de "De onde vem o lead") +
  "Fechados por campanha" + linha de motivos de perda. Em erro do RPC a seção some — não
  imprime zero como se fosse verdade.
- `lib/reports/summaryCsv.ts` — a planilha pública recebe as mesmas linhas, vindas da conta
  canônica (`commercial_report_data` como `service_role`): fechados qtd/R$, perdidos qtd,
  taxa, ticket, e até 5 linhas "Fechados por origem — X". Tolera erro → sem as linhas, sem
  quebrar o CSV.

**Não construído, de propósito:** toggle "fechamento / entrada" (as duas leituras convivem
em blocos separados; o toggle esconderia uma delas), filtro de período na seção (é o mês
corrente, como o resto da Visão Geral), página dedicada, e mudança no Dashboard (continua
por coorte — o TODO dele agora tem resposta em outra tela, não precisa mudar).

## 4. Provas

| Prova | Resultado |
|---|---|
| Cadeia do zero em banco descartável | **74/74**; ledger local em 74 |
| `test/comercialReportMigration.test.ts` (estático) | 3/3 |
| **`test/comercialReportRpc.local.test.ts`** (integração, Supabase local, RPC real) | **5/5** — fixture com 7 negócios em 2 orgs, 2 origens, 2 atribuições, 3 contatos. Junho: ganhos **3 / R$ 1.700** (D4 fechou em julho e a org B não entram), perdidos 1 / R$ 800 com motivo "Preço", taxa **75%**, ticket **R$ 566,67**, ciclo **41,3 dias** (21 + 15 + 88 ÷ 3); entrada **4 negócios / R$ 10.600 / 2 leads**; por origem Instagram (1 ganho, 1 perdido) → Google → Sem origem; por campanha **promo-junho** (último toque do D1, que veio do Instagram) e "Sem campanha" (2); gate: anônimo, staff sem `reports.view` e admin de outra org → `42501`; helper interno responde ao `service_role` e recusa anônimo e autenticado |
| `features/visao-geral/ComercialDoMesSection.test.tsx` | 3/3 (números, origem, campanha, motivos; vazio explicado; erro → some) |
| `lib/supabase/reports.test.ts` (+2), `VisaoGeralPage.test.tsx`, `useFinanceReports.test.tsx`, `route.test.ts` | 23/23 |
| **`test/n7Reports.multiTenant.test.ts`** (planilha pública ao vivo) | 5/5 — CSV com "Fechados no mês (qtd)" e "Taxa de fechamento (%)" |
| `tsc --noEmit` · ESLint `--max-warnings 0` | limpos |
| Suíte completa `npm run test:local` | **237 arquivos / 1.138 testes, zero falhas** (188,6 s). Eram 234 / 1.125: os +3 / +13 são exatamente os testes novos. Saída em arquivo, lida em comando separado antes do commit |

## 5. Auto-revisão adversarial (escrita antes de declarar pronto)

1. **Negócio ganho sem `closed_at` não conta.** `mark_deal_won`/`mark_deal_lost` sempre
   preenchem; um negócio importado com `is_won = true` e `closed_at` nulo ficaria fora do
   fechamento (e do ciclo). É a régua certa — "quando fechou" precisa de data — mas vale
   contar isso no preflight de produção (`is_won AND closed_at IS NULL`).
2. **Campanha do último toque é estrita:** se a atribuição mais recente não tem campanha,
   o negócio vai para "Sem campanha", mesmo que um toque anterior tivesse. É o que "último
   toque" significa; um "último toque com campanha" seria outra métrica — documentado.
3. **Origem depende de `first_lead_source_id`.** Negócios anteriores à atribuição (C2A,
   22/07) aparecem como "Sem origem". Não é bug; é ausência de dado.
4. **`entrada.leads` conta `contacts.created_at`** — todo contato, não só quem virou lead
   qualificado. É a mesma definição que a planilha pública e a Visão Geral já usavam.
5. **Fuso:** as bordas vêm do cliente em São Paulo (`getFinanceDateRange`), comparação
   `timestamptz` contra `timestamptz` — igual aos RPCs financeiros. Sem `AT TIME ZONE`
   dentro da conta, então sem dupla conversão.
6. **Superfície:** helper interno `INVOKER` sem gate, executável só por `service_role`; a
   RPC `DEFINER` gateada chama o helper como dono. Provado: anônimo e autenticado recebem
   `42501` no helper; anônimo, staff e outra org recebem `42501` na RPC.
7. **CSV:** as linhas novas entram antes de "Atualizado em". Planilha conectada que lia
   "Atualizado em" por posição de linha muda de índice — risco baixo, sem consumidor
   conhecido; registrado.
8. **Gate `reports.view`:** `clinic_staff` não tem por padrão (está em `CLINIC_STAFF_DENIED`).
   A recepção não vê o comercial, a admin e a agência veem. Se a operação quiser abrir para
   staff, é override de permissão, não mudança de código.
9. **Performance:** consulta por `closed_at` ganhou índice parcial; a atribuição por negócio
   ganhou índice composto. Não medido sob carga (mesma ressalva dos financeiros).

## 6. Próximos passos

- **Codex:** revisão pontual deste pedaço (1 migration + 1 seção + 1 CSV), cabe no orçamento.
- **Rollout:** vai junto com a cadeia do Pacote 3 (depende de `lead_source_attributions`,
  que já existe em produção desde 22/07 — mas a política é uma janela só).
- **Preflight extra:** contar `is_won AND closed_at IS NULL` na base real.
