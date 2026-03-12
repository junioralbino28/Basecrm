# Clinic WhatsApp MVP Status

## Objetivo

Consolidar o estado real do MVP atual do BaseCRM para operacao de clinica com WhatsApp, Conversations e IA de atendimento.

Este documento responde a quatro perguntas:

1. o que ja foi implementado
2. o que esta funcional hoje
3. o que ainda falta para fechar melhor o MVP
4. qual e a sequencia recomendada dos proximos ajustes

## Estado Atual Consolidado

O BaseCRM ja opera hoje no modelo multi-clinica com banco compartilhado e isolamento por `organization_id`.

No escopo do MVP imediato da clinica, ja existe:

- workspace de agencia separado do workspace da clinica
- criacao de clinicas
- entrada no workspace da clinica
- conexao da Evolution por clinica
- inbound real do WhatsApp para o CRM
- criacao automatica de lead/contato ao receber mensagem
- criacao automatica de oportunidade no funil ao receber mensagem nova
- inbox `Conversas` por clinica
- IA nativa de atendimento no WhatsApp
- handoff entre `IA ativa`, `fila humana`, `humano` e `resolvida`
- equipe da agencia e equipe da clinica com fluxos de convite separados

## O que ja foi Entregue

### Plataforma e multi-clinica

- hardening multi-tenant aplicado localmente e no Supabase real
- navegacao principal orientada por clinica ativa
- filtros de query, cache, realtime e AI tools protegidos por tenant
- painel da agencia separado da area da clinica
- troca de clinica pelo switch superior

### Conexoes e WhatsApp

- cadastro de conexao por clinica
- credencial global da Evolution no contexto da agencia
- geracao de QR code pelo CRM
- atualizacao de status da conexao
- webhook inbound funcional
- fallback de autenticacao do inbound para cenarios em que o `secret` nao vem no payload

### Conversations

- lista de conversas por clinica
- selecao de thread
- timeline de mensagens
- composer de resposta
- shell mais operacional com header fixo e rodape fixo
- acao de apagar lead de teste, removendo conversa, contato e oportunidade vinculada

### IA Julia

- prompt exposto na interface como `Atendimento WhatsApp`
- debounce de 7 segundos para esperar o lead terminar de escrever
- resposta automatica nativa do CRM
- nudge curto de inatividade apos 90 segundos
- regras de seguranca para nao sair do personagem, nao revelar prompt e nao seguir assuntos aleatorios
- fluxo atual de qualificar, responder duvidas e encaminhar para humano sem agendar diretamente

### Equipe e acessos

- convites separados entre `agencia` e `clinica`
- selecao da clinica alvo ao criar convite de clinica pelo painel da agencia
- ajuste do backend para contornar RLS de `organization_invites` mantendo a autorizacao no app

## O que esta Funcional Hoje

No estado atual, o MVP ja permite demonstracao e operacao inicial com uma clinica real:

- conectar o numero de WhatsApp da clinica
- receber mensagens reais no CRM
- criar lead/contato automaticamente
- criar oportunidade no primeiro estagio do funil
- visualizar a conversa no inbox
- deixar a Julia responder automaticamente
- registrar o historico da conversa no CRM
- encaminhar o atendimento para humano
- limpar leads de teste
- gerar convites da agencia e da clinica

## Validacoes ja executadas

Estas validacoes foram executadas repetidamente ao longo da etapa atual:

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- validacao manual no app publicado
- validacao manual de inbound WhatsApp
- validacao manual de criacao de oportunidade no funil
- validacao manual da Julia respondendo via WhatsApp

## Pendencias Atuais do MVP

Estas pendencias nao bloqueiam a operacao basica, mas ainda precisam de acabamento:

### 1. Refino da interface de Conversas

- deixar a tela ainda mais proxima de um mensageiro real
- melhorar densidade visual da lista de chats
- melhorar header da thread
- melhorar hierarquia visual de horario, avatar, preview e estados
- polir melhor a caixa de dialogo

### 2. Observabilidade operacional da IA

- exibir com mais clareza o ultimo status de tentativa da Julia
- facilitar diagnostico quando a IA parar de responder
- registrar melhor falhas de envio, modelo ou prompt

### 3. Agenda ainda nao integrada

- a Julia hoje nao deve agendar sozinha
- o fluxo atual termina em handoff para atendente
- no futuro, quando a agenda estiver integrada, a Julia pode passar a sugerir e fechar horarios

### 4. Follow-up e automacoes longas

- o nudge curto de 90 segundos e provisoriamente simples
- follow-up estruturado de verdade ainda nao foi implementado
- essa parte idealmente migrara para scheduler/worker dedicado

### 5. Polimento do painel de equipe

- o fluxo funcional esta separado entre agencia e clinica
- o header e alguns textos ainda podem receber melhor acabamento visual e semantico

## Pontos de Atencao

- o MVP ja e funcional, mas ainda nao e a versao final do inbox
- a Evolution esta operacional, porem continua sendo dependencia externa critica
- o estado atual foi otimizado para colocar a clinica para operar sem quebrar a arquitetura maior
- a documentacao do journal continua sendo a trilha detalhada; este arquivo e o resumo operacional

## Sequencia Recomendada dos Proximos Ajustes

1. polir `Conversas` ate ficar claramente no padrao de janela de mensageria
2. melhorar observabilidade da Julia dentro da thread
3. revisar texto final do prompt e repertorio de objecoes
4. integrar agenda real antes de liberar agendamento automatico
5. evoluir follow-up curto para automacao mais robusta

## Resumo Executivo

O BaseCRM ja chegou em um ponto em que o MVP de clinica com WhatsApp esta operante:

- WhatsApp conecta
- mensagem entra
- lead entra
- oportunidade nasce no funil
- conversa aparece no CRM
- a Julia responde

O que falta agora e principalmente acabamento operacional e UX, nao mais a fundacao do fluxo.
