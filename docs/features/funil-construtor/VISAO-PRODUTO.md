# Construtor de Funil — Visão de Produto

> Síntese das pesquisas `PESQUISA-KOMMO.md` + `PESQUISA-GHL.md` traduzida em **o que o NOSSO produto vai ser**. Escrita pro Junior (linguagem de produto, não técnica) em 2026-07-16.
> É a base do `SPEC.md`. Quando houver divergência, o SPEC manda.

## Em uma frase

Um **criador de sequências de mensagens** dentro do CRM: o usuário monta o fluxo numa lista simples, escreve (ou reaproveita) mensagens de uma biblioteca, anexa vídeo e áudio, e decide se quem monta é ele na mão ou a IA.

## Como funciona na prática

**Biblioteca de mensagens.** As mensagens não ficam presas dentro do fluxo — vivem numa biblioteca própria. Ao puxar uma pro passo, o sistema faz uma **cópia local** e pergunta: *"editar aqui muda a original também?"* Desligado (padrão) = ajusta só naquele fluxo (mexer no de facetas sem tocar no de ortodontia). Ligado = muda em todos. **A mesma biblioteca serve o atendimento manual** (a secretária puxa resposta pronta no chat).

**O fluxo.** **Lista vertical simples**, de cima pra baixo: gatilho no topo, passos embaixo, botão "+" entre eles. **Sem arrastar bloquinho, sem canvas.** Gatilho e passos na **mesma tela** — bate o olho e entende a jornada inteira.

**Passos disponíveis (v1):** mandar mensagem (texto/imagem/vídeo/áudio/link) · esperar X tempo · esperar resposta do lead (com prazo) · criar tarefa de ligação · mover pra outro funil/etapa · condição (se/então).

**Como o lead entra no fluxo certo:** **pela ETIQUETA (tag) do lead, não pela coluna do funil.** Marcou "facetas" → sequência de facetas. Marcou "ortodontia" → a dela. Os 3 fluxos convivem sem criar 3 funis.

**Mídia.** **Biblioteca única de arquivos** — sobe uma vez, usa em qualquer passo de qualquer fluxo. Regras do WhatsApp travadas na tela (limite por tipo; **áudio não leva legenda junto**). Antes de mandar mídia, o sistema **confere a janela de 24h** — se fechada, desvia em vez de falhar calado.

**A IA montando o fluxo.** Usuário escreve em português. Se ambíguo, a IA faz **até 3 perguntas — todas puláveis** ("decide você"). Em segundos devolve o fluxo montado **com os textos escritos**, porém **DESLIGADO**, junto de uma **lista de pendências clicável** (cada item leva direto ao passo que falta ajustar). O usuário revisa, corrige conversando, testa, e **publica — sempre humano**.

**Manual e automático convivendo.** Pausar/retomar a automação de um lead específico. Quando a secretária assume a conversa, a automação **para sozinha sem apagar** o lead do fluxo. Dá pra disparar um passo na mão.

**Depois de rodando.** Ver quem entrou, quem saiu e por quê. E ver **o caminho que o lead percorreu pintado no próprio fluxo** — clicou no histórico, cai no passo.

## O que copiamos (padrão testado)

| Copiamos | Por quê | Origem |
|---|---|---|
| Mensagem na biblioteca + cópia local com sync opcional | Resolve "mudar só nesse fluxo" vs "mudar em todos" | GHL (copy-on-add + toggle) |
| Fluxo escolhido por **etiqueta**, não por etapa | Faz os 3 serviços caberem sem multiplicar funil | Kommo (condição por tag) + GHL (Add to Workflow) |
| **Lista vertical simples**, sem canvas | 2 CRMs grandes rodaram anos assim; o simples resolve | GHL (4 anos no Standard) |
| Esperar-resposta com prazo (o que vier primeiro vence) | É o coração do follow-up | Kommo (passo Pause com corrida) |
| Obrigar a tratar "não respondeu" e "falhou o envio" | Impede o fluxo morrer calado | Kommo (branches automáticos) |
| **IA gera → humano publica** | Contrato do produto: IA nunca liga nada sozinha | GHL (AI Builder) |
| Histórico que leva de volta ao passo | Log que não navega é log morto | GHL (Highlight Path + Go To Action) |
| Gatilho + ações na mesma tela | Separar em 2 telas quebra o modelo mental e o debug | GHL (lição Campaigns→Workflows) |

## O que fazemos MELHOR (buracos que os dois admitem na própria doc)

1. **Variável com valor reserva no WhatsApp.** Lead sem nome cadastrado = mensagem com buraco. O GHL resolveu só pra e-mail. Nossa operação é WhatsApp → resolver em **todos os canais**, desde o dia 1.
2. **Pausar automação quando o humano assume.** Kommo não tem; GHL só resolve removendo o lead (destrutivo). Fazemos **botão pausar/retomar**.
3. **Não perder a resposta do lead.** Bug admitido do GHL: lead aguardando resposta + mensagem manual do humano = sistema perde a atribuição e **o lead trava**. Resolver por **message-id** na origem.
4. **Biblioteca de mídia única.** Nos dois, mídia funciona diferente por canal (link aqui, upload ali). No nosso é um lugar só.
5. **Enviar teste real** pra um número, do próprio fluxo — não só simulação (Kommo só simula).
6. **Separar quem edita o fluxo de quem opera** (`automation:edit` vs `automation:operate`) — já temos o sistema de permissões (E1/E2) pronto pra isso.

## Duas regras invisíveis (invariantes de arquitetura)

- **Republicar não move quem já está andando:** o lead carrega a versão do fluxo em que entrou. Senão ele pula de lugar no meio da sequência.
- **Desfazer desfaz o desenho, nunca as mensagens já enviadas.**

*(Ambas precisam estar no schema desde o começo — retrofitar depois é reescrita.)*

## Fora desta primeira entrega

Canvas de arrastar bloquinho · teste A/B de fluxo · relatório de desempenho por sequência · **disparo real pra lead** (só liga com o número da IA pareado + estudo de compliance do WhatsApp feito).

## Decisões já travadas pelo Junior

- **"Esfriou" = 5 dias** sem responder → volta pro follow-up.
- **Remover a coluna "✅ Respondeu → Agendar"** do Funil de Follow-up → responder = vai pro **Funil de Vendas / Triagem e Qualificação IA**.
- **3 fluxos por serviço** (facetas / ortodontia / estética facial) com mensagens **pré-definidas e editáveis**.
- Funis precisam aceitar **link, imagem, vídeo e áudio**.
- A etapa tem que **nascer pronta**: criada à mão OU pela IA, com fluxo manual E automático.
