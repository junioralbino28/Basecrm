# Pesquisa UX — Telas de Construtores de Automação (CRMs e plataformas de referência)

> Parte da documentação-mãe. Índice em [README.md](./README.md). Motivada pelo
> feedback do Junior no C2C (24/07): "pouco espaço, poluído, muito scroll e
> zoom, corta — vê como os outros CRMs montaram essa tela". Alimenta a proposta
> de reforma do construtor (aguardando aval). Pesquisa por subagente com
> protocolo de profundidade (fontes primárias lidas + cross-reference +
> confidence declarado).

Pesquisa feita em fontes primárias (help centers oficiais) + cross-reference com guias/reviews independentes. Onde a fonte primária não confirmou, está declarado. Tags: `[Behavior observed]` = doc oficial lida descrevendo a UI · `[Survey declared]` = terceiro/review/fórum · `[Inferred]` = inferência.

## Tabela comparativa

| Plataforma | Orientação | Onde edita o passo | Zoom/Fit | Sempre visível | Salvamento | Confidence |
|---|---|---|---|---|---|---|
| ActiveCampaign | Vertical top-down (flowchart) | Modal/painel no lado **direito** | Minimapa + zoom + "Fit to Screen" | Toggle Active/Inactive no topo direito | **Autosave** + histórico de versões ("turn back time") | High (edição/save) · Medium (orientação) |
| GoHighLevel | Padrão: vertical linear · Advanced: canvas freeform | Painel lateral (Triggers & Actions) ou drag no canvas | Canvas com pan; sem minimapa documentado | Nome, Save, Test Workflow, toggle Draft/Publish (topo direito) | **Autosave** com header "Saving… → Auto-saved"; publicar é separado | High |
| HubSpot | Vertical top-down | Painel **esquerdo** | Zoom (atalhos, 100%/50%) + **minimapa opt-in** ("Show minimap panel") | Barra de navegação (File/Edit/View), "Review and publish" no topo direito | Histórico de revisões; autosave não confirmado em doc | High (painel/minimapa) |
| Kommo (Salesbot) | Canvas tipo "mapa" com setas automáticas (orientação exata não verificada) | **Inline no próprio bloco** + menu "…" | "Map tool" (minimapa) na base da tela; botão de voltar ao passo anterior | Numeração dos passos, botão preview do bot | **Save explícito** ("Always remember to save") | High (citações) · Não verificado (orientação) |
| ManyChat | Canvas freeform, cards (leitura horizontal) | Painel lateral ao clicar no card | Zoom + drag + botão **"Auto-Arrange"** | "Set Live" (com validação de erros em vermelho), toggle p/ Basic Builder no topo direito | Draft até "Set Live" (autosave não verificado) | High (auto-arrange, Set Live) · Medium (painel) |
| Klaviyo | Vertical top-down ("moving downwards") | Sidebar de ações à esquerda; config em **settings sidebar** (direita) | Pan com cursor; "bird's eye view" | Nome do flow, status por ação, "Review and Turn On"/"Update Status" topo direito | Status draft/manual/live por ação | High |
| Brevo | Vertical (triggers só na "primeira fileira") | Sidebar: **"settings open in the sidebar"** ao adicionar passo | Canto inferior direito: zoom, **fit automático**, toggle **extended/compact view** | Sidebar Builder/Settings/Activity | **Autosave ao sair** ("last version… automatically saved") | High |
| Zapier | Vertical top-down (lista-diagrama) | **Sidebar direita** com abas Setup/Configure/Test | Menu de zoom topo direito: in/out, "Fit to view", **collapse/expand paths** | Nome do Zap, label Draft/Published, on/off, botão Publish | Draft persistente; publish explícito | High |
| n8n | Canvas freeform (leitura esquerda→direita) | Node abre em janela própria (NDV); nodes panel à direita | Botões: fit, zoom in/out, reset, **"tidy up"** | Nome do workflow, toggle Active | Save manual + histórico (não lido em detalhe) | High (controles) · Medium (NDV/topbar) |
| Make | Canvas freeform (módulos circulares) | Painéis à direita (config do módulo) | **Auto-align** (varinha mágica); zoom por scroll | Controles de run/schedule na base | Save explícito historicamente | Medium |

## Notas por plataforma (com fontes)

### ActiveCampaign
- Adicionar ação: clicar no "+" → "This will open the 'Add an action' modal **on the right side** of the Automation Builder" `[Behavior observed]`.
- Mover/copiar: arrastar ação sobre um "+" de destino → modal pergunta se move ou copia `[Behavior observed]`.
- Deletar If/Else: prompt pergunta o que fazer com as ações órfãs dos caminhos yes/no `[Behavior observed]` — padrão importante de proteção pra leigo.
- Salvamento: "As you work, the automation builder will **automatically save** your work" + rollback de versão `[Behavior observed]`.
- Editar automação ativa: alternar Active→Inactive "on the top right of your screen" antes de mexer `[Behavior observed]`.
- Canvas Enhancements (2023-24): minimapa, controles de zoom e "Fit to Screen" `[Behavior observed via resumo do artigo oficial — página bloqueou leitura integral]`. Release 2024: "New Action modal" + busca de ações melhorada `[Behavior observed]`.
- Reclamações: "slow and clunky interface", sensação de "slow and bloated", curva de aprendizado `[Survey declared]`.
- Fontes: https://help.activecampaign.com/hc/en-us/articles/222921988 · https://help.activecampaign.com/hc/en-us/articles/15215403284508 · https://help.activecampaign.com/hc/en-us/articles/16152574620572 · https://www.emailtooltester.com/en/reviews/activecampaign/

### GoHighLevel
- Dois níveis: builder padrão (sequência linear) e **Advanced Builder**: "a fully visual, freeform canvas… Drag, drop, and connect multiple trigger paths, parallel branches" `[Behavior observed]`.
- Config: "Open the Triggers & Actions panel… Configure from the panel **or** drag items directly onto the canvas" `[Behavior observed]`.
- Conectores com semântica visual: sólido = sequência; **tracejado com seta** = "Trigger Go-To" `[Behavior observed]`.
- Topo direito: Save, "Test Workflow", toggle **Draft/Publish** `[Behavior observed + Survey declared, 2 fontes]`.
- Auto Save (doc dedicada): "continuously saves your workflow canvas edits in the background… status header shows 'Saving…' → 'Auto-saved'… you still control when updates go live by clicking Publish" `[Behavior observed]`.
- Templates = "Recipes" pré-montadas `[Behavior observed + Survey]`.
- Reclamações: "settings scattered everywhere", passos confusos pra tarefas simples; relatos de workflows disparando errado `[Survey declared]`.
- Fontes: https://help.gohighlevel.com/support/solutions/articles/155000006635 · https://help.gohighlevel.com/support/solutions/articles/155000006654 · https://www.chillreptile.com/gohighlevel-workflows/ · https://marketingautomationinsider.com/gohighlevel/

### HubSpot
- Vertical top-down; adicionar via "+", e "In the **left panel**, select an action" `[Behavior observed]`.
- Minimapa opt-in: "click **Show minimap panel**" (canto superior esquerdo) — "a quicker view of your workflow architecture and faster navigation"; hover mostra nome da ação, clique navega `[Behavior observed]`.
- Barra de navegação estilo app desktop (File/Edit/View/Settings/Help) com Undo/Redo, Zoom (atalhos, 100%/50%), Comments, Test, Metrics `[Behavior observed]`.
- "Review and publish" fixo no canto superior direito — publicar passa por uma revisão guiada `[Behavior observed]`.
- Histórico de mudanças do workflow (quem/quando/o quê) `[Behavior observed via listagem KB]`. Autosave do editor: **não verificado** em doc.
- Aids: templates, action sets reutilizáveis, Breeze Assistant (IA) `[Behavior observed via KB]`.
- Fontes: https://knowledge.hubspot.com/workflows/create-workflows · https://knowledge.hubspot.com/workflows/use-the-new-workflow-navigation-bar · https://knowledge.hubspot.com/workflows/choose-your-workflow-actions

### Kommo (Salesbot)
- Builder visual com passos numerados conectados por setas automáticas; edição **inline no bloco** ("Click on the text field to edit the content") `[Behavior observed]`.
- Navegação: "use the **map tool at the bottom of the screen** to easily navigate between steps"; se dois passos ficam longe, vira botão clicável `[Behavior observed]` — ou seja, a própria Kommo reconhece o problema de distância no canvas.
- Preview em formato de telefone mostrando mensagens/botões antes de lançar `[Behavior observed]`.
- Branches: condições múltiplas + caminhos "Another answer"/"No answer" `[Behavior observed]`.
- Save **explícito**: "Always remember to save your Salesbot settings" `[Behavior observed]`.
- Templates com fluxo pré-montado `[Behavior observed]`. Orientação exata do canvas: **não verificado**.
- Fontes: https://support.kommo.com/docs/create-a-salesbot-in-kommo · https://support.kommo.com/docs/salesbot-overview

### ManyChat
- Canvas livre com cards; "you can simply zoom in or drag elements around… Or, simply hit the **'Auto-Arrange' button** to automatically arrange your Flow in an easy-to-see layout" `[Behavior observed — blog oficial]`.
- **View Mode** somente-leitura com estatísticas por passo: "drag and zoom to explore your Flow, **without having to worry about making any accidental edits**" `[Behavior observed]`.
- Publicação: botão **"Set Live"**; se há erro, "the system will automatically highlight any issues… and display a red notification explaining what must be fixed" `[Behavior observed via help center]`.
- Dois níveis de editor: Flow Builder (canvas) e **Basic Builder** (lista linear) com toggle no canto superior direito `[Behavior observed]` — o "modo simples pra leigo" é literalmente um produto separado.
- Preview da mensagem no card + função "Preview"/teste `[Behavior observed + Survey]`. AI Flow Builder assistant `[Behavior observed via help center]`.
- Fontes: https://help.manychat.com/hc/en-us/articles/14281166306332 · https://manychat.com/blog/manychat-flow-builder-messenger-marketing/ · https://www.tutkit.com/en/text-tutorials/6977-creating-a-flow-in-manychat-step-by-step-guide

### Klaviyo
- Vertical: "People move through flow steps sequentially, starting at the trigger and **moving downwards**" `[Behavior observed]`.
- Dupla lateral: sidebar de ações (arrastar ou clicar) + "Once an action is added to the canvas, you can configure it in the **settings sidebar**" `[Behavior observed]`.
- Drop zones guiadas: "Every 'droppable' location… will highlight with a blue outline… a light grey drop zone will appear" `[Behavior observed]` — affordance explícita pra leigo.
- Alternativa ao drag: "+" em cada nó abre menu com as mesmas ações `[Behavior observed]`.
- Novo builder (2023+): pan com cursor, "bird's eye view", preview do template de email **sem sair do builder**, dados do flow na sidebar ao selecionar mensagem `[Survey declared — teardown Enchant]`.
- Status por ação (draft/manual/live) + "Review and Turn On"/"Update Status" no topo direito; analytics nos cards com "Show Analytics" `[Behavior observed]`. Flows AI pra gerar flow por prompt `[Behavior observed via help center]`.
- Fontes: https://help.klaviyo.com/hc/en-us/articles/115002774932 · https://www.enchantagency.com/blog/klaviyo-new-flow-builder · https://help.klaviyo.com/hc/en-us/articles/26604555031963

### Brevo
- Sidebar esquerda com 3 seções: **Builder** (passos pra arrastar, com busca), **Settings** (entrada/saída/re-entrada), **Activity** (logs) `[Behavior observed]`.
- "When a step is added to the canvas, **its settings open in the sidebar**" `[Behavior observed]`.
- Controles no canto inferior direito: zoom in/out, "**Automatically fit** the canvas to your automation" e "**Toggle between extended and compact view**" `[Behavior observed]` — o modo compacto é resposta direta a "canvas poluído".
- Vertical: "Triggers can only be placed in the **first row** of the automation" `[Behavior observed]`.
- Autosave: "Before you leave the page, the last version of your automation will be **automatically saved**" `[Behavior observed]`.
- Drop zones roxas ao arrastar; alternativa de clicar e escolher a posição `[Behavior observed]`. Pré-built automations `[Behavior observed]`.
- Fonte: https://help.brevo.com/hc/en-us/articles/15445936637330

### Zapier
- Diagrama vertical, tudo num único eixo: "go through each step in the order shown in the editor, **from top to bottom**" `[Behavior observed]`.
- Seleção de passo abre **sidebar direita** com abas **Setup / Configure / Test** (teste embutido no próprio painel de edição) `[Behavior observed]`.
- Zoom no topo direito: in/out, "**Fit to view**: adjusts your view to surround the entire Zap" e **collapse/expand paths** `[Behavior observed]` — colapsar ramos é a resposta deles pra fluxos longos.
- Sempre visível: nome do Zap, label **Draft/Published**, toggle on/off, botão Edit/Publish, Share `[Behavior observed]`.
- Copilot (IA) + templates `[Behavior observed]`.
- Fonte: https://help.zapier.com/hc/en-us/articles/16722578092429

### n8n
- Canvas freeform em grade pontilhada com pan/zoom/multi-select; botões de **fit to screen, zoom in/out, reset e "tidy up"** (auto-arrumar) `[Behavior observed via docs oficiais indexadas]`.
- Nodes panel à **direita** (abre via "+" no topo direito, "+" ao lado de um node, ou tecla N) `[Behavior observed]`.
- Configuração do node abre em janela dedicada (input → parâmetros → output) `[Inferred — seção da doc não lida integralmente]`.
- É ferramenta de dev — referência de canvas, não de simplicidade pra leigo.
- Fontes: https://docs.n8n.io/courses/level-one/chapter-1/ · https://deepwiki.com/n8n-io/n8n-docs/2.2-editor-ui

### Make
- Canvas freeform com módulos circulares e rotas; **Router** cria bifurcações; painéis de configuração à direita `[Survey declared, 2 fontes]`.
- **Auto-align** ("varinha mágica") arruma o layout, mas "works well for simple layouts but is **less useful for complex branching**" `[Survey declared]`.
- Novo editor (2025-26) + **subscenarios**: quebrar automações gigantes em partes reutilizáveis, "instead of building giant scenario maps" `[Survey declared — guia sobre release oficial]`.
- Fontes: https://help.make.com/step-2-add-a-router · https://consultevo.com/make-com-new-editor-subscenarios-guide/ · https://community.make.com/t/scenario-ux-font-size/19314

## PADRÕES DOMINANTES (o que 70%+ fazem igual)

1. **Vertical top-down é o padrão de CRM/marketing.** ActiveCampaign, HubSpot, Klaviyo, Brevo, Zapier e o builder padrão do GHL fluem de cima pra baixo. Canvas horizontal/freeform só aparece em bot builders (ManyChat, Kommo) e ferramentas de dev (n8n, Make, GHL Advanced) — e mesmo essas precisam de muleta (Auto-Arrange, tidy up, auto-align, subscenarios) pra conter a bagunça.
2. **Edição em painel lateral, nunca em dock inferior.** Das 10 plataformas, zero usa painel fixo embaixo. Direita: Zapier, Klaviyo, AC, Make, n8n (nodes panel). Esquerda: HubSpot, Brevo. Inline no bloco: Kommo. O painel lateral convive com fluxo vertical sem roubar altura de tela.
3. **Adicionar via "+" entre passos com menu buscável**, com drag-and-drop como caminho alternativo (nunca único). Drop zones destacadas ao arrastar (Klaviyo azul, Brevo roxo).
4. **Zoom + fit-to-screen são obrigatórios; minimapa é opt-in.** AC, HubSpot e Kommo têm minimapa; Brevo/Zapier/n8n têm fit; HubSpot só mostra minimapa se o usuário pedir.
5. **Autosave contínuo + publicação explícita separada.** GHL ("Saving… → Auto-saved" + Publish), AC (autosave + rollback), Brevo (autosave ao sair), Zapier (draft persistente + Publish). Salvar nunca é ativar.
6. **Status Rascunho/Ativo sempre visível no topo direito**, junto com o botão de publicar/testar (GHL, Zapier, Klaviyo, AC, HubSpot).
7. **Templates/receitas como porta de entrada** (GHL Recipes, Kommo templates, Brevo pre-built, Zapier templates, HubSpot templates) e, mais recente, assistentes de IA (Zapier Copilot, Klaviyo Flows AI, HubSpot Breeze, ManyChat AI).
8. **Conteúdo visível no card**: preview de mensagem/e-mail dentro ou a um clique do nó (Klaviyo, ManyChat, Kommo phone-preview), e analytics por passo no próprio canvas (Klaviyo, ManyChat View Mode, GHL).

## ARMADILHAS relatadas por usuários

- **Canvas freeform vira espaguete**: em Make, "scenarios becoming larger and more complex, making the text on filters and other elements very small and difficult to read" `[Survey declared — community.make.com]`; auto-align falha justamente nos casos complexos. A própria Make lançou subscenarios pra atacar isso.
- **Zoom como fonte de atrito**: mudança do comportamento do scroll (zoom → pan) gerou thread de reclamação na comunidade Make `[Survey declared]`. Lição: zoom deve ser raro, não parte do fluxo básico — por isso todo mundo tem fit/compact/collapse.
- **Interface lenta/pesada**: ActiveCampaign — "slow and clunky", "slow and bloated at times" `[Survey declared — reviews]`.
- **Configuração espalhada**: GoHighLevel — "settings scattered everywhere", tarefas simples exigem vários passos confusos `[Survey declared — reviews 2026]`.
- **Medo de editar o que está no ar**: AC exige pausar antes de editar (senão contato pula passo); ManyChat criou View Mode só-leitura pra evitar "accidental edits" `[Behavior observed]`. Usuário leigo precisa de fronteira clara entre "olhar" e "mexer".
- **Distância entre passos**: Kommo admite na doc que passos distantes quebram as setas e viram botões, e oferece minimapa como remendo `[Behavior observed]`.

## SÍNTESE PRO BASECRM (recomendações baseadas só no observado)

Contexto: hoje o Basecrm tem mapa **horizontal** com zoom/pan + **dock de edição fixo embaixo**. Feedback do dono: "pouco espaço, poluído, muito scroll e zoom, corta". As duas escolhas atuais são exatamente as que nenhuma referência de CRM usa.

1. **Girar o canvas pra vertical top-down.** 6 das 10 referências (todas as de CRM/marketing pra usuário leigo) usam top-down; horizontal só sobrevive em ferramenta de dev com auto-arrange. Vertical lê como lista de tarefas e scrolla como página — natural pra secretária. *(Ref.: Klaviyo "moving downwards", Zapier "top to bottom", Brevo "first row", HubSpot, AC.)*
2. **Matar o dock inferior; edição em painel lateral direito** (na faixa de ⅓ da tela, deslizando sobre o canvas). Zero referências usam painel embaixo — painel inferior rouba altura, que é o eixo do fluxo vertical, e causa o "corta". *(Ref.: Zapier Setup/Configure/Test, Klaviyo settings sidebar, Brevo "settings open in the sidebar", AC modal à direita.)*
3. **Fit-to-screen automático ao abrir + botão de fit + zoom agrupado num canto** (inferior direito, como Brevo). Zoom deixa de ser obrigatório pro uso básico. *(Ref.: Brevo "automatically fit", Zapier "Fit to view", AC "Fit to Screen", n8n.)*
4. **Modo compacto e/ou colapsar ramos** pra fluxos longos — ataca direto "muito scroll" e "poluído". *(Ref.: Brevo "extended/compact view", Zapier "collapse/expand paths", Make subscenarios como versão estrutural.)*
5. **Adicionar passo pelo "+" entre nós, abrindo menu buscável de ações** — drag-and-drop vira opcional, não requisito. Com drop zones destacadas se mantiver drag. *(Ref.: AC "+", HubSpot "+ → left panel", Klaviyo "+" com mesmo menu da sidebar, Zapier.)*
6. **Barra superior fixa: nome + status Rascunho/Ativo + Testar + Publicar; autosave contínuo com indicador "Salvando…/Salvo".** Salvar ≠ publicar — a secretária nunca deve "quebrar" a automação ativa por acidente ao editar. *(Ref.: GHL Auto-save + Draft/Publish, Zapier Draft/Published label, AC toggle Active/Inactive + autosave com rollback.)*
7. **Ramos sim/não com rótulos nas arestas e proteção ao deletar**: se apagar uma condição com passos pendurados, perguntar o que fazer com eles em vez de descartar. *(Ref.: AC prompt de delete do If/Else; GHL conectores com semântica visual distinta.)*
8. **Preview da mensagem dentro do card + templates prontos como porta de entrada** (2-3 receitas do vertical do cliente: confirmação de agenda, follow-up, aniversário). O card mostrando o começo do texto reduz a necessidade de abrir o painel só pra "conferir". *(Ref.: Kommo preview de telefone, Klaviyo preview sem sair do builder, ManyChat cards, GHL Recipes.)*
9. **Minimapa: só se/quando o fluxo passar de ~10-15 passos, e opt-in** — com os itens 1-4 aplicados, a maioria dos fluxos de clínica não precisa dele. *(Ref.: HubSpot "Show minimap panel" opt-in; Kommo usa minimapa como remendo de um canvas que se espalha.)*

Lacunas declaradas (não verificado): orientação exata do canvas Kommo; autosave do editor de workflows HubSpot; detalhes do NDV do n8n; comportamento de save do novo editor Make. Nenhuma dessas lacunas afeta as recomendações acima.

**Fontes principais:** [ActiveCampaign builder](https://help.activecampaign.com/hc/en-us/articles/222921988-How-to-use-ActiveCampaign-s-automation-builder) · [AC Canvas Enhancements](https://help.activecampaign.com/hc/en-us/articles/15215403284508-Automation-Canvas-Enhancements) · [AC release 2024](https://help.activecampaign.com/hc/en-us/articles/16152574620572-A-new-simpler-automation-builder) · [GHL Advanced Builder](https://help.gohighlevel.com/support/solutions/articles/155000006635-advanced-builder-for-workflows) · [GHL Auto Save](https://help.gohighlevel.com/support/solutions/articles/155000006654-workflows-auto-save) · [HubSpot Create workflows](https://knowledge.hubspot.com/workflows/create-workflows) · [HubSpot navigation bar](https://knowledge.hubspot.com/workflows/use-the-new-workflow-navigation-bar) · [Kommo Create a Salesbot](https://support.kommo.com/docs/create-a-salesbot-in-kommo) · [Kommo Salesbot overview](https://support.kommo.com/docs/salesbot-overview) · [ManyChat build automation](https://help.manychat.com/hc/en-us/articles/14281166306332-How-to-build-a-Manychat-automation) · [ManyChat Flow Builder blog](https://manychat.com/blog/manychat-flow-builder-messenger-marketing/) · [Klaviyo Getting started with flows](https://help.klaviyo.com/hc/en-us/articles/115002774932) · [Enchant — Klaviyo new flow builder](https://www.enchantagency.com/blog/klaviyo-new-flow-builder) · [Brevo new automation editor](https://help.brevo.com/hc/en-us/articles/15445936637330-Overview-of-the-new-automation-editor) · [Zapier editor](https://help.zapier.com/hc/en-us/articles/16722578092429-Use-the-editor-to-build-and-view-your-Zap-workflows) · [n8n editor UI](https://docs.n8n.io/courses/level-one/chapter-1/) · [Make router](https://help.make.com/step-2-add-a-router) · [Make community — font size UX](https://community.make.com/t/scenario-ux-font-size/19314) · [Make community — zoom UX](https://community.make.com/t/ux-question-zoom-using-mouse-wheel/108550) · [GHL review 2026](https://marketingautomationinsider.com/gohighlevel/) · [emailtooltester — AC review](https://www.emailtooltester.com/en/reviews/activecampaign/) · [chillreptile — GHL workflows](https://www.chillreptile.com/gohighlevel-workflows/)
