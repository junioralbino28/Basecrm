# SPEC — Parcelamento clínica (acordo de boca)

**Autor:** Claude · **Data:** 2026-07-29 · **Estado:** ESPECIFICAÇÃO — nada construído
**Fonte:** Junior em 27/07 (o que é) e 29/07 (o fluxo completo), aprovado por ele em 29/07.
**Camada:** 🔴 **MOTOR** — tabela nova, migration, regra de dinheiro.
**Não se apoia no Pacote 3** (comissão / pagamento de dentista é outra área), mas segue a regra:
spec revisada antes de construir.

---

## 1. O problema, em uma frase

A paciente faz um procedimento caro (ex.: R$ 7.000) e combina pagar em 10x **sem passar
cartão** — todo mês manda pix ou leva dinheiro. Hoje isso vive **fora do sistema**: a
atendente controla num caderno e o Adel numa planilha. O CRM só entende parcela de cartão.

**Não confundir com `atendimentos.installments`**, que é parcela de CARTÃO (tem bandeira,
tem taxa, tem antecipação). Aqui não há bandeira, não há taxa e não há antecipação.

## 2. O fluxo aprovado

### 2.1 Fechar o pagamento

Na tela de registrar atendimento, "Forma de pagamento" ganha a opção **"Parcelamento
clínica"**. A tela já sabe fazer isso: hoje ela mostra **Bandeira** só quando é cartão e
zera os campos órfãos ao trocar de forma (`AtendimentoFormModal.tsx:200-252`). Mesmo padrão.

Ao escolher, aparecem — e o campo "Parcelas" de cartão **some**, pra não existirem duas
parcelas diferentes na mesma tela:

| Campo | Regra |
|---|---|
| **Entrada (R$)** | Opcional. Pode ser 0. Nunca maior que o total. |
| **Em quantas vezes** | Inteiro ≥ 1, aplicado sobre o **restante** (total − entrada). |
| **Dia do vencimento** | Dia do mês (1–31). Mês sem esse dia usa o último dia do mês. |
| **Primeiro vencimento** | Sugerido a partir do dia escolhido; editável. |

**Prévia obrigatória antes de salvar**, em linguagem de gente:
> *Entrada de R$ 1.000 + 10x de R$ 600 — vence todo dia 10, a partir de 10/08/2026.*

**Arredondamento:** o centavo que sobra vai na **última** parcela. A soma das parcelas +
entrada tem que bater com o total, exatamente. Isso é teste, não comentário.

### 2.2 O que nasce sozinho ao salvar

1. **Um acordo** ligado ao atendimento e ao paciente.
2. **N parcelas**, cada uma com valor e data de vencimento.
3. **Uma tarefa por parcela**, na data do vencimento, para a atendente — reusando a tabela
   `tasks` que já existe (`type='reminder'`, `contact_id` do paciente, `due_date` do
   vencimento). Consequência de graça: aparece em "Tarefas" e "Hoje" com a bolinha âmbar.

### 2.3 Atraso

Parcela venceu e não teve baixa: a tarefa **não some** e passa a contar como vencida,
aparecendo todo dia até alguém dar baixa. É o comportamento que "Hoje" já tem com ligação
atrasada — nada novo a inventar.

### 2.4 Reagendar ≠ postergar (dois botões, de propósito)

| Ação | O que muda | O que NÃO muda |
|---|---|---|
| **Reagendar a parcela** | A data combinada com o paciente. O lembrete acompanha. | — |
| **Postergar o lembrete** | Só a data do cutucão (ex.: +2 dias). | A data combinada e o estado "atrasada". |

Junior separou as duas explicitamente. **Juntar num botão só faria a clínica perder a noção
de quem está realmente atrasado** — "não consegui falar com ela hoje" não é "ela tem mais
prazo".

### 2.5 Baixa dentro do CRM

Botão **"Recebi"** na parcela: já vem preenchido com o valor da parcela e a data de hoje; a
atendente confirma ou corrige.

**Pagamento parcial** (aprovado por Junior em 29/07): aceita valor menor que o da parcela.
A parcela fica **parcialmente paga**, o restante continua pendente **na mesma parcela**, e o
lembrete continua ativo. Não cria parcela nova.

Quando a última parcela quita, o acordo vira **Finalizado** sozinho.

### 2.6 Planilha diária por email

- **Todo dia**, amarrada na feature de envio de planilha por email (já desenhada, ainda não construída).
- **Uma aba por dentista** — mesmo padrão da planilha do Adel.
- **Colunas obrigatórias (literais, do Junior):** nome da pessoa · procedimento feito · data
  em que fez o procedimento · quantidade de parcelas · data do primeiro pagamento.
- **Colunas que eu propus e ele aprovou:** valor da parcela · quantas já foram pagas ·
  próximo vencimento · situação (em dia / atrasada).
- **Finalizados vão pra uma aba "Finalizados"**, separada. Continuam no arquivo — a
  finalidade é backup — mas fora da visão do dia a dia. Aba em vez de linha oculta porque
  linha oculta no Sheets some e ninguém acha depois.

### 2.7 Onde a atendente vê tudo

Aba **"Parcelamentos"** no Financeiro (lista com filtro em dia / atrasado / finalizado) +
resumo dentro do card do paciente.

## 3. Modelo de dados proposto

Duas tabelas. Nomes em inglês, como o resto do schema.

```
installment_plans                        -- o acordo
  id, organization_id
  contact_id, atendimento_id, professional_id
  total_amount, down_payment_amount      -- total e entrada
  installments_count
  due_day                                -- dia do mês combinado
  status: active | finished | cancelled
  created_at, updated_at, created_by

plan_installments                        -- cada parcela
  id, organization_id, plan_id
  number                                 -- 1..N
  amount                                 -- valor devido
  paid_amount                            -- default 0 (permite baixa parcial)
  due_date                               -- data COMBINADA (muda só no reagendamento)
  remind_at                              -- data do CUTUCÃO (muda no postergar)
  status: pending | partial | paid | rescheduled
  task_id                                -- a tarefa gerada
  created_at, updated_at
```

`due_date` e `remind_at` **separados** é o que materializa a regra 2.4 no banco — não é
detalhe de tela.

### 3.1 Gates de segurança aplicados desde o início

Lições dos achados do Codex (Pacote 3) — nascer certo em vez de remendar:

1. **FK composta same-org** no padrão de `20260620000000_fk_cross_org_hardening.sql`:
   `(organization_id, contact_id)`, `(organization_id, atendimento_id)`,
   `(organization_id, professional_id)`, `(organization_id, plan_id)`. Sem isso, linha
   declarada da org A pode apontar pra atendimento da org B (achado **P3-04**).
2. **GRANT explícito + REVOKE de `PUBLIC` e `anon`** nas duas tabelas — RLS só restringe,
   não concede, e as ACLs herdadas dão `REFERENCES`/`TRIGGER`/`TRUNCATE` ao `anon` se
   ninguém revogar (achados de 24/07 e **P3-24**). Conferir contra `lead_sources`.
3. **RLS:** leitura por `can_access_organization`; mutação por `can_operate_organization`
   (a recepção precisa dar baixa — não é `can_configure_organization`).
4. **Baixa é RPC transacional com `idempotency_key` única** — não `INSERT` solto da tela.
   Retry de rede, clique duplo e duas abas não podem gerar dois recebimentos (achado
   **P3-02**, que é exatamente este erro na comissão).
5. **Criar o acordo é uma RPC transacional** — acordo + N parcelas + N tarefas nascem juntos
   ou não nascem. Escrita composta item a item deixa banco e tela divergentes (**P3-11/12**).
6. **Histórico não se reescreve:** baixa registrada não se edita por cima. Correção
   excepcional é operação explícita, com trilha.
7. **Dinheiro em centavos inteiros** ou `numeric` — nunca ponto flutuante.

## 4. Testes obrigatórios

1. Entrada + N parcelas **somam exatamente** o total (inclusive com centavo quebrado; a sobra vai na última).
2. Entrada zerada e entrada igual ao total (aí não nasce parcela nenhuma).
3. Dia 31 em mês de 30 dias → último dia do mês.
4. Nasce **uma tarefa por parcela**, com a data certa.
5. **Reagendar** muda `due_date` e o lembrete acompanha.
6. **Postergar** muda só `remind_at`; `due_date` e o estado "atrasada" ficam.
7. Baixa **parcial** deixa a parcela pendente pelo restante e mantém o lembrete.
8. Baixa da última parcela finaliza o acordo sozinho.
9. **Idempotência:** a mesma chave duas vezes registra UM recebimento.
10. Multi-tenant: org A não lê nem escreve parcelamento da org B; FK cruzada é **recusada pelo banco**.
11. `anon` não tem privilégio nas duas tabelas.
12. Planilha: aba por dentista, colunas na ordem pedida, finalizados na aba separada.

## 5. Fora do escopo (de propósito)

- **Mensagem automática pro paciente no WhatsApp.** O lembrete é interno (tarefa). Envio de
  mensagem está desligado até o parecer do Codex sobre o Pacote 7 — dá pra ligar depois sem
  refazer nada.
- **Juros, multa e correção por atraso.** Não foram pedidos; é acordo de boca.
- **Antecipar parcelas / quitar tudo de uma vez.** Não foi pedido — surgindo, é adendo.

## 6. Sequência combinada

Junior aprovou em 29/07: **spec agora** → entra na fila do Codex junto com as correções dele
→ **construção começa depois que ele fechar os dois primeiros blocos** de correção do Pacote
3 (segurança do ambiente de teste e P3-14), que são rápidos.
