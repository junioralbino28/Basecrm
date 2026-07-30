# DECISÕES DO JUNIOR — Financeiro e produto (29/07/2026, noite)

> **Pra você (Codex):** este documento DESTRAVA os blocos 4 e 5 da correção do Pacote 3
> (as duas adjudicações que faltavam) e adiciona requisitos novos que entram na MESMA
> correção — não em frente paralela. Ordem dos seus blocos 1-3 não muda.
> Contexto estratégico no fim (muda prioridade, não muda rigor).

---

## 1. P3-16 RESPONDIDO — a data que manda na comissão é a do ATENDIMENTO

Palavras do Junior: *"comissão é paga sempre no início do mês seguinte, ela compõe o
salário do quinto dia útil, mas ela pode entrar no sistema no dia que o paciente fez o
atendimento, ou seja, no dia que o profissional atendeu."*

Traduzindo em regra de motor — três datas DIFERENTES, cada uma com um papel:

| Data | Papel |
|---|---|
| **`performed_at`** (dia do atendimento) | **Escolhe a regra de comissão vigente** (resolve o P3-16: atendida 14/04 + regra nova em 15/04 = regra ANTIGA) e define a **competência** (mês em que a comissão é devida) |
| `paid_at` (dia que o dinheiro do paciente entrou) | Fluxo de caixa / bruto do período. NÃO escolhe regra. |
| Pagamento ao colaborador | Operacional: 5º dia útil do mês seguinte à competência. É quando a clínica PAGA, não muda o cálculo. |

O código hoje usa `paid_at` pra escolher a regra (`AT TIME ZONE` no resolvedor) — **muda
pra `performed_at`**. O teste vigente iguala as duas datas e não pega a diferença;
separar nas fixtures.

**✅ RESPONDIDO (Junior, 30/07):** *"a clínica assume o risco; se o profissional fez, ele
precisa ser comissionado — é o normal; se ocorrer diferente é caso à parte."*

Regra de motor: **comissão é devida INTEGRAL na competência do atendimento
(`performed_at`), independente de o paciente ter pago** — inclusive no parcelamento
clínica em 10x. Consequência direta no código: o resolvedor **deixa de condicionar a
comissão a `recebido = true`** (hoje o relatório filtra por isso; com parcelamento de boca
esse filtro seguraria a comissão indevidamente). `recebido`/`paid_at` continuam mandando no
**bruto/caixa** do período — não na comissão. Exceção (paciente sumiu, acordo desfeito) é
**ajuste manual caso a caso**, com trilha — não entra como regra automática.

## 2. P3-03 RESPONDIDO — o motor CALCULA fixo e híbrido de verdade

*"não adianta ter financeiro, para substituir controle de planilha"* — os campos NÃO são
informativos; o fechamento calcula.

- **Salário fixo e comissão são versionados por data**: alterou, vale da data da alteração
  em diante; o passado fica como estava.
- **Somatório partido**: valor antigo até o dia X, valor novo dali em diante, o mês soma os
  dois pedaços.
- **Duas mecânicas distintas** (não misturar): **salário é TEMPO** → mês da mudança rateia
  por dias; **comissão é EVENTO** → cada atendimento usa a regra vigente em `performed_at`,
  o mês soma atendimentos possivelmente com regras diferentes (isso o modelo de vigência já
  faz — falta o salário ganhar o mesmo tratamento).
- **Fixo + comissão convivem** (híbrido = os dois somados). Caso real do Junior: agência
  contrata PJ e negocia fixo + comissão DIFERENTES por pessoa — o modelo por colaborador
  com valores negociados individualmente é requisito, não acidente do caso Adel.

## 3. NOMENCLATURA — "COLABORADOR", nunca "profissional/doutor"

O produto é multi-vertical (SDR, closer, vendedor, atendente…). Rótulo neutro em TODA a
UI: **"Colaborador"** (aceito: "funcionário"; preferido: "colaborador").

- **Escopo: rótulos de tela, mensagens, planilhas, emails.** Mesmo padrão da varredura
  "paciente→lead/contato" que já foi feita (Pacote 1).
- **Schema (`professionals`, `professional_id`…) NÃO renomeia agora** — churn de migration
  sem valor pro usuário. Se discordar, argumente no parecer; o default é manter.

## 4. FORMA DE PAGAMENTO — catálogo criável pelo cliente (requisito já registrado, agora com adendo)

Decisão de ontem mantida: vira catálogo por org (padrão `job_roles`/`specialties`), cada
forma **declara comportamento** (pede bandeira? tem taxa? parcela? é parcelamento clínica?).
Hoje está chumbado em 6 pontos incluindo enum zod (`schemas.ts:253`) e CHECK constraint
(`payment_method_fees_payment_type_chk`).

**Adendo de hoje: FINANCIAMENTO, com ou sem juros**, entra como comportamento possível de
uma forma de pagamento (caso: cliente da clínica financia o tratamento). Juros afeta o
líquido. Não desenhar sozinho: levantar com o Junior se o financiamento é da CLÍNICA
(recebe parcelado com juros) ou de TERCEIRO (banco paga à vista e desconta taxa) — os dois
existem e o cálculo do líquido é diferente.

## 5. O NORTE DO FINANCEIRO — bruto, líquido e margem, PRECISOS

*"saber o quanto entrou bruto, o quanto vai ficar líquido e a margem de lucro"*. O motor
final precisa compor, com precisão auditável:

```
bruto do período (entradas)
− taxas de cartão/meio de pagamento
− juros/custo de financiamento (quando a forma declarar)
− pagamentos a colaboradores (fixo rateado + comissões por competência)
− custos fixos já cadastrados
= líquido → margem
```

Isso é a materialização do **resolvedor financeiro canônico** que você exigiu no P3-01:
UMA fonte usada por `get_commission_report`, `get_net_result` e qualquer tela — agora com o
escopo completo confirmado pelo dono.

## 6. Contexto estratégico (muda prioridade, não muda rigor)

Junior bateu o martelo (29/07): **o Basecrm compõe o SERVIÇO da Cenoura (programa de
6/12 meses), não é produto de prateleira a la GHL/Kommo.** Consequências práticas pra você:

- Quem configura é a Cenoura, nunca o cliente final → configurabilidade = velocidade de
  implantação, não self-service.
- Depois das correções do Pacote 3 + parcelamento clínica: **moratória de feature de motor**
  — nada novo sem implantação real puxando.
- Profundidade financeira além do necessário pra "bruto/líquido/margem precisos" não entra.
  O rigor (RLS, dinheiro auditável, testes) fica — é o que segura N clientes no mesmo
  sistema.

## 7. O que fazer com isso, em ordem

1. Seus blocos 1-3 do Pacote 3 seguem como adjudicado (fail-closed do teste · P3-14 ·
   multitenant).
2. **Bloco 4 (resolvedor canônico) TOTALMENTE destravado** — nenhuma pergunta pendente:
   regra por `performed_at` + comissão integral independente de recebimento (§1) +
   remuneração versionada com rateio (§2) + escopo do líquido (§5).
3. Bloco 5 (histórico imutável) destravado junto — salário versionado entra no mesmo padrão
   de "nunca editar o passado".
4. Nomenclatura "colaborador" (§3) é varredura de UI — pode ser pacote próprio, baixo risco.
5. Catálogo de formas de pagamento (§4) ganha spec DEPOIS do parecer da spec do parcelamento
   (Pacote 10) — mesma família, mesmos gates.
