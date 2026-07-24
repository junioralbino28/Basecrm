# Pesquisa de mercado — Personalização visual por cliente (branding/white-label) em CRMs comerciais

> Parte da documentação-mãe. Índice em [README.md](./README.md). Alimenta a
> decisão "Branding por cliente" em [decisoes.md](./decisoes.md) e a lacuna 11
> de [ativacao-cliente.md](./ativacao-cliente.md). Pesquisa executada por
> subagente com protocolo de profundidade (fontes primárias lidas + cross-
> reference + confidence tiers honestos).

**Data:** 2026-07-24 · **Método:** leitura de fontes primárias (docs oficiais, pricing pages, fóruns oficiais, GitHub) + cross-reference com fontes secundárias independentes · **Escopo:** GoHighLevel, Kommo, Pipedrive, HubSpot, Zoho CRM, RD Station, Bitrix24, Monday, Twenty (OSS), EspoCRM (OSS)

---

## Resumo em uma frase

O mercado é bipolar: **ou o CRM é uma plataforma de revenda de agência com white-label total (GoHighLevel, Bitrix24 self-hosted, EspoCRM+extensão), ou não entrega quase nada de branding da UI (Pipedrive, HubSpot, Kommo, RD Station, Twenty)** — e ninguém resolve bem cor arbitrária + contraste + dark mode de forma automática.

---

## Tabela comparativa

| CRM | Cor da UI | Logo na UI | Domínio próprio | Quem configura | Plano/preço | Confidence |
|---|---|---|---|---|---|---|
| **GoHighLevel** | Sim — primária + secundária + texto, aplicadas em toda a UI; custom CSS livre | Sim (dashboard + login, ~350×180 PNG) | Sim (CNAME `whitelabel.ludicrous.cloud`, SSL auto) | Agência (Agency Settings → White Label) | White-label UI: US$297/mês (Unlimited); SaaS Mode: US$497/mês (Agency Pro); app mobile branded: add-on ~US$497/mês | **High** |
| **Kommo** | Não (dark theme é preferência do usuário) | Não | Não | — (parceiro revende, não rebranda) | White-label inexistente em qualquer plano | **High** (ausência verificada) |
| **Pipedrive** | Não | Não na UI; só remove logo Pipedrive de Smart Docs e web forms | Não | Admin (só para docs/forms) | Remoção de branding em docs em planos pagos | **Medium-High** |
| **HubSpot** | Não na UI do CRM; brand kit (primária/secundária/accent) vale só para conteúdo gerado (quotes, scheduling, portal) | Não na UI; logo em conteúdo/e-mails sim | Não para o app (só para conteúdo hospedado) | Admin (Settings → Branding) | Brand kit em todos os planos; brands extras = add-on | **High** |
| **Zoho CRM** | Parcial — cor de tema é escolha PESSOAL de cada usuário; admin NÃO força org-wide | Sim — 3 logos (application, page, favicon) com domínio mapeado | Sim (custom domain mapping) | Admin (domínio/logos); usuário (cor) | Domain mapping: Enterprise/Ultimate (+ portais em Zoho One/CRM Plus) | **High** |
| **RD Station CRM** | Não | Não | Não | — | White-label do software inexistente; parceria = comissão + materiais de marketing "white label" | **Medium** (ausência) |
| **Bitrix24** | Parcial — admin define tema de fundo para todos; sem cor de marca arbitrária na cloud | Sim — logo PNG 444×110 no topo + remover "24" do nome | Cloud: não de verdade; Self-hosted: sim, white-label completo | Admin | Cloud: recurso ausente nos planos baixos (pago, a partir de ~US$49/mês); On-premise: total | **Medium-High** |
| **Monday** | Não (temas light/dark/night são pessoais) | Sim — logo 40×40 no canto + logo no header de e-mails | Só slug `empresa.monday.com` | Admin (Admin → Customization → Branding) | Gating de plano não verificado | **Medium** |
| **Twenty (OSS)** | Não | Não | Não (nem hostname custom resolvido no self-host) | — | White-label: não implementado, "não é prioridade" (mantenedores, fev/2026) | **High** |
| **EspoCRM (OSS)** | Nativo: tema + CSS básico; com extensão Ebla Theme: paleta completa (navbar, tabs, brand colors, HEXA c/ alpha) | Sim — nativo (Administration → User Interface); Ebla: logos light/dark separados + logo de login + favicon 2 tamanhos | Sim (self-hosted, domínio é seu) | Admin/integrador | Core grátis (open source); extensão de tema paga (preço não publicado na doc) | **High** |

---

## Seção por CRM

### GoHighLevel — a referência absoluta
White-label é o produto. A agência configura em Settings → Company → White Label: logo (dashboard + tela de login), cor primária (botões/acentos), cor secundária (fundos/menu), cores de texto, headline e imagem de fundo do login, e domínio próprio via CNAME apontando para `whitelabel.ludicrous.cloud` (SSL via Let's Encrypt automático). Há ainda um "API Domain" separado para brandear links gerados pelo sistema (forms, surveys, calendários) em e-mail/SMS — a doc oficial recomenda os dois para "experiência 100% brandeada". Escape hatch: campo de Custom CSS no nível agência para estilizar o que a UI nativa não cobre (login page etc.). Escada de preço: US$97 Starter → US$297 Unlimited (desktop app white-label, domínio, look & feel) → US$497 Agency Pro (SaaS Mode: tiers de preço próprios, rebilling com markup, provisionamento automático de sub-contas) → app mobile com a marca da agência como add-on (~US$497/mês, incluso no Enterprise). O cliente final não configura nada — recebe pronto. [Behavior observed — páginas oficiais lidas]
Fontes: gohighlevel.com/white-label-crm · gohighlevel.com/pricing · help.gohighlevel.com art. 48000982207 · bardeen.ai · shortnsweetdigital.com · ghlexperts.com · ecosire.com

### Kommo — parceria sem white-label
O programa de parceiros (doc oficial lida) dá 35–50% de comissão e exige explicitamente que o parceiro "deixe claro que é uma entidade separada" — o oposto de white-label. Nenhuma menção a rebranding de UI, logo ou domínio em nenhuma doc. O que existe: dark theme (preferência do usuário, via CSS variables) e uma exigência curiosa na doc de developers — logos de integrações precisam de **contraste ≥3.0 sobre os dois fundos oficiais** (#FFFFFF light, #153043 dark) para serem aceitos. Ou seja: a Kommo trata contraste por gate de revisão manual, não por algoritmo. [Behavior observed]
Fontes: support.kommo.com/docs/what-is-the-kommo-partner-program · developers.kommo.com/docs/dark-theme · developers.kommo.com/docs/getting-listed

### Pipedrive — zero branding de UI (achado por ausência)
Não existe logo nem cor do cliente na interface. O que a doc de suporte oferece: (a) remover o logo Pipedrive de Smart Docs compartilhados publicamente (admin, plano pago); (b) ligar/desligar branding Pipedrive em web forms; (c) "Interface preferences" — mas isso é layout por usuário (arrastar widgets da sidebar), não cor nem marca, e explicitamente "não compartilhado com a empresa". [Behavior observed via artigos de suporte]
Fontes: support.pipedrive.com (artigos Smart Docs remove logo; interface preferences) · pipedrive.com/blog/interface-preferences

### HubSpot — brand kit para conteúdo, nunca para o app
O brand kit (doc oficial lida) guarda logos, até 20 favicons, cores (primária, secundária, accent e adicionais) e fontes — mas aplica isso em **conteúdo gerado**: editor de conteúdo, scheduling pages, quotes, canais de conversa. A doc oficial avisa que "brand colors won't appear in sales templates and emails" e nada muda a UI do CRM em si. Thread da comunidade confirma: o Customer Portal puxa o branding global e "HubSpot atualmente não suporta customização de branding por domínio" — quem quer portal white-label recorre a apps de terceiros (ex.: WoodsPortal). Disponível em todos os planos; múltiplos brand kits = add-on "Brands". [Behavior observed]
Fontes: knowledge.hubspot.com/settings/customize-branding-for-your-hubspot-content · community.hubspot.com (thread Customising the Customer Portal) · insidea.com (menciona variantes de logo p/ dark mode — Low, não confirmado na doc oficial)

### Zoho CRM — o meio-termo mais interessante (e sua falha)
Dois mundos separados: (1) **Custom domain mapping** (anúncio oficial lido) — Enterprise/Ultimate podem servir o CRM em `sales.suaempresa.com`, com upload de 3 logos (application logo, page logo, favicon); até 3 domínios por ambiente (CRM/Sandbox/Portals), só 1 ativo; desde jan/2024 vale também para usuários de portal em Zoho One/CRM Plus. (2) **Cor de tema** — é configuração **pessoal por usuário** (Personal Settings); admin não consegue impor cor organizacional, e há pedidos abertos na comunidade justamente por isso. Para ISVs existe um terceiro caminho: Zoho CRM platform / Vertical Solutions, onde o desenvolvedor rebranda o produto inteiro e revende. [Behavior observed]
Fontes: help.zoho.com (community topic custom domain mapping, lido) · help.zoho.com community "Manage color themes for all users" · glionconsulting.com · help.zoho.com KB vertical solutions "Brand your solution"

### RD Station CRM — nada de white-label do software (achado por ausência)
Nenhuma doc ou página oficial encontrada oferecendo logo/cor/domínio do cliente na UI do CRM. O programa RD Station Partners é comissão por revenda + acesso gratuito às ferramentas + "materiais white label" — que são **apresentações e conteúdos educativos** para a agência aplicar a marca dela, não o software. Relevante para o Basecrm: o player BR dominante não compete nesse eixo. [Survey declared + ausência em busca dirigida; não achei doc oficial negando explicitamente — Medium]
Fontes: resultadosdigitais.com.br/agencias/programa-de-parceria-para-agencias · canalizeprm.com.br/blog/rd-station-partners-guia · hubify.com.br

### Bitrix24 — logo barato na cloud, white-label real só on-premise
Cloud (helpdesk oficial lido): admin troca o nome "Bitrix24" do topo pelo nome da empresa, remove o "24" via toggle, e sobe logo PNG transparente até 444×110 — recurso "pode não estar disponível em todos os planos" (fontes secundárias: pago, a partir de ~US$49/mês). Admin também pode fixar tema de fundo para todos os usuários (artigo "Set account theme for all users"). Cor de marca arbitrária na UI: não. White-label completo (código, layout, domínio) existe na edição **self-hosted/on-premise**, que é a base do programa de parceiros (até 50% de comissão + 100% dos serviços). [Behavior observed no helpdesk; plano exato não verificado]
Fontes: helpdesk.bitrix24.com/open/18981580 (lido) · helpdesk.bitrix24.com/open/18991892 · bitrix24.com/self-hosted · techrepublic.com · fitsmallbusiness.com

### Monday — logo sim, cor não
Admin → Customization → Branding: troca o logo do canto superior esquerdo (recomendado PNG 40×40 transparente) e o logo do header dos e-mails de notificação. Temas de cor (light/dark/night) são preferência pessoal; não há cor de marca na UI. Gating de plano do branding: **não verificado** (o artigo de suporte oficial retornou 403; lido só via snippets). [Survey declared/parcial]
Fontes: support.monday.com art. 115005321529 (via snippets) · support.monday.com "All things Admin"

### Twenty (open source) — white-label pedido desde 2023, não entregue
Discussion #1671 no GitHub (lida na íntegra): usuários pedem hostname custom e white-label desde 2023, alguns oferecendo pagar. O fundador (Félix Malfait) chegou a esboçar um design (entidade de domínio ligada ao workspace), mas em respostas posteriores declarou que white-label "não é prioridade"; em fev/2026 reafirmaram foco em "extensibility + stability first". Self-hosters relatam ficar presos a `ip:porta`. Visão de longo prazo declarada: configs (layout, objetos, apps) anexáveis por domínio — mas nada implementado. [Behavior observed — thread primária lida]
Fonte: github.com/twentyhq/twenty/discussions/1671

### EspoCRM (open source) — o mais completo do lado OSS, via extensão
Nativo: Administration → User Interface permite trocar logo da empresa, tema e ajustes de menu; favicon e rebranding profundo exigem mexer em código (threads do fórum oficial confirmam). O salto vem da extensão paga **Ebla Theme** (doc oficial da extensão lida): logos **separados para tema claro e escuro**, logo específico do login com fallback, favicon em 2 tamanhos, paleta completa (navbar, tabs, primary/success/danger/warning/info, textos, bordas, botões, painéis) com HEXA 8 dígitos (alpha), login page split com painel de marca + imagem + overlay + texto WYSIWYG com placeholders `{applicationName}`, border radius configurável e custom CSS inclusive para portais. É o único do lote que resolve logo em dark mode como feature explícita. [Behavior observed]
Fontes: docs.eblasoft.com.tr/espocrm-extensions/ebla-theme (lido) · forum.espocrm.com (threads favicon, company logo, branding) · docs/tips espocrm.com

---

## Padrões de UX / técnica observados no mercado

**Onde a cor do cliente aparece (quando aparece):**
- GHL: par **primária (botões/acentos) + secundária (fundos/menu)** + cores de texto separadas — nunca uma cor só. A tela de login é o ponto de branding mais valorizado (logo + headline + imagem de fundo), porque é a primeira coisa que o cliente da agência vê. [Behavior observed]
- HubSpot: slots nomeados (primary/secondary/accent) mas só em superfícies "de saída" (quote, agendamento, portal) — a lógica é "brandear o que o cliente DO cliente vê", não o operador. [Behavior observed]
- EspoCRM/Ebla: paleta semântica completa (primary + estados success/danger/warning/info) — o modelo mais próximo de um design system real. [Behavior observed]

**Contraste / cor arbitrária:**
- Ninguém do lote resolve contraste automaticamente a partir de uma cor arbitrária. As estratégias reais encontradas: (a) **Kommo**: gate manual — logo de integração só é aceito com contraste ≥3.0 nos dois fundos oficiais; (b) **GHL**: empurra a responsabilidade para a agência, pedindo cores de texto explícitas além das cores de marca, + custom CSS como válvula de escape; (c) **HubSpot**: restringe onde a cor entra, limitando o estrago. Auto-derivação de paleta acessível a partir de 1 cor: **não verificado em nenhum** dos 10. [Behavior observed + Inferred]

**Logo em modo escuro:**
- Padrão emergente: **dois assets de logo** (claro/escuro) — explícito na extensão Ebla (EspoCRM) e citado como variante opcional no brand kit HubSpot (fonte secundária, Low). O paliativo universal dos demais: exigir **PNG com fundo transparente** (Bitrix24 444×110, Monday 40×40, GHL 350×180) e torcer para funcionar nos dois temas. [Behavior observed]

**Quem configura:**
- Unânime: **admin/agência configura marca; usuário final nunca**. O que sobra para o usuário é preferência de tema claro/escuro (Kommo, Monday, Twenty) — e o Zoho comete o anti-padrão de deixar até a COR como escolha pessoal, sem enforcement org-wide, gerando pedidos de recurso na comunidade. Separação limpa observada: *identidade = org/admin; conforto (light/dark) = usuário*. [Behavior observed]

**Domínio:**
- Padrão técnico dominante: CNAME para um alvo fixo do vendor + SSL automático (GHL/Let's Encrypt; Zoho similar). Domínio é sempre o recurso mais premium da escada (GHL $297+, Zoho Enterprise+, Bitrix24 só self-hosted).

**Escada de monetização do branding (padrão de mercado):**
1. Nome/slug grátis → 2. logo em plano pago médio → 3. cores + login + domínio em plano alto → 4. SaaS mode/revenda no topo. O branding é sistematicamente usado como **alavanca de upgrade**, não como commodity.

---

## Lacunas do mercado (= oportunidade de diferenciação)

1. **Cor única → paleta acessível automática.** Nenhum player gera automaticamente estados hover/pressed, cor de texto sobre a cor da marca e variantes light/dark a partir de UMA cor com contraste garantido (WCAG/APCA). Todos exigem múltiplos campos manuais ou CSS. Uma implementação "a agência escolhe 1 cor e o sistema deriva o resto com contraste garantido" não existe em nenhum dos 10. [Inferred a partir das docs lidas — High na ausência]
2. **Dark mode de marca de primeira classe.** Só uma extensão paga de um CRM open source (Ebla/EspoCRM) trata logo claro/escuro como feature nomeada. Marca coerente nos dois temas, sem asset duplo obrigatório, é campo aberto.
3. **O vazio do meio.** Entre "US$297–497/mês na GHL" e "nada" (Pipedrive/HubSpot/Kommo/RD), não há oferta de branding por tenant simples e barato. Para uma agência pequena BR, entregar casca personalizada por cliente sem custo GHL é diferenciação direta — inclusive porque **o player BR dominante (RD Station) não tem white-label do software**.
4. **Enforcement organizacional de tema.** Zoho não deixa admin impor cor; Monday/Kommo idem. "A marca do tenant vale para todos os usuários daquele tenant, sempre" já supera players bilionários nesse detalhe.
5. **Ativação instantânea com preview.** O fluxo de mercado é CNAME + formulários + CSS manual + espera de propagação. Preview ao vivo na tela de configuração e aplicação imediata não apareceu como feature em nenhuma doc lida. [Não verificado exaustivamente — Low]

---

## Fontes (o que foi lido de cada)

**Primárias (conteúdo lido na íntegra via fetch):**
- gohighlevel.com/white-label-crm — página oficial white-label (features, planos)
- gohighlevel.com/pricing — planos, SaaS Mode, add-on mobile
- help.gohighlevel.com art. 48000982207 — setup de whitelabel domain (CNAME, SSL, logo, API domain)
- support.kommo.com/docs/what-is-the-kommo-partner-program — programa de parceiros (ausência de white-label)
- helpdesk.bitrix24.com/open/18981580 — trocar nome e logo (specs, permissões, gating)
- help.zoho.com community topic "Rebrand your CRM — custom domain mapping" — domínios, edições, limites
- knowledge.hubspot.com/settings/customize-branding-for-your-hubspot-content — brand kit completo
- github.com/twentyhq/twenty/discussions/1671 — thread inteira de white-label do Twenty
- docs.eblasoft.com.tr/espocrm-extensions/ebla-theme — feature list completa da extensão

**Secundárias/cross-reference (lidas via busca dirigida):**
- support.pipedrive.com (Smart Docs remove logo; interface preferences) · community.hubspot.com (Customer Portal sem branding por domínio) · help.zoho.com community (theme color por usuário; "Manage color themes for all users") · glionconsulting.com (Zoho themes) · support.monday.com art. 115005321529 + "All things Admin" (403 no fetch; lido via snippets — por isso gating Monday ficou não verificado) · helpdesk.bitrix24.com/open/18991892 (tema para todos os usuários) · developers.kommo.com (dark theme CSS vars; regra de contraste 3.0) · resultadosdigitais.com.br + canalizeprm.com.br (RD Partners) · techrepublic.com + fitsmallbusiness.com (Bitrix24 white-label/preço) · bardeen.ai, shortnsweetdigital.com, ghlexperts.com, ecosire.com (detalhes operacionais GHL, convergentes entre si e com as docs oficiais) · forum.espocrm.com (favicon, logo, branding nativo)

**Não verificado / declarado como tal:** gating exato de plano do branding no Monday e no Bitrix24 cloud (helpdesk oficial confirma que existe gating, sem nomear planos); variante dark de logo no brand kit HubSpot (só fonte secundária); preço da extensão Ebla Theme (não publicado na doc).
