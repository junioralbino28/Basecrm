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

> **Regra que o Adel deu e eu confirmei no arquivo:** o que ela mexe são as
> **células destravadas** (cinzas). A aba tem proteção ativa. Lista exata lida do
> arquivo: **B, D, E, F, G, H, N, O, Q, R, S** em cada linha de atendimento,
> **+ W nas linhas 6–8** (o Vale — a exceção que ele citou).
> ⚠️ **`H` (Descontar) e `O` (Valor Dr(a)) estão DESTRAVADOS**: vêm preenchidos por
> fórmula mas podem ser sobrescritos — coerente com "o custo varia de caso para caso"
> (Invisalign). *Aguardando o Adel confirmar que é intencional.*

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

> ⚠️ **Duas coisas diferentes que eu tinha misturado** (confusão apontada pelo Adel):
> **Tipo de procedimento** são só 4 (é a *categoria*, coluna N). O **catálogo** é a
> lista de tratamentos, que é **por dentista** e tem dezenas de itens.

- **Formas de pagamento (6):** Crédito · Débito · Pix · Dinheiro · Boleto · **Pix Direto**
- **Bandeiras (6):** Master · Visa · Hiper · AMEX · Elo · Diners
- **Tipo de procedimento — a CATEGORIA (4):** Clínico · Espec. · Harmo. · Lente
- **Parcelas:** 1 a 12
- **Profissionais (7):** Jéssica Barros · Letícia Pires · Leonel Carvalho ·
  Manuela Gonzalez · Felipe Bueno · Paula Almeida · Ana Clara Ofrante

### O catálogo de tratamentos — `Mensal` Y31:BH102

**9 blocos de 4 colunas**, um por dentista (7 preenchidos + **2 slots vazios** que o Adel
deixou pra dentista novo). Cada bloco: **Tratamento · Valor tratamento · Desconto · Comissão**.

| Bloco | Dentista | Especialidade (pelo catálogo) |
|---|---|---|
| Y:AB | Jéssica Barros | ortodontia (~32 itens) |
| AC:AF | Letícia Pires | endodontia |
| AG:AJ | Felipe Bueno | — |
| AK:AN | Leonel Carvalho | — |
| AO:AR | Manuela Gonzalez | — |
| AS:AV | Paula Almeida | — |
| AW:AZ | Ana Clara Ofrante | clínica geral (~15 itens) |
| BA:BD · BE:BH | *(vazios — slots)* | |

Ao escolher o dentista na `Mensal`, a lista de tratamentos do dia passa a ser a dele.

**Exemplos reais (Jéssica):** Consulta Inicial → valor 120, comissão **42** ·
Manutenção Ap. Metálico → 160, comissão **56** · Aparelho Autoligado → 950,
**desconto 230**, comissão **160** · Aparelho Estético → 2400, **desconto 800**, comissão **450**.
→ **A comissão é VALOR FIXO por procedimento**, não percentual (confirmado pelo Adel).

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

### 🔴 "Desconto" NÃO é desconto ao paciente — é CUSTO (correção do Adel, 24/07)

Este foi o meu erro mais grave de leitura. Na planilha, **Desconto = o gasto extra de
material/produto daquele procedimento** — ex.: o alinhador do **Invisalign, ~R$ 9 mil**,
que varia caso a caso. Não é abatimento dado ao paciente.

**Por que importa:** esse custo é **retirado ANTES de totalizar o valor do consultório**,
e é a base de **duas comissões**:
1. a **comissão do dentista**;
2. a **comissão da ATENDENTE** — *"não tem como o consultório pagar comissão pro atendente
   em cima desse valor também"* (Adel).

> ⚠️ **Choque semântico com o CRM:** hoje `atendimentos.desconto` significa *desconto
> concedido ao paciente*. São conceitos diferentes e **não podem ocupar o mesmo campo** —
> o CRM precisa de **custo do procedimento** separado de **desconto comercial**.
> **E não existe hoje nenhuma comissão de atendente no CRM.**

### Consolidação mensal (`Mensal`, uma linha por dia)

Bruto · Saldo Bruto acumulado · Ticket Médio · Desconto · **Soma Valor Diário (G)** ·
**Vale (H)** · **Pix Direto (I)** · **Soma Vale (J)** · **Crédito (K)**.

**A conta do acerto com o dentista** (lida das fórmulas, *a confirmar com o Adel*):
- **G** acumula o que o dentista **gerou** (`SUM(dia!P50)` — P = "Soma Dr(a)");
- **Vale (H)** = `dia!W6 + dia!W7` → **pagamento/adiantamento feito ao dentista** naquele dia;
- **Pix Direto (I)** = `dia!Z12` → pagamento que **não passou pela conta da clínica**
  (o paciente pagou direto ao dentista ou ao Adel; ou troca de serviço);
- **J** acumula tudo que já foi pago (Vale + Pix Direto);
- **Crédito (K) = G − J** → **saldo que o dentista ainda tem a receber**, pago no **mês seguinte**.

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
| ~~1~~ | ~~**Bandeira do cartão**~~ | — | ✅ **NÃO É LACUNA** — `atendimentos.card_brand` **já existe** no schema (verificado 24/07) |
| 2 | **Matriz de taxa `bandeira × parcela`** | Mapa BQ:CD | é a conta que faz o número bater com o dele |
| 3 | **🔴 CUSTO do procedimento** (o "Desconto" da planilha), separado de desconto comercial | catálogo, col. Desconto | ⚠️ **a MATEMÁTICA já está certa** — `get_commission_report` calcula `(valor − desconto) × percent`, ou seja **já retira o custo antes da comissão**. O problema é **só o nome/semântica** do campo: `desconto` no CRM significa abatimento ao paciente. Falta separar os dois conceitos. |
| 4 | **🔴 Comissão da ATENDENTE** (sobre o valor já sem o custo) | regra do Adel, 24/07 | não existe nada disso no CRM |
| 5 | **Comissão FIXA por procedimento e por dentista** | catálogo Y31:BH102 | ⚠️ **medido 24/07:** `commission_rules` só tem `percent` (0–100), por profissional **ou** por especialidade. **Nenhum percentual único reproduz a tabela do Adel** — nos procedimentos simples a taxa é exatamente **35%** (120→42, 160→56, 190→66,5), mas nos grandes ele quebra de propósito: Ap. Autoligado 950→160 (**≈17%**), Ap. Estético 2400→450 (**≈19%**). Precisa de valor fixo por procedimento. |
| 6 | **Catálogo de tratamentos POR profissional** | 9 blocos na `Mensal` | hoje o catálogo do CRM não é por profissional |
| 7 | **Conta-corrente do dentista** — gerado × pago (Vale, Pix Direto) × **Crédito a receber** | Mensal G/H/I/J/K | é o acerto mensal com cada dentista |
| 8 | **Pix Direto** como pagamento fora do caixa da clínica | Mensal col. I | senão o caixa não fecha |
| 9 | **Campanha** e **Engajamento** do lead | LEAD col. G, H | atribuição de marketing + leitura de interesse |
| 10 | **Resultado por toque** (F1–F9) como métrica | LEAD J:R | "conversão por toque" é o KPI do Adel |
| 11 | **Remarcou** e **Continuidade** | LEAD U, W | qualidade do agendamento |

## 🐞 Bug encontrado (não relacionado às planilhas, mas afeta o relatório do Adel)
`lib/reports/summaryCsv.ts` conta leads na tabela **`leads`** (legada, **0 linhas**) em vez
de **`contacts`** (viva, 95 linhas no banco local). O link de totais mostraria
**"Leads: 0" para sempre**. Corrigir junto com a entrega do email.

---

# 4. Perguntas ao Adel — ✅ RESPONDIDAS em 24/07

| # | Pergunta | Resposta dele |
|---|---|---|
| 1 | O que é **"Vale"**? | **Valor pago ao dentista** (a comissão dele). |
| 2 | **"Pix Direto"** × Pix | Pix que o paciente faz **direto ao dentista ou ao Adel** — não passa pela conta da clínica. Também cobre troca de serviço. |
| 3 | **Desconto** do catálogo | **Custo extra de material** do procedimento (Invisalign ≈ R$ 9 mil, varia por caso). **Não** é desconto ao paciente. |
| 4 | **Comissão** | **Valor FIXO por procedimento**, na tabela `Mensal` Y31:BH102. |
| 5 | Visão por dentista × filtro | **Em aberto** — ele pediu explicação. Respondido: no CRM os dois convivem (dado entra uma vez, a tela filtra). A escolha real é só se a atendente abre **já travada** num dentista ou escolhe na hora. |
| 6 | **Engajamento** | Campo do LEAD, pra **a atendente classificar o que o lead quer** e o Adel enxergar o interesse — *"a maioria clica no link e nem responde"*. |

## Rodada 2 — ✅ também respondido pelo Adel (24/07)

| Pergunta | Resposta |
|---|---|
| `H` e `O` destravados | **Sim, é intencional** (o custo varia caso a caso). |
| Conta do acerto `Crédito (K) = G − (Vale + Pix Direto)` | **"Exato"** — confirmado. |
| Base da **comissão da atendente** | **`Mensal` C33** = acumulado da coluna **L** ("Valor total **c/ desconto**") → ou seja, **o total do mês já líquido do custo de material**. |
| Atendente travada num dentista? | **Dentista fixado, com campo de troca** (alguém pode pegar um intervalo). Hoje é **1 cadeira**; no futuro, clínica com vários atendendo ao mesmo tempo — precisa que os atendentes preencham sem se confundir nem sobrescrever o que cada dentista fez. |

### Especialidades reais (ditas pelo Adel)

| Profissional | Especialidade |
|---|---|
| Jéssica Barros | Clínica geral, Ortodontia, Lentes em resina, Harmonização orofacial |
| Ana Clara Ofrante | Ortodontia |
| Paula Almeida | Clínica geral |
| Letícia Pires | Endodontia (raro: clínica geral) |
| Leonel Carvalho | Bucomaxilofacial — cirurgias, extração de siso |
| Manuela Gonzalez | Próteses |
| Felipe Bueno | Implantes |

> ⚠️ **Divergência a resolver:** o Adel diz **Ana Clara = Ortodontia**, mas o bloco dela no
> catálogo (AW) lista raspagem, profilaxia, restaurações e clareamentos = **clínica geral**.
> Catálogo desatualizado ou ela faz as duas coisas?

## Ainda em aberto
1. A divergência da Ana Clara (acima).
2. **Qual o critério** da comissão da atendente sobre a base C33 (percentual? faixa?).
