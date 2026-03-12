# Workspace Navigation Spec

## Objetivo

Consolidar a regra de navegacao do BaseCRM para evitar o principal tipo de regressao que ja apareceu no projeto:

- cair em rota global errada
- perder clinica ativa
- misturar menu da agencia com menu da clinica
- abrir modulo sem tenant valido

## Princpio Geral

A navegacao deve sempre responder duas perguntas:

1. o usuario esta na `agencia` ou numa `clinica`?
2. se esta numa clinica, `qual` clinica esta ativa?

Sem essa resposta, o app nao deve tentar abrir modulos operacionais.

## Contextos de Navegacao

### 1. Agencia

Rotas de agencia:

- `/platform`
- `/platform/tenants`
- `/platform/tenants/new`

Comportamento esperado:

- menu e header mostram contexto de plataforma
- nao operam dados tenantizados diretamente
- servem para criar, selecionar e administrar clinicas

### 2. Clinica

Rotas tenant-scoped:

- `/platform/tenants/[tenantId]`
- `/platform/tenants/[tenantId]/dashboard`
- `/platform/tenants/[tenantId]/boards`
- `/platform/tenants/[tenantId]/contacts`
- `/platform/tenants/[tenantId]/activities`
- `/platform/tenants/[tenantId]/reports`
- `/platform/tenants/[tenantId]/settings`
- `/platform/tenants/[tenantId]/whatsapp`
- `/platform/tenants/[tenantId]/conversations`
- `/platform/tenants/[tenantId]/branding`
- `/platform/tenants/[tenantId]/domains`

Comportamento esperado:

- o header mostra a clinica ativa
- o menu lateral deve permanecer orientado a essa clinica
- os links operacionais devem continuar escopados ao mesmo `tenantId`

## Rotas Globais Legadas

Rotas globais ainda presentes:

- `/dashboard`
- `/boards`
- `/contacts`
- `/activities`
- `/reports`
- `/settings`
- `/inbox`

Regra consolidada:

- para usuario da agencia com clinica ativa, essas rotas devem redirecionar ou gerar links tenant-scoped
- para usuario da agencia sem clinica ativa, elas nao devem abrir modulo operacional
- para usuario da clinica, elas podem continuar resolvendo a propria organization do perfil

## Regras de Menu

### Menu principal

Itens base operacionais:

- `Inbox`
- `Visao Geral`
- `Boards`
- `Contatos`
- `Atividades`
- `Relatorios`
- `Configuracoes`

Itens de plataforma para agencia:

- `Platform Admin`
- `Clinicas`
- `Nova Clinica`

Itens tenant-specific adicionais:

- `Conversations`
- `WhatsApp` ou `Conectar WhatsApp`

## Regras de Header

### Agencia

Quando em rotas de plataforma:

- badge ou indicacao de `Modo Plataforma`
- sem simular que esta dentro de uma clinica

### Clinica

Quando em workspace tenant-scoped:

- mostrar nome da clinica ativa
- permitir trocar de clinica apenas para perfis da agencia
- nao usar o nome do usuario como identificacao principal do workspace

## Regra de Troca de Clinica

A troca de clinica:

- muda o tenant ativo da sessao
- muda os links tenant-scoped
- nao deve ser confundida com troca de board

Aprendizado consolidado:

- clinica e board sao dois seletores diferentes
- trocar board nunca pode parecer trocar de clinica

## Regra de Troca de Board

No contexto da clinica:

- o seletor de clinica escolhe a conta ativa
- o seletor de board escolhe apenas o funil daquela clinica

## Comportamentos Obrigatorios

1. Se a agencia tentar abrir modulo operacional sem clinica ativa:
- redirecionar para `/platform/tenants`
- ou bloquear claramente
- nunca deixar spinner eterno

2. Se a URL ja estiver em `/platform/tenants/[tenantId]/...`:
- o shell deve respeitar esse tenant como contexto prioritario

3. Se o usuario da clinica tentar entrar em rotas de agencia:
- redirecionar para o workspace valido

4. Se `WhatsApp` ou `Conversations` estiverem liberados:
- devem aparecer de forma coerente no menu do workspace da clinica

## Principais Regressos Ja Vistos

1. Menu lateral gerando `/boards` em vez de `/platform/tenants/[tenantId]/boards`
2. Header mostrando usuario no lugar da clinica
3. `Clinicas` estatico sem entrada clara no workspace
4. agency admin navegando em rota global sem tenant e travando em loading

## Checklist de Navegacao

Antes de publicar mudanca em layout/shell/menu:

1. abrir `Clinicas`
2. abrir uma clinica
3. navegar por:
- `Visao Geral`
- `Boards`
- `Contatos`
- `Atividades`
- `Settings`
- `WhatsApp`
- `Conversations`
4. trocar de clinica
5. confirmar que:
- o contexto mudou
- o menu continuou tenant-scoped
- o header mostra a clinica correta

