# Construtor de Funil + Automação — SPEC

> Autor: Claude (Opus 4.8). Data: 2026-07-16. Base: `VISAO-PRODUTO.md` (aprovada pelo Junior) + `PESQUISA-KOMMO.md` + `PESQUISA-GHL.md`.
> Modelo de trabalho: Claude escreve SPEC+PLAN → **Codex opina na estrutura ANTES de executar** (pedido explícito do Junior) → Junior aprova → Codex implementa → Claude revisa.

## 1. Por que existe

O CRM precisa de um **construtor de sequências de mensagens** nativo. Dois motivos:

1. **Operação da clínica-piloto:** a Dra. Jéssica já tem **3 fluxos de follow-up diferentes por serviço** (lentes/facetas, ortodontia, estética facial). Hoje isso é manual. O Funil de Follow-up já existe no CRM (11 etapas, F1 D+0 → F9 D+25) mas **não anda sozinho**.
2. **Produto vendável:** automação nativa é o que separa um CRM de uma planilha bonita. A decisão do Junior é explícita — **automação dentro do sistema, n8n externo descartado pro produto**, e a **IA da plataforma monta o fluxo por linguagem natural**.

## 2. O que é (resumo — detalhe em `VISAO-PRODUTO.md`)

Um criador de sequências onde o usuário monta o fluxo numa **lista vertical simples**, escreve ou reaproveita mensagens de uma **biblioteca**, anexa **vídeo/áudio/imagem/link**, e escolhe se quem monta é **ele na mão** ou **a IA**.

## 3. Escopo — 3 blocos

### Bloco 1 — Motor + construtor manual (o grosso)
- Tabelas do motor: automações · passos · **inscrições (cursor por lead, com snapshot da definição)** · logs.
- **Tipos de passo v1:** enviar mensagem (texto/imagem/vídeo/áudio/link) · esperar tempo · **esperar resposta com prazo** · criar tarefa · mover etapa/funil · condição (se/então).
- **Biblioteca de mensagens** — entidade própria; ao puxar pro passo cria **cópia local** + toggle *"sincronizar com a original?"* (padrão desligado). Mesma biblioteca serve o atendimento manual.
- **Biblioteca de mídia** — sobe uma vez, usa em qualquer passo. Limites do WhatsApp validados **na hora do upload**.
- **Tela do fluxo:** gatilho + passos na **mesma tela**, lista vertical, botão "+" entre passos, **sem canvas de arrastar**.
- **Roteamento por etiqueta (tag)** do lead — é o que faz os 3 serviços caberem sem multiplicar funil.
- **Agendador** que faz os delays andarem.
- Modo seguro: **nada dispara pra número real** (ver Bloco 3).

### Bloco 2 — A IA monta o fluxo
Contrato obrigatório (espelhado do GHL, que é o único precedente comprovado):
```
texto em português → ≤3 perguntas, TODAS puláveis → gera em segundos (com os textos)
→ NASCE DESLIGADO → lista de pendências CLICÁVEL (leva ao passo) → humano revisa → HUMANO PUBLICA
```
A IA **nunca** publica, **nunca** dispara, e **nunca** escreve direto no banco — ela emite a estrutura, que é **validada** (formato + semântica: a etapa existe? é do tenant? delay dentro do limite? sem passo órfão? sem loop?) antes de instanciar desativada.

### Bloco 3 — Ligar o disparo real
**Bloqueado por 2 pré-requisitos que não dependem de código:**
1. O **número real da IA** existir e estar pareado (destravado pela feature multi-número, já em produção — mas o número ainda não existe).
2. **Estudo de compliance do WhatsApp** (janela de 24h, template aprovado pela Meta, rate limit, risco de ban).

Até lá o motor roda em **modo seguro**: simula o envio e registra no log, sem chamar a Evolution.

## 4. Decisões travadas (não reabrir)

| # | Decisão | Origem |
|---|---|---|
| 1 | **"Esfriou" = 5 dias** sem responder → volta pro follow-up | Junior |
| 2 | **Remover a coluna "✅ Respondeu → Agendar"** → responder = vai pro Funil de Vendas / "Triagem e Qualificação IA" | Junior |
| 3 | Lead entra no fluxo **por etiqueta**, não por etapa | pesquisa (Kommo+GHL) |
| 4 | **Lista vertical, sem canvas** de arrastar | GHL rodou 4 anos assim |
| 5 | Mensagem: **cópia local + sync opcional** | GHL |
| 6 | **IA gera → humano publica.** Sempre | GHL |
| 7 | **Inscrição carrega snapshot imutável** da definição — republicar não move quem já está andando | invariante |
| 8 | **Rollback restaura o desenho, nunca os envios** | invariante |
| 9 | **Fallback de variável em TODOS os canais** (não só e-mail) | melhoria s/ GHL |
| 10 | **Pausar/retomar automação por lead** no takeover humano | melhoria s/ ambos |
| 11 | **Atribuição de resposta por message-id** | bug admitido do GHL |
| 12 | Permissão separada: **editar fluxo ≠ operar fluxo** | melhoria; E1/E2 já suportam |
| 13 | Passo de **áudio não aceita texto/legenda junto** | regra da Meta (Kommo+GHL) |
| 14 | Antes de mandar mídia, **checar a janela de 24h** e desviar se fechada | GHL |
| 15 | Tratar obrigatoriamente **"não respondeu"** e **"falhou o envio"** | Kommo |

## 5. Critério de sucesso (aprovado pelo Junior)

> "Eu abro o CRM, crio um fluxo de mensagens do zero na mão — ou peço pra IA criar —, escrevo as mensagens, anexo um vídeo numa delas e um áudio em outra, e salvo. Coloco um lead de teste: as mensagens saem na ordem e no tempo certos, com a mídia. Se o lead responde, ele sai do fluxo sozinho e cai no Funil de Vendas na Triagem. E eu consigo editar qualquer mensagem depois sem refazer o fluxo — tudo isso sem ninguém tocar em código."

Complementos técnicos do mesmo critério:
- `npm run precheck:fast` verde.
- Nenhum envio real dispara enquanto o modo seguro estiver ligado.
- Um lead que já está no fluxo **não muda de rota** quando o fluxo é republicado.
- Secretária assume a conversa → automação daquele lead **pausa** (não some).

## 6. Dados reais do piloto (verificados)

**Funil de Follow-up** `9aa992c9-3c5e-4ef1-8188-ed04c87cc38a` (org Jéssica `bd43a9bc-5bab-410a-a5a6-c214f3836f0e`), 11 etapas: F1·Reabrir(D+0) `ce362f8e` · F2·Avaliação(D+1) `9fda5ec7` · F3·Quebrar "artificial"(D+2) `9ea33bac` · F4·Prova(D+4) `2f5360aa` · F5·Medo(D+6) `1a7b770c` · F6·Decisão/valor(D+9) `b8f858b8` · F7·Autoestima(D+13) `c0ee34a1` · F8·Escassez(D+18) `8df40da4` · F9·Fechar ciclo(D+25) `522a0d13` · ✅Respondeu→Agendar `2bb09244` **(a remover)** · Encerrado `f4407b19`.

**Destino de quem responde:** Funil de Vendas `f65275f5-666a-478d-a021-829a758155bb` → etapa **"Triagem e Qualificação IA"** `b29fd27a-a863-4dd4-ba74-89b189c514b4`.

**Vídeos** (Desktop → `Videos Follow-up Dra Jessica/`), já nomeados por etapa:

| Serviço (pasta) | Vídeos |
|---|---|
| **LENTES** | F3 "Video 2 (medo artificial)" · F3 "Video 6 (branco exagerado)" · F4 "Transformação de um sorriso" · F5 "As pessoas não têm medo de lentes" · F5 "Dúvida do paciente" · F7 "Video 8 (primeira impressão)" |
| **ORTODONTIA** | F3 "Aparelho não é só para adolescente" · F5 "Aparelho sem planejamento (obra sem projeto)" |
| **PELE-PEPTIDEOS-BOTOX** | F3 "Pele envelheceu do nada" · F4 "Olhar cansado (dorme 8h)" · F5 "Peptídeos funcionam" · F6 "Protocolo (botox + ativos)" |

> **⚠️ BLOQUEIO DE MÍDIA (achado ao verificar):** os 12 vídeos são **`.mov`, de 56MB a 322MB** (um é **4K 60fps**). O WhatsApp aceita **MP4 (H.264+AAC) até 16MB**. **Nenhum pode ser enviado como está.** Precisa de uma passada de conversão/compressão pra MP4 ≤16MB (ffmpeg disponível na máquina). Tarefa à parte, não bloqueia o build do construtor — mas **bloqueia a demonstração com vídeo**.

**Textos das mensagens:** o PDF `WorkSync/workspaces/Dra Jessica Barros/02-followup/Funil-9-Mensagens-WhatsApp-Dra-Jessica-Cenoura-Hub.pdf` tem 9 mensagens (a confirmar de qual serviço). **Faltam os textos dos outros 2 fluxos.** Semear conteúdo é **tarefa de dados, separada do build do construtor.**

## 7. Fora de escopo (v1)

Canvas de arrastar · teste A/B de fluxo · relatório de desempenho por sequência · disparo real (Bloco 3) · edição de fluxo por múltiplos usuários simultâneos · versionamento com histórico visual.

## 8. Já anotado para DEPOIS desta etapa (pedido do Junior, 2026-07-16)

1. **Etiquetas de origem do lead** — anúncio Meta, Google Ads, indicação, etc.
2. **Etiquetas de canal de agendamento** — agendou por WhatsApp ou por ligação.
   → objetivo: **dados precisos pro dashboard comercial**, métricas e uso como case.
3. **Tracking de conversão pros pixels** das plataformas de anúncio (Meta/Google), pra otimizar campanha.

*(Detalhe no backlog do cérebro. Quando chegar a vez, consultar as skills `shanks-traffic` / `trafego-pago-cs`.)*

## 9. Governança

- Teste em **não-produção** (Supabase local). **Nunca** no banco da clínica.
- **Sem deploy** até aprovação do Junior.
- Branch `feat/funil-construtor`. TDD.
- Modo seguro ligado por padrão: **nenhuma mensagem sai pra número real** nesta entrega.
