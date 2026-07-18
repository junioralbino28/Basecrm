# Pesquisa — Kommo: automação de funil com mensagens

> Pesquisa delegada por Claude a subagente, 2026-07-16. 20+ docs primárias lidas (support.kommo.com, developers.kommo.com, índice canônico `support.kommo.com/llms.txt`).
> Confidence Stack aplicado: `[Behavior observed]` = visto em doc oficial · `[Survey declared]` = afirmado em copy/blog · `[Inferred]` = inferência · "NÃO VERIFICADO" = sem evidência.
> Alimenta o SPEC do construtor de funil do Basecrm. **Não é fonte de verdade do nosso produto — é referência de padrão consolidado.**

## Arquitetura em 1 parágrafo

A Kommo tem **duas camadas separadas**. O **Digital Pipeline** ("Automate") é a camada de *gatilho por etapa* — não é onde a mensagem é escrita. O **Salesbot** é a camada de *fluxo conversacional* — onde mensagem, mídia e ramificação vivem. Um gatilho de etapa diz "nesta etapa, rode o bot X". **Essa separação é o padrão a copiar.**

## 1. Autoria/edição de mensagem

- Editor **inline no passo**, no builder visual. Adiciona passo **Message**, clica no campo de texto pra editar. `[Behavior observed]`
- **Dois modos no mesmo passo:** texto direto (vive só naquele passo) OU **Template** (selecionado de lista). `[Behavior observed]`
- **Template = entidade de primeira classe** (Settings → Templates → General templates), reutilizado em **chat manual + Salesbot + broadcast**. Editar num lugar propaga pra quem referencia. `[Behavior observed]` — [create-and-set-up-chat-templates](https://support.kommo.com/docs/id/create-and-set-up-chat-templates)
- **Editar depois sem recriar: sim**, nas duas camadas. Passos têm menu "…" com rename/duplicate/preview. `[Behavior observed]`
- **Preview: sim** — botão "Bot preview", tela dividida com área tipo display de celular, passo atual destacado. `[Behavior observed]`
- **Enviar teste pra número real: NÃO VERIFICADO** no Salesbot (só preview simulado). Existe só pra broadcasts de WhatsApp. → **oportunidade nossa.**
- "View source" edita como código, mas é **via de mão única** (não volta pro editor visual). Não copiar.

## 2. Mídia nos passos

- Passo Message suporta **Documents, Images, Videos, Audio**, anexo por **ícone de clipe**. `[Behavior observed]`
- **Áudio é cidadão de primeira classe** — [send-voice-messages-via-salesbot](https://support.kommo.com/docs/send-voice-messages-via-salesbot):

| Item | Valor |
|---|---|
| Tamanho máx. | **16 MB** |
| Formatos | WAV, MP3, OGG, M4A, AAC, FLAC, OPUS |
| Canais | Facebook, Instagram, **WhatsApp Business**, Telegram |

- Dois caminhos: **gravar direto no passo** (ícone de microfone; parou, não retoma — só ouvir ou deletar/regravar) OU **subir arquivo + "Convert to voice"** (vira PTT em vez de anexo). `[Behavior observed]`
- **⚠️ REGRA CRÍTICA A ESPELHAR:** passo com áudio-como-voz **não aceita texto nem botões**. Se adicionar, o áudio degrada pra arquivo baixável. **Passo de voz é tipo mutuamente exclusivo**, não "passo de texto com anexo". `[Behavior observed]`
- Limites de imagem/vídeo/documento: **NÃO VERIFICADO** (só áudio tem número).
- **Biblioteca de mídia central: NÃO VERIFICADO** como entidade — mídia parece ser anexada por passo/template. → **oportunidade nossa.**

### WhatsApp especificamente (importante)

- Templates de WhatsApp são **entidade SEPARADA** dos general templates — general **não** funciona pra broadcast de WhatsApp. `[Behavior observed]` — [manage-whatsapp-business-message-templates](https://support.kommo.com/docs/manage-whatsapp-business-message-templates)
- Estrutura Meta: **Header** (texto/imagem/vídeo) · **Body** · **Footer** · **Buttons** (até 3 quick reply ou 2 URL).
- Categorias: **Marketing** (Custom, Carousel, Flows) e **Utility**. Carousel só em Marketing; Flows exige WABA verificada.
- Fluxo: + New template → categoria → Save draft ou **Send for approval**. **Aprovação da Meta: 1 minuto a 48 horas.** Status: Draft/In review/Approved/Paused/Rejected.
- Rejeição comum: template só com placeholders sem texto adicional.
- Passo **"List message"** exclusivo de WhatsApp: até 10 opções.

## 3. Múltiplos fluxos (um por serviço) — a resposta que interessa

> **O fluxo NÃO é escolhido pela etapa — é escolhido pelo gatilho + condições.**

Três níveis `[Behavior observed]`:
1. **Pipelines** — até 50, independentes ou alimentando uns aos outros.
2. **Gatilhos por etapa** — em Leads → Automate, botão "+" sob a etapa. Config em 4 passos: add conditions → set execute rules → configure action → **apply to existing leads** (checkbox retroativo).
3. **Condições que selecionam o bot** — **Tags**, Lead stage, Responsible user, Sale (faixa), **Source**, "Does not have tags" (exclusão), **UTM**.

**→ Padrão pra "um fluxo por serviço": `tag` (ou custom field/UTM) como SELETOR DE FLUXO, não a etapa.** Um bot por serviço, todos com gatilho na mesma etapa, condição de tag distinta. Vários gatilhos coexistem na mesma etapa.

**4 famílias de gatilho** `[Behavior observed]`: pipeline (criado/movido pra etapa; delay configurável) · scheduled (relativo a campo de data, data-hora, recorrente) · behavior-based (formulário, e-mail, chamada, visita) · conversational (nova conversa, msg recebida/enviada, **inatividade X horas**).

**Encadeamento:** passo **"Start bot"** liga bot a bot (handoff); "Go to another step" salta interno; **Round Robin** (até 100 opções) serve de A/B test de fluxo.

**Limites duros:** máx **500 ações por sessão**; API `POST /api/v2/salesbot/run` aceita no máx **100 bots por vez**.

## 4. Manual × automático — o buraco da Kommo (nossa maior oportunidade)

**Verificado em 5 fontes distintas: NÃO existe toggle documentado de "pausar automação quando humano responde" no Salesbot.**

O que existe:
- **Passo "Stop the bot"** — terminal *do fluxo desenhado*, não controle reativo. `[Behavior observed]`
- **Interrupção bot-a-bot** — só entre bots; um bot ativo por conversa. `[Behavior observed]`
- **Escalada por não-reconhecimento** — só copy de landing page. `[Survey declared]`, não está na doc técnica.
- **"Send internal message"** — notifica humano, mas **notificar ≠ pausar**; o fluxo continua.
- **"Change conversation status"** → fechar conversa mata o bot. Workaround indireto e frágil.
- **AI Agent (produto separado) é melhor:** handoff quando não consegue ajudar/lead pede humano/limite atingido; chats transferidos aparecem não-lidos com contexto; parada via **gatilho de etapa**. Ou seja, **a Kommo modela "parar automação" como mover o lead de etapa**, não como botão. `[Behavior observed]`

**NÃO VERIFICADO (buscado ativamente):** pausar automação por lead no card · pular passo · reordenar passos em execução · disparar passo manual do card · retomar automação pausada.

> **Recomendação: não copiar.** Toggle explícito "humano assumiu → pausa automação" por lead + botão de retomar = barato (coluna `automation_paused_at` + `paused_by` na instância) e resolve dor real. **Maior ROI da lista.**

## 5. Variáveis / personalização

Duas sintaxes coexistem `[Behavior observed]` — [personalize-emails-and-chat-messages-with-placeholders](https://support.kommo.com/docs/personalize-emails-and-chat-messages-with-placeholders):

- **Interna (canônica):** `{{contact.name}}`, `{{contact.first_name}}`, `{{contact.cf.<field_name>}}`, `{{lead.id}}`, `{{lead.name}}`, `{{lead.cf.<field_name>}}`, `{{profile.name}}`, `{{company.*}}`, `{{*.responsible}}`.
- **De UI (o que o usuário vê):** colchetes — `[Lead name]`, `[Contact name]`, `[Lead responsible user]`.
- **Inserção:** digitar `[` abre **autocomplete**; ou menu "…"; ou botão `[-]`.
- **Custom fields por NOME, não por ID** (`{{lead.cf.<field_name>}}`) — escolha por legibilidade; custo = rename de campo quebra template.
- **Fallback de campo vazio: NÃO VERIFICADO.** Nenhuma doc descreve. → decidir no nosso (sugestão: `[Lead name | cliente]`).
- Restrição Meta: template só com placeholder → rejeitado.

## 6. Quem pode editar (parte mais fraca da doc)

- Primeiro usuário = Administrator; **papel de admin é imutável**. `[Behavior observed]`
- **4 níveis por cor** em leads/contacts/companies: vermelho (sem acesso) · laranja (só os próprios) · azul (do time) · verde (tudo). Categorias extras: pipeline stage access, field permissions, shared inbox, **media access**. `[Behavior observed]`
- **NÃO VERIFICADO:** permissão granular pra criar/editar Salesbot/automação/template. Três páginas de permissão consultadas, nenhuma menciona. `[Inferred]` que seja admin-only de facto (fica em Settings).

> **Recomendação:** par simples `automation:edit` vs `automation:operate` (gestor edita fluxo, operador dispara/opera) — a Kommo aparentemente não oferece.

## 7. UX concreta (pra espelhar)

**Três portas de entrada pro mesmo builder** `[Behavior observed]`: Settings → Communication tools · Chats → engrenagem → Templates & Bots · Leads → Automate → "+ Add Trigger" → "+ Salesbot". Deliberado: mesmo objeto alcançável de config, de conversa e de funil.

**Modal de criação:** "New" (do zero) ou **template pré-pronto** — vêm com fluxo preset editável **e gatilhos já configurados**. São **13 templates prontos** (greeting, horário comercial, alerta espera >5min, alerta janela 24h da Meta, roteamento, resposta a comentários, fechamento por inatividade 5 dias, keyword trigger, follow-up 3 dias, feedback emoji, opt-in…). `[Behavior observed]`

**Canvas:** passos **numerados**, conectados por **pontos clicáveis** desacopláveis. Menu "…" por passo (rename/duplicate/preview). **Map** no rodapé pra navegar. **Salto longo vira botão clicável** em vez de linha comprida, com "Back to…" temporário — solução elegante contra espaguete visual. `[Behavior observed]`

**Dentro do passo Message:** campo de texto · link p/ template · clipe (doc/imagem/vídeo/áudio) · microfone (gravar) · sticker/emoji · `[-]` placeholder · **"+ Quick Reply"** (até 13 botões, UI recomenda "no more than three") · botões URL (rótulo+link) · **synonym keywords** por botão · dropdown **Channel** · seletor de destinatário. `[Behavior observed]`

**⭐ Ramificação automática sugerida (detalhe mais copiável):** ao adicionar botões, a Kommo **sugere sozinha** os branches de borda — **"Another answer"** (respondeu fora das opções) e **"No answer"** (com timer). E o passo de mensagem gera branch por entrega: **"Delivered status"** segue o principal, **"Failed to send message"** abre branch de erro. **O sistema força o autor a tratar os caminhos infelizes** em vez de deixar o fluxo morrer calado. `[Behavior observed]`

**Inventário de passos** `[Behavior observed]` — [salesbot-overview](https://support.kommo.com/docs/salesbot-overview):
- *Passos:* Message · List message (WhatsApp) · Condition · Comment (IG) · **Pause** · Validation · Send internal message · Subscribe
- *Avançados:* Go to another step · Start bot · Custom step (code) · Widget · Round Robin
- *Ações (14):* Add note · **Add task** · Change conversation status · **Change lead status** · Change responsible user · Complete task · Generate form · Create lead · Manage subscribers · **Manage tags** · Meta Conversions API · Send email · Send webhook · Set field

**Passo Pause (= nosso `wait_for_event`)** `[Behavior observed]`: condições "Message received", "Timer is out" (**máx 8760 horas**), "Except for duty hours", "Video is opened/closed". Com "+ Add next condition", **o bot segue a PRIMEIRA condição satisfeita** — corrida entre resposta e timeout. **Copiar tal e qual.**

**Validation:** equals / not equals / contains / not contains / length / **regex**.

## Síntese — o que copiar / o que fazer melhor

**Copiar tal e qual:**
1. **Separação gatilho ↔ fluxo** (etapa dispara bot; etapa não contém mensagem) — é o que torna N fluxos por etapa possível.
2. **Template como entidade de primeira classe**, reutilizável em automação + chat manual + broadcast.
3. **Seleção de fluxo por tag/campo, NÃO por etapa** — é assim que se faz "facetas/ortodontia/estética" sem multiplicar funis.
4. **Branches obrigatórios de caminho infeliz** (No answer / Another answer / Failed to send), sugeridos automaticamente.
5. **Passo Pause com corrida de condições** (primeira que bater vence).
6. **Passo de voz mutuamente exclusivo** com texto/botões (regra de UI explícita).
7. Três portas de entrada pro builder.
8. Salto longo vira botão + mapa de navegação.
9. **Autocomplete de placeholder ao digitar `[`.**
10. **Templates de fluxo prontos com gatilho já configurado.**

**Fazer MELHOR (buracos verificados):**
1. **Pausa por lead quando humano assume** + botão retomar. *(maior ROI)*
2. **Enviar teste real** pra um número, do próprio fluxo.
3. **Permissão granular** `automation:edit` vs `automation:operate`.
4. **Fallback declarado de placeholder vazio.**
5. **Biblioteca de mídia central** (em vez de upload por passo).
6. **Modo código com volta** (o "View source" da Kommo é via de mão única).

## LACUNAS declaradas

1. Enviar teste real de passo do Salesbot — sem menção em nenhuma doc.
2. Limites de tamanho/formato de imagem, vídeo, documento (só áudio: 16 MB).
3. Toggle "parar bot quando gerente responde" — não existe documentado (só AI Agent, via etapa).
4. Pausar/pular/reordenar passos por lead em execução.
5. Disparo manual de passo isolado a partir do card.
6. Permissão específica pra editar automação/template (inferência, não fato).
7. Comportamento de placeholder com campo vazio.
8. Biblioteca de mídia global como entidade.
9. Se templates de fluxo customizados podem ser salvos pra reuso.
10. Pastas/categorias de templates.
11. Prints reais — descrições vêm de texto de doc, não de inspeção visual. Pra fidelidade pixel-level, abrir trial e inspecionar ao vivo.
