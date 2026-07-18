# Pesquisa — GoHighLevel: automação de funil + AI Workflow Builder

> Pesquisa delegada por Claude a subagente, 2026-07-16. Fontes primárias: help.gohighlevel.com, ideas.gohighlevel.com/changelog, marketplace.gohighlevel.com/docs.
> Confidence Stack: `[BO]` Behavior observed (doc/changelog oficial) · `[SD]` Survey declared (fórum/blog de praticante) · `[INF]` Inferred · "NÃO VERIFICADO".
> Alimenta o SPEC do construtor de funil do Basecrm. Par: `PESQUISA-KOMMO.md`.

## Descoberta estrutural (decide nossa UI)

O GHL tem **dois builders coexistindo**: o **Standard** (padrão, ~4 anos) = **fluxo linear vertical** sobre canvas pannável, com **posicionamento automático** dos nós (o usuário NÃO escolhe coordenada XY); e o **Advanced Builder** (out/2025, atrás de feature flag Labs, só Agency Admin) = canvas freeform tipo n8n. `[BO]` — [Advanced Builder](https://help.gohighlevel.com/support/solutions/articles/155000006635-advanced-builder-for-workflows)

> **Eles rodaram 4 anos com linear vertical e só adicionaram canvas livre COMO OPÇÃO.** Sinal mais forte da pesquisa: o linear vertical cobre a esmagadora maioria dos casos e custa uma fração. **Começar linear vertical, sem coordenadas XY no banco.**

## 1. Autoria/edição de mensagem

- **Editor inline dentro da ação, sempre** (SMS, Email, WhatsApp), com merge fields. O Email Builder inteiro foi **embarcado dentro da ação Send Email** — não troca de aba. `[BO]`
- **⭐ PADRÃO Nº1 A COPIAR — copy-on-add + toggle de sincronização** `[BO]` — [Managing Email Templates in Workflow Steps](https://help.gohighlevel.com/support/solutions/articles/155000005553-managing-email-templates-in-workflow-steps): ao adicionar um template numa ação, o GHL **cria uma CÓPIA LOCAL pra aquele passo**. Checkbox **"Sync Edits to Template"**:
  - **OFF (padrão):** "Edits stay local to the workflow step and do not change the original template."
  - **ON:** mudanças no passo e no template original se atualizam mutuamente (**bidirecional**).
  - Alternável depois, com modal de confirmação.
  → Resolve o dilema "template compartilhado vs mensagem específica do passo" **sem forçar a escolha na criação**.
- **Dois furos que o próprio GHL admite:** não existe **lock** de edição (qualquer membro altera) e não existe **preview antes de propagar** update global. São os 2 pontos que quebram com time.
- **Preview e Test Send** `[BO]`: SMS tem campo **Test Phone Number**; Email tem **Test Emails** (o teste NÃO valida entrega de CC/BCC); Email Builder tem preview Desktop/Mobile. **WhatsApp com template de mídia: o preview mostra a URL da mídia, não a mídia renderizada.**
- Inconsistência do GHL (não copiar): duas bibliotecas com semânticas diferentes — Email Templates (referência com sync) vs SMS Snippets (insert de texto puro).

## 2. Mídia

### WhatsApp — ação dedicada, com upload (o que nos interessa)

Ação **"WhatsApp: Media"** (lançada 08/05/2025): escolhe tipo → **upload do arquivo** → caption opcional → salva. `[BO]` — [doc](https://help.gohighlevel.com/support/solutions/articles/155000005235-how-to-send-whatsapp-media-images-videos-audio-document-via-workflow)

**Limites (confirmados em 2 fontes independentes, valores idênticos)** `[BO]`:

| Tipo | Formatos | Limite |
|---|---|---|
| Imagem | JPEG, PNG | **5 MB** |
| Vídeo | MP4, 3GP (H.264+AAC) | **16 MB** |
| Áudio | AAC, AMR, MP3, M4A, OGG | **16 MB** |
| Documento | TXT, PDF, DOC/X, PPT/X, XLS/X | **100 MB** |

- **Caption** suportada pra imagem, vídeo e documento; **NÃO pra áudio** (limitação da API da Meta) — casa com a regra do Kommo (passo de voz é exclusivo).
- Retenção: outbound 30 dias, inbound 7 dias.

### ⚠️ Janela de 24h — a restrição crítica

*"Media messages can only be sent while the 24-hour Customer Service Window is open."* Fora da janela **falha**, a menos que se reenvie template aprovado pra reabrir. `[BO]`

Existe ação **"WhatsApp: Customer Service Window Check"** pra **ramificar o workflow conforme a janela esteja aberta**. `[BO]` → **primitiva essencial, copiar direto.**

**Free Entry Point** (Click-to-WhatsApp Ads): free-form ou template por **até 72h** sem custo adicional. `[BO]`

**Templates aprovados pela Meta:** Header aceita Image (JPEG/PNG 5MB), Video (MP4 16MB), Document (**PDF apenas**, 100MB), Location. No workflow o template referencia **URL pública** sobrescrevível; mismatch de formato bloqueia o submit. Nota: documento em template aprovado é **PDF-only**, enquanto free-form aceita TXT/DOC/PPT/XLS — **duas superfícies, dois conjuntos de regras.** `[BO]`

### Outros canais
- **SMS/MMS:** sem anexo direto — só **URL** no corpo (via Custom Value). JPEG/PNG/GIF, limites de carrier 0.6–1.5MB, recomendação **<500 KB**. `[BO]`
- **Email:** upload ou Media Library, até **20 MB**; acima disso vira **link clicável automaticamente** (degradação graciosa — bom padrão). `[BO]`
- **Media Library:** imagens 100MB, vídeos 4GB, áudio/docs 100MB. `[BO]`

## 3. Múltiplos fluxos por serviço

- **100+ triggers em 14 categorias.** Relevantes: Form Submitted, **Contact Tag**, Contact Created, **Customer Replied**, Trigger Link Clicked, Appointment Status, **Pipeline Stage Changed**, Opportunity Created, Inbound Webhook, Click To WhatsApp Ads. `[BO]`
- **Múltiplos triggers por workflow:** confirmado. Semântica OR é `[INF]` (a doc nunca usa "OR").
- **Go-To Connections for Triggers** (Advanced): escolher *"a unique 'first action' for every trigger"* — **roteamento por serviço dentro de um único workflow**. Restrição: cada trigger conecta a exatamente uma ação. `[BO]`
- **⭐ Add to Workflow — o padrão que resolve** `[BO]`: *"automatically enrolls the contact into the next workflow at the point where the workflow begins — **no additional trigger is required**."* O workflow-destino **não precisa de trigger próprio** → viabiliza **hub-and-spoke limpo**. "Pass Input Trigger Parameters" passa só o dado do trigger original.
- **Remove from Workflow:** 4 escopos (Current / Another / All Except Current / All). **Sem undo.** `[BO]`
- **If/Else:** N branches; branch **None** criada automaticamente e **não removível**; toggle **Dynamic Value** (comparar contra outputs de steps anteriores). **Split** = percentual até 5 caminhos, **sticky** (reentrando vai pelo mesmo) — é A/B test, NÃO roteamento por serviço. **Goal Event:** move direto ao goal quando o evento acontece; **limite duro de 1 por workflow**. `[BO]`

**4 arquiteturas viáveis** `[INF]` (o GHL não publica guia canônico): (1) **Router único + Add to Workflow** — 1 workflow roteador com If/Else lendo tag de serviço, cada branch termina em `Add to Workflow → sequência do serviço X`. **Melhor pra manutenção.** (2) Multi-trigger + Go-To. (3) Tag por serviço com N workflows. (4) Pipeline/Opportunity por serviço.

**Re-entrada** `[BO]` — [Workflow Settings](https://help.gohighlevel.com/support/solutions/articles/48001239875-workflow-settings-overview): **Allow Re-entry** (default mudou pra **ON**) · **Allow Multiple Opportunities** (contato com N oportunidades entra como N instâncias — **crítico em multi-serviço**) · **Stop on Response** · **Time Window** (ação fora da janela **pausa e retoma** no próximo slot) · Timezone.

**Organização:** pastas aninhadas, bulk actions, **Template Library** (Create Workflow → Select from Template, com busca/categoria/popularidade), **Snapshots** (incluem workflows/templates/pipelines/custom fields; **não** incluem contatos/conversas/histórico; WhatsApp Templates exigem **re-aprovação Meta** no import).

## 4. ⭐ AI Workflow Builder — a resposta principal

Lançado 04/10/2025 em Labs, **saiu do Labs e virou enabled by default**. Gratuito com fair usage. `[BO]`

**O que a IA gera:** *"converts natural-language prompts into end-to-end workflows"* — numa passada: **trigger correto, ações, wait steps, condições, branching e o TEXTO PRONTO de emails e SMS**. `[BO]` — [doc oficial](https://help.gohighlevel.com/support/solutions/articles/155000006100-workflow-ai-builder)

- **Aceita prompt em QUALQUER IDIOMA** (inclui PT-BR). `[BO]`
- Performance: **<30s em média**; prompts simples ~15s. `[BO]`
- **4 pontos de entrada:** Labs · botão "Build using AI" na lista · prompt box no builder (com ditado por voz) · chat sidebar dedicada. Na landing, prompt no topo: *"What do you want to automate?"* + quick-starts.

**⭐ Clarifying Agent — a IA PERGUNTA quando é ambíguo** `[BO]`, verbatim: *"Workflow AI Builder asks **up to three** clarifying questions before continuing."* Usuário escolhe opção pré-definida ou digita custom. E: *"**Skip any question** if you want the AI to decide for you."* Dispara quando falta trigger, canal ou timing.

**⭐ Nasce NÃO publicado.** Toda a doc orbita "antes de publicar": *"complete any required fields before you publish"* · *"**Manual review required:** Verify triggers, actions, and configurations before publishing"* · *"Always test before publishing"* · *"**AI cannot test workflows. Perform manual tests.**"* · *"AI can make mistakes"*. (Nuance honesta: a doc nunca diz literalmente "estado Draft" — é `[INF]` forte.)

**⭐ Post-Generation To-Do List — o mecanismo que vale copiar** `[BO]`: após gerar, painel lista o que falta — *"Complete these steps before executing your workflow"*. **Cada item é clicável e NAVEGA DIRETO pra ação relacionada.** Cobre o que a IA não resolve: credenciais, campos obrigatórios, custom values inexistentes, seleção de form/calendário.
Complementar: painel de erros separando **Integration Issues** de **Missing Mandatory Fields**, com botão **"Resolve through AI"**. **Erros NÃO bloqueiam a publicação.**

**Editabilidade pós-geração — 3 modos** `[BO]`:
1. **Conversacional** — adicionar/remover/substituir/reordenar ações e triggers, settings do workflow.
2. **Point and Edit** — *"click to select one, click multiple, or hold Shift and drag to select a range"* → descreve a mudança no chat → **a IA aplica SÓ nos passos selecionados**.
3. **Targeted Edits** — nomear a ação a alterar; a IA muda exatamente aquilo, resto intacto; lote numa instrução.

Extras v3/v4: streaming em tempo real com progress card · batch · contexto de sessão · **a IA pergunta se é pra construir do zero ou editar o existente** · persistência de sessão · white-label safe.

**Falhas reais reportadas** (teste hands-on independente com 4 workflows) `[SD]` — [Automated Marketer](https://automatedmarketer.net/how-to-use-the-gohighlevel-workflow-ai-builder-build-automations-with-plain-english/): não seleciona **qual** form/calendário usar · não cria custom values (só insere placeholder) · **timing relativo errado** (delay fixo em vez de "relative to appointment") · condição ampla demais · nem sempre põe na pasta certa. Conclusão: output é **draft-stage**, exige config antes de publicar — consistente com a doc oficial.

**Formato interno: NÃO documentado.** A API pública de workflows é **read-only** (só `Get Workflow`); não existe endpoint de criar/atualizar/publicar. Feature request aberto desde 26/03/2024 sem resposta. `[BO]`
> **O que isso significa pra nós:** vamos desenhar o schema do zero, sem referência. **Vantagem:** definir o formato interno como **contrato explícito da IA desde o dia 1** — algo que o GHL nunca fez e por isso não consegue expor.

**O contrato destilado (espelhar):**
```
NL (qualquer idioma, texto ou voz)
  → Clarifying Agent (≤3 perguntas, TODAS puláveis; skip = IA decide)
  → geração streaming com progress card (<30s)
  → workflow NÃO publicado
  → To-Do List pós-geração (itens CLICÁVEIS que navegam ao nó)
  → revisão humana (conversacional | point-and-edit | targeted)
  → teste manual explícito
  → toggle Publish (SEMPRE ação humana)
```
Os 3 detalhes fáceis de omitir e que fazem funcionar: **perguntas puláveis** (senão vira fricção) · **to-do navegável, não texto** (item que não leva ao nó é decoração) · **publish sempre humano** (é o contrato inteiro do produto).

## 5. Manual × automático

- **Adicionar em massa:** Smart Lists → filtros → **"Trigger automation"** → modes **Send All at Once / Scheduled / Drip** (lotes). `[BO]`
- **Adicionar individual pela ficha: NÃO VERIFICADO** em doc (a API tem `POST /contacts/:id/workflow/:id`). **Remover em massa NÃO existe** (feature request aberto). → **assimetria a não copiar.**
- **Observabilidade** `[BO]`: **Enrollment History** (status por contato) + **Execution Logs** (action name, status, executed on, view details; filtro máx 30 dias). **2 features de debug a copiar:** **Highlight Contact Path** (pinta no canvas o caminho que o contato percorreu, com nós de erro e pulados) e **Go To Action** (botão que navega às settings da ação). *Log que não te leva de volta ao nó é log morto.* Ressalva: logs são superfície de **observação, não de intervenção** (não dá pra remover/parar/re-executar de lá).
- **Pausar:** workflow inteiro só **por janela de datas** (Global Settings; até 15 faixas; opção Annually). Durante a pausa *"contacts will still enter but will pause at the trigger or subsequent actions"* — enfileiram e retomam. **Não existe toggle Pause/Resume por workflow individual** (só Publish/Draft). **Pausar para UM contato NÃO existe nativamente** `[INF]` — equivalentes: remover (destrutivo), DND, ou Wait/If-Else que segura.
- **Manual Actions — fila de tarefas humanas** `[BO]`: ações **Manual SMS** e **Manual Call** geram tarefa. Fila em `Conversations → Manual Actions`, statuses **Yet to Call / Completed / Skipped**, botão "Let's Start", Complete/Skip/Re-queue. **Filtros gravados na URL** (dá pra compartilhar a fila filtrada). **Assign To em cascata de 4 níveis** até cair em Unassigned.

### Human takeover — 4 mecanismos, não intercambiáveis
1. **Stop on Response (setting)** — encerra o workflow pro contato que respondeu. **Remove, não pausa.** Escopo: só o workflow de origem, sem controle por canal. *Armadilha documentada:* com "Disable Voicemail Detect" ON, caixa postal conta como resposta e mata o workflow. `[BO]`
2. **Trigger "Customer Replied"** — filtros: Contains Phrase, Exact Match, Has/Doesn't Have Tag, **Intent Type** (NLP: resposta positiva, reclamação, pergunta), Replied to Workflow, Reply Channel. Padrão: Customer Replied → Remove from Workflow: **All Workflows** → notifica humano. **É o único jeito de takeover cross-workflow.** `[BO]`
3. **DND por canal** — outbound tem toggle **individual por canal** (Email, SMS, Calls, WhatsApp…); inbound é **tudo-ou-nada**. Auditoria mostra "DND Enabled by Workflows/User/Contact". `[BO]`
4. **Conversation AI (o melhor takeover do GHL)** `[BO]`: estados **Active / Inactive / Sleep-Snooze** por contato, controlados por **ícone no message composer** com "reactive bot after X". Auto-sleep em: opt-out, limite de msgs, **mensagem manual de humano**, mensagem de workflow, handoff. **⭐ Split de controle a copiar:** o setting foi separado em **dois controles independentes** — "sleep on **Manual** Message" vs "sleep on **Workflow** Message". **Modo Suggestive:** a IA redige e **o humano revisa e envia** (human-in-the-loop nativo). Modos Off/Suggestive/Autopilot. **Human Handover Action:** mensagem de encerramento + pausa com retomada configurável + atribui conversa + cria task com due 24h.

### 🐛 Bug conhecido do GHL — exatamente o cenário de takeover
Contato parado em **"Wait for Customer Reply"** de SMS + humano manda SMS manual = o sistema **perde a atribuição**: *"The workflow system does not have a way to associate the customer's reply with a specific SMS when multiple SMS messages are involved"* e *"the contact will remain at the wait step, even if they have replied."* `[BO]`
> **Não copiar. Resolver atribuição de resposta por message-id desde o começo.**

## 6. Variáveis e fallback

- **Sintaxe:** `{{contact.first_name}}`, **case-sensitive** (`{{Contact.Name}}` não funciona). Categorias: Standard Fields, Custom Fields, **Custom Values**, Custom Objects, Trigger Links, Payment Links. `[BO]`
- **Custom Value ≠ Custom Field:** Custom Field é **por registro** (varia por contato); **Custom Value é por sub-conta** (mesmo valor pra todos — nome da empresa, link de agendamento, disclaimer). Chave gerada do nome: `{{custom_values.my_custom_value}}`. Pastas não aninháveis. Ação "Update Custom Value" **atualiza, não cria**, sem undo. `[BO]`
- **Math e data NÃO são inline** — não existe `{{campo + 7d}}`. São ações separadas (Math Operation, Date/Time Formatter, Update Contact Field) que gravam variável dinâmica. `[BO]`
- **⚠️ FALLBACK — a lacuna mais cara do GHL pro nosso caso.** Resposta oficial da HighLevel (13/05/2026): sintaxe **`{{default contact.firstname "there"}}`**, **liberada SÓ PARA EMAIL**. Não existe default global por campo (é por instância; tags com default aparecem em **verde**, sem default em **cinza**). **Para SMS e WhatsApp NÃO há fallback nativo confirmado** — só If/Else setando valor antes de enviar. `[BO]`
  > Descartar o que blogs de 2026 afirmam (`{{contact.first_name || "there"}}`) — **nenhuma fonte oficial suporta**.
  > **Nossa operação é WhatsApp-first → resolver fallback no motor de template desde o dia 1, em TODOS os canais.**

## 7. UX do builder

**Layout:** fluxo **linear vertical** sobre canvas infinito pannável/zoomável, com **posicionamento automático**. De cima pra baixo: bloco de **Triggers** → linha vertical → cards de ação empilhados → botão **+** em cada segmento. `[BO]`

**Chrome:** *sup. esq.* nome editável inline · toggle **Stats View** (métricas sobrepostas nos nós) · dropdown Standard↔Advanced. *sup. dir.* **Save** (com **ponto vermelho** se há mudança não salva) · **Test Workflow** · **History** · toggle **Draft/Publish**. *Abas:* Builder · Settings · Enrollment History · Execution Logs. *Canvas:* Fit to Screen + Zoom (inf. esq.), **Minimap** (inf. dir.). `[BO]`

**⭐ Adicionar/configurar ação (detalhe mais importante a espelhar):** botão **"+"** entre passos abre um **modal centralizado de busca** (não drawer lateral): busca unificada · **3 abas Tools / Apps / Discover** · filtros de categoria · badges (preço, rating, installs, "Native"/"Beta"). Ao escolher, *"inline configuration loads without breaking flow"* — **o MESMO modal troca de conteúdo**: passo 1 = catálogo, passo 2 = formulário da ação. `[BO/SD]`

**Manipulação:** hover revela **drag handle de 6 pontos** + indicador **"Move here"**; branches de If/Else também arrastáveis. Advanced adiciona right-click, seleção em massa, **enable/disable de nó**, **"Tidy Up"** (auto-layout), sticky notes, comentários inline. `[BO]`

**⭐ Save ≠ Publish ≠ Version (3 conceitos, precisa estar no schema desde o começo)** `[BO]`:
- **Autosave contínuo** ("most canvas edits are auto saved… for quick retrieval in-session")
- **Save explícito** com indicador de não-salvo
- **Draft/Publish** — em Draft *"the workflow will not trigger and take actions for real"*
- **Save Version explícito** — *"autosaves rotineiros NÃO criam versão"*

**Versionamento:** sidebar cronológica v12/v13/v14 com nome, timestamp, **nome do editor**, status; filter by editor; retenção **10 versões OU 30 dias**; **Restore reabre como novo draft** (o publicado fica intacto); "Create new workflow from version" bifurca. Pré-requisitos duros: **Draft e ZERO contatos enrolados**. `[BO]`
> **⚠️ Insight de arquitetura mais importante:** *"Restoring a workflow does not roll back or undo actions already performed on contacts."* **Rollback é da DEFINIÇÃO, nunca dos EFEITOS.** Deixar explícito na UI.

**Undo/Redo** separado: Ctrl+Z/Y, painel "Recent Changes" clicável, escopo **só a sessão atual e só as suas edições**, reseta no refresh.

**Lição da migração Campaigns → Workflows** `[BO]`: o modelo antigo separava **Campaigns** (sequências) de **Triggers** standalone. Morreu porque Workflows *"combine triggers and campaigns into one system"*. `[INF]` fortemente ancorado: **separar "o que dispara" de "o que acontece" em duas telas parece limpo no papel e é ruim na prática** — o usuário perde o modelo mental da jornada e não consegue debugar. **Unificar trigger + ações numa tela só desde o dia 1.**

## 7 decisões que caem direto desta pesquisa

1. **Começar linear vertical**, nós auto-posicionados, **sem coordenadas XY no banco**. Economiza schema de posição, algoritmo de layout e serviço de arestas.
2. **⭐ Enrollment carrega SNAPSHOT IMUTÁVEL da definição.** Contatos in-flight não migram de rota quando você republica. **Precisa estar no schema desde o começo — retrofitar depois é reescrita.**
3. **Copy-on-add + toggle de sync bidirecional** para templates — mas **um único modelo de template para todos os canais** (a divisão do GHL entre email-com-sync e snippet-texto é inconsistência, não design).
4. **Media Library como fonte única**; o passo referencia um asset. Não repetir "URL no SMS, upload no WhatsApp".
5. **Fallback de variável em TODOS os canais**, não só email. É a lacuna mais cara do GHL pro nosso caso WhatsApp-first.
6. **Save ≠ Publish ≠ Version**, três conceitos separados. **Rollback restaura definição, nunca efeitos** — explícito na UI.
7. **Contrato do AI Builder:** NL (PT-BR) → ≤3 perguntas puláveis → geração streaming → **nunca publicado** → to-do list com itens que **navegam ao nó** → revisão humana em 3 modos → **publish sempre humano**. Como definimos o formato interno (coisa que o GHL nunca expôs, nem via API), tratar esse schema como **contrato explícito da IA desde o dia 1**.

## LACUNAS (exigem teste ao vivo antes de virar decisão)

1. **Escopo do Update Custom Value** — location-wide vs contact-specific. A doc devolveu "contact-specific", o que **contradiz** a natureza do custom value. `[INF]` que seja location-wide → usar em workflow multi-contato é **footgun clássico** (contato B recebe valor escrito pelo A). **Item mais arriscado da lista.**
2. **Comportamento do workflow com DND ligado** — pula a ação, trava, ou avança descartando? Determinante pra qualquer fluxo com opt-out.
3. **O que acontece se uma Manual Action nunca for concluída** — se o contato trava indefinidamente, é vazamento silencioso de pipeline.
4. **Sintaxe exata de custom field em merge field** — nenhum artigo oficial publica o token.
5. **Adicionar/remover contato individual pela UI** — só a API está documentada.
6. **Semântica AND/OR dos filtros de trigger** — o artigo "AND/OR Filters" retornou **404**.
7. **Múltiplos triggers = OR** — inferido, nenhuma doc usa a palavra.
8. **Renderização espacial das branches If/Else** e convergência pós-branch — doc silenciosa. No Standard **não existe merge explícito** (reconvergência via Go To) `[INF]`.
9. Labels de Delete/Duplicate de passo no Standard.
10. Painel de config: modal centralizado ou drawer lateral — evidência pende pra modal, não conclusivo.
11. **Interação Add to Workflow × Allow Re-entry** — ignora ou falha silenciosamente?
12. Anexo na ação WhatsApp simples (parece exigir a ação dedicada "WhatsApp: Media").
13. **Fallback em SMS/WhatsApp** — release oficial é email-only, sem roadmap indicado.
14. **Screenshots reais** — todas as descrições visuais vêm do TEXTO das docs, não de análise de imagem.
15. **Formato interno do workflow** — não documentado; API read-only. Sem referência externa pro schema.
