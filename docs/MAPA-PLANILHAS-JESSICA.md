# Mapa das planilhas da Dra. Jéssica → CRM

> Leitura estrutural feita em 2026-07-24 direto dos arquivos em
> `WorkSync/workspaces/Dra Jessica Barros/`:
> `00 - Mapa XXXX REV 17.7 BL.xlsx` e `LEAD (2).xlsx` (ambos rev. 27/07/2026).
> Explicação de negócio: **Adel**, na conversa de 24/07.
> **Nenhum dado de paciente foi copiado pra cá** — só estrutura, catálogos e regras.

## Resumo em uma linha

A clínica opera **dois sistemas paralelos em Excel**: o **Mapa** (financeiro/atendimento,
uma aba por dia + consolidação mensal, por dentista) e o **LEAD** (comercial, uma aba por
mês, com **a cadência de follow-up F1–F9 marcada na mão**). São exatamente as duas metades
que o CRM já separa — `atendimentos` e `contacts`/funil.

---

# 1. Planilha MAPA (financeiro / atendimentos)

**Formato:** 33 abas — `01`..`31` (uma por **dia do mês**, 75×84 cada), `Mensal`
(423×101, consolidação) e `Atualizações` (oculta, changelog).
**Uma planilha por profissional** (Adel cria uma cópia por dentista).

## 1.1 O que a atendente preenche (aba do dia)

| Col | Campo | Como preenche | Vira o quê no CRM |
|---|---|---|---|
| Q | **Nome do Paciente** | digita | `contacts.name` |
| R | **Procedimento** | **lista** (do catálogo do dentista) | `atendimentos.procedimento` |
| D | **Valor Pago** | digita (vem pré-preenchido do catálogo) | `atendimentos.valor` |
| E | **Forma pag** | **lista** | `atendimentos.payment_method` |
| F | **Bandeira** | **lista** | ⚠️ **não existe no CRM** |
| G | **Parc** | **lista** 1–12 | `atendimentos.installments` |
| N | **Tipo Proc.** | **lista** | categoria do procedimento |
| S | **Observação** | digita | nota |
| T | **Visto** | marca | conferência |

**Tudo o mais é calculado** — a atendente não toca: Ticket Médio (B), Valor Tratam. (C),
Descontar (H), Valor a receber (I), Valor total (K/L), Soma (M), Valor Dr(a) (O),
Soma Dr(a) (P). Há **27 colunas ocultas** por aba só de apoio ao cálculo.

## 1.2 Catálogos (viram cadastros do CRM)

- **Formas de pagamento (6):** Crédito · Débito · Pix · Dinheiro · Boleto · **Pix Direto**
- **Bandeiras (6):** Master · Visa · Hiper · AMEX · Elo · Diners
- **Tipo de procedimento (4):** Clínico · Espec. · Harmo. · Lente
- **Parcelas:** 1 a 12
- **Profissionais (7):** Jéssica Barros · Letícia Pires · Leonel Carvalho ·
  Manuela Gonzalez · Felipe Bueno · Paula Almeida · Ana Clara Ofrante
- **Procedimentos: um catálogo POR DENTISTA** (blocos nas colunas ocultas da `Mensal`),
  cada linha com **Procedimento · Valor · Desconto · Comissão**. Ex.: Jéssica ≈ 32
  procedimentos (ortodontia: aparelhos, manutenções, contenções…); Ana Clara ≈ 15
  (clínica geral: raspagem, profilaxia, restaurações, clareamentos…).
  Ao escolher o dentista na `Mensal`, a lista de procedimentos do dia passa a ser a dele.

## 1.3 A regra de dinheiro (é isto que o CRM precisa reproduzir)

**Taxa de cartão = matriz `bandeira × parcelas`, aplicada como MULTIPLICADOR.**

| Bandeira | Débito | 1× | 2× | 6× | 12× |
|---|---|---|---|---|---|
| Master | 0,99% | 0,9709 | 0,9611 | 0,9359 | 0,8741 |
| Visa | 0,99% | 0,9709 | … | … | … |
| Hiper | 1,79% | 0,9629 | … | … | … |
| Elo | 1,79% | 0,9629 | … | … | … |
| AMEX / Diners | 0 | 0,9629 / 0,9686 | … | … | … |

Fórmula do dia: `Valor a receber = Valor pago × multiplicador(bandeira, parcelas)`,
com desvio por forma de pagamento (`crédito` × `débito` × dinheiro/pix sem taxa).

**Consolidação mensal** (aba `Mensal`, uma linha por dia): Bruto · Saldo Bruto acumulado ·
Ticket Médio · Desconto · Soma Valor Diário · **Vale** · **Pix Direto** · Soma Vale ·
**Crédito** (= o que entra **no mês seguinte** — a "previsão de recebimento").

---

# 2. Planilha LEAD (comercial) — 🔥 é o funil do CRM feito à mão

**Formato:** 41 abas — uma por **mês** (Maio/2023 → Julho/2026), + `Remarketing` +
`Contabilização`.

## 2.1 O que a atendente preenche (aba do mês)

| Col | Campo | Como preenche |
|---|---|---|
| B/C/D | **Nome · Telefone · E-mail** | digita |
| E | **1º contato** (data) | digita |
| F | **Como nos conheceu?** | **lista**: Instagram · Anúncio · Indicação · Google · Parceria · Panfleto · Placa |
| G | **Qual campanha?** | lista |
| H | **Engajamento** | lista |
| I | **Qual Interesse?** | digita (ex.: CONSULTA) |
| **J–R** | **F1 … F9** | **lista por toque** (ver 2.2) |
| S | **Agendamento** | data |
| T | **Compareceu?** | Sim/Não |
| U | **Continuidade?** | Sim/Não/Talvez |
| V | **Valor** | digita |
| W | **Remarcou** | Sim/Não |
| X/Y | Observação · Entrar em contato | digita |

## 2.2 A cadência F1–F9 — o achado principal

As colunas J a R **são a cadência de follow-up**, com o intervalo no próprio cabeçalho:

`F1 (D+0)` · `F2 (D+1)` · `F3 (D+2)` · `F4 (D+4)` · `F5 (D+6)` · `F6 (D+9)` ·
`F7 (D+13)` · `F8 (D+18)` · `F9 (D+25)`

Em **cada** toque a atendente marca um de quatro resultados:
**Sem resposta · Respondeu não agendou · Agendou · Pediu pra não chamar**

E a planilha calcula **"CONVERSÃO POR TOQUE (onde o lead agendou)"** — quantos agendaram,
responderam ou ficaram mudos **em cada F**.

> **Isto é exatamente o que o construtor de automação do CRM faz sozinho.** Os intervalos
> viram os passos de espera; os quatro resultados viram os caminhos do "Dividir caminho";
> a conversão por toque vira relatório automático. Hoje é digitado à mão, lead por lead,
> nove vezes.

## 2.3 Contabilização (o painel do Adel)

Aba final: por **mês** × **origem** (Anúncio · Instagram · Indicação · Total), as quatro
contagens do funil — **Contato → Agendamento → Comparecimento → Falta**.
É o número que ele acompanha para saber se o marketing está pagando.

---

# 3. O que o CRM já tem, o que falta

## ✅ Já existe e é só ligar
Contatos (nome/telefone/email) · origem do lead (catálogo) · etapas de funil ·
agendamento · atendimento com procedimento/valor/desconto/forma de pagamento/parcelas ·
profissionais com comissão · a cadência como **automação de verdade** · relatórios
financeiro e por profissional · export comercial e financeiro separados.

## ⚠️ Falta no CRM (é o "CRM crescendo pro caso real")

| # | Lacuna | Vem de | Impacto |
|---|---|---|---|
| 1 | **Bandeira do cartão** | Mapa col. F | sem ela não dá pra calcular a taxa |
| 2 | **Matriz de taxa `bandeira × parcela`** | Mapa BQ:CD | é a conta que faz o número bater com o dele |
| 3 | **Previsão de recebimento** ("Crédito" do mês seguinte) | Mensal col. K | é como ele enxerga caixa futuro |
| 4 | **Catálogo de procedimento POR profissional** (valor/desconto/comissão diferentes por dentista) | blocos ocultos | hoje o catálogo do CRM não é por profissional |
| 5 | **Campanha** e **Engajamento** do lead | LEAD col. G, H | atribuição fina de marketing |
| 6 | **Resultado por toque** (F1–F9) como métrica | LEAD J:R | "conversão por toque" é o KPI do Adel |
| 7 | **Vale / Pix Direto** como categorias de caixa | Mensal H, I | fecha o caixa do dia |
| 8 | **Remarcou** e **Continuidade** | LEAD U, W | qualidade do agendamento |

## 🐞 Bug encontrado (não relacionado às planilhas, mas afeta o relatório do Adel)
`lib/reports/summaryCsv.ts` conta leads na tabela **`leads`** (legada, **0 linhas**) em vez
de **`contacts`** (viva, 95 linhas no banco local). O link de totais mostraria
**"Leads: 0" para sempre**. Corrigir junto com a entrega do email.

---

# 4. Perguntas para o Adel (o que a leitura não respondeu)

1. **"Vale"** — é vale-adiantamento pro dentista, ou vale de desconto pro paciente?
2. **"Pix Direto"** × **"Pix"** — a diferença é a conta que recebe (PJ × pessoal)?
3. **Desconto** no catálogo por dentista — é desconto máximo autorizado ou desconto padrão?
4. **Comissão** — % ou valor fixo? Incide sobre o bruto ou sobre o líquido pós-taxa?
5. Uma planilha Mapa **por dentista**: quer que o CRM continue separando por profissional,
   ou prefere um lugar só com filtro por profissional?
6. **Engajamento** (col. H do LEAD) — quais são os níveis e o que cada um significa?
