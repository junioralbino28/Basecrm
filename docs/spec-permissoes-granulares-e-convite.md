# Spec — Permissões granulares + fluxo de convite (Basecrm)

> Origem: pedido do Junior (2026-07-07). Fazer ANTES de criar o usuário da Vitória.
> Contexto: hoje só existem 5 permissões (`lib/auth/permissions.ts`), cobrindo WhatsApp + Conversas + Equipe. Junior quer granular sobre TUDO e fácil de estender.

## Objetivo
1. **Cargo/Função** = campo de **texto livre** no convite (quem cria escreve; qualquer função).
2. **Permissões granulares** mapeadas sobre todas as áreas do app, agrupadas, marcáveis com toggle **antes** de enviar o convite.
3. **Extensível**: adicionar permissão de feature futura = acrescentar 1 item numa lista central (sem migration, sem retrabalho de UI).
4. **Email obrigatório** no convite + **lock** (só cadastra com o email informado — já existe no aceite) + opção link.
5. (Depois / infra nova) enviar o convite por **email** (Resend + domínio + DNS).

## Áreas do app mapeadas (rotas em `app/(protected)/`)
dashboard, visão-geral, contatos, funis (boards/pipeline), negócios (deals/cockpit), inbox/conversas, WhatsApp, atividades, tarefas, lista de ligações, atendimentos, agenda, relatórios (geral/financeiro/profissionais), IA (hub/config), fila de decisões, configurações (geral, produtos, profissionais, financeiro, integrações, equipe, auditoria).

## Taxonomia proposta (~30 chaves, 10 grupos)
Formato: `chave` — rótulo. (os 5 atuais marcados com ✔existente)

**Painel**
- `dashboard.view` — Ver painel/dashboard
- `overview.view` — Ver visão geral

**Contatos / Leads**
- `contacts.view` — Ver contatos e leads
- `contacts.edit` — Criar e editar contatos
- `contacts.delete` — Excluir contatos
- `contacts.import_export` — Importar / exportar

**Funis (Kanban)**
- `funnels.view` — Ver os funis
- `funnels.move` — Mover cards entre etapas
- `funnels.manage` — Criar/editar funis e etapas
- `deals.manage` — Criar/editar negócios (cards)

**Conversas / WhatsApp**
- `conversations.access` ✔ — Abrir inbox/conversas
- `conversations.reply` ✔ — Enviar mensagens / notas
- `whatsapp.access` ✔ — Área do WhatsApp (QR, conexão)
- `whatsapp.manage_connection` ✔ — Configurar conexão (API/instance)

**Atividades / Tarefas / Ligações**
- `activities.view` — Ver atividades
- `activities.manage` — Criar/editar/concluir atividades
- `tasks.view` — Ver tarefas
- `tasks.manage` — Criar/editar tarefas
- `call_list.access` — Lista de ligações

**Atendimentos**
- `atendimentos.view` — Ver atendimentos
- `atendimentos.manage` — Registrar/editar atendimentos

**Agenda**
- `agenda.view` — Ver agenda
- `agenda.manage` — Marcar/editar na agenda

**Relatórios**
- `reports.view` — Relatórios gerais
- `reports.finance` — Relatório financeiro (sensível)
- `reports.professionals` — Relatório por profissional

**IA**
- `ai.use` — Usar a IA (assistente)
- `ai.configure` — Configurar a IA (persona, chave)

**Configurações**
- `settings.general` — Configurações gerais
- `settings.products` — Catálogo de produtos/procedimentos
- `settings.professionals` — Profissionais (dentistas)
- `settings.finance` — Financeiro: comissões, custos, taxas (sensível)
- `settings.integrations` — Integrações
- `settings.audit` — Log de auditoria
- `settings.users.manage` ✔ — Gerenciar equipe

## Arquitetura (extensibilidade — o pedido do Junior)
A base atual JÁ é extensível; só precisa expandir + agrupar:
- `PERMISSION_DEFINITIONS` (array central em `lib/auth/permissions.ts`): adicionar campo `group`. UI renderiza agrupado a partir dele. **Nova permissão no futuro = +1 item no array.**
- `profile_permissions.permission_key` = coluna `text` → **adicionar chave nova NÃO precisa de migration**.
- `ROLE_PERMISSION_DEFAULTS`: definir default de cada chave por cargo base (clinic_admin=tudo; clinic_staff=operacional).
- Convite: guardar as permissões escolhidas no convite (nova coluna `permission_overrides jsonb` em `organization_invites` + campo `cargo text`) e aplicar no aceite (gravar em `profile_permissions`).

## ⚠️ Ponto honesto: DEFINIR ≠ FAZER VALER
Definir a chave + o toggle é fácil. Fazer o toggle **bloquear de verdade** cada tela/botão é o trabalho de verdade (hoje só as 5 atuais são checadas). Proposta de **fases**:
- **Fase 1 (com a feature):** definir TODAS as chaves + UI granular no convite + aplicar no aceite + **enforçar as sensíveis primeiro** (`settings.*`, `settings.finance`, `users.manage`, `atendimentos.*`, `reports.finance`) — o que dá risco se ficar aberto.
- **Fase 2:** enforçar as operacionais (contacts, funnels, activities, tasks, agenda) uma a uma.

## Critério de "pronto" (Fase 1)
No convite: escrevo Cargo/Função (texto livre) + marco por área (agrupado) o que a pessoa pode + informo o email → envio → a pessoa entra pelo link só com aquele email e já entra com exatamente esses acessos → e as áreas **sensíveis** bloqueiam de verdade quem não tem o toggle.

## Pendências de decisão (Junior)
1. Granularidade: por área com **ver / editar / gerenciar** (proposto) serve, ou quer ainda mais fino (por botão)?
2. Fase 1 enforça só as sensíveis primeiro (recomendado) — ok?
3. Email-sending fica pra depois (infra Resend+domínio) — ok subir a feature sem o envio automático por enquanto (convite por link + lock)?
