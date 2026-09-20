# Aurora CENNO — SPEC

Data: 2026-09-19  
Status: implantação iniciada em ambiente isolado  
Canal inicial: WhatsApp via Evolution, sem dependência de n8n

## Objetivo

Atender imediatamente os leads da campanha da Cenoura Hub, conduzir uma qualificação curta e colocar Junior no atendimento quando o lead aceitar ligação, pedir reunião ou solicitar uma pessoa.

O agente deve usar a mesma camada de conversas do CRM. O provedor de WhatsApp é um adaptador e não pode definir a lógica comercial, permitindo substituir Evolution por outro conector depois.

## Comportamento comercial aprovado

- Nome da SDR: **Aurora**.
- Tom curto, humano e nativo de WhatsApp.
- Uma pergunta por vez.
- Diagnosticar a passagem entre anúncio, WhatsApp e comercial.
- Não mencionar R$ 1.000 ou outro mínimo na primeira abordagem.
- Adaptar o escopo ao problema: tráfego, site ou solução completa.
- Não inventar preço, resultado, case, prazo ou agenda.
- Se o lead aceitar ligação, pedir humano ou concluir um agendamento, interromper a automação e gerar handoff.
- Quando a agenda estiver configurada, oferecer somente horários livres validados e concluir o agendamento sem confirmação humana adicional.
- Reuniões duram 40 minutos e os horários de início ficam separados por 60 minutos.
- O expediente padrão é de segunda a sexta, das 09:00 às 19:00, editável por dia e por faixa.
- A Aurora oferece primeiro o mesmo dia, depois o dia seguinte, e só avança quando necessário, até 14 dias.
- Sábado nunca é confirmado automaticamente: a preferência vira handoff para confirmação humana.
- Almoço recorrente, período ocupado e folga pontual podem ser bloqueados no painel do próprio número.

## Handoff no CRM

Cada handoff deve registrar:

- tipo: `call_accepted`, `meeting_requested`, `meeting_confirmed`, `human_requested`, `high_intent` ou `other`;
- resumo factual;
- motivo;
- data/hora;
- ID interno idempotente do evento;
- estado da agenda: pendente, confirmado ou ajustado;
- contato;
- status `human_queue` na conversa;
- nota interna e notificação persistente no CRM.

A notificação deve ser idempotente por evento para não duplicar em reprocessamentos do webhook.

## Fases

### Fase 1 — fundação e handoff

- prompt específico da Aurora por conexão;
- saída estruturada do agente;
- fila humana, resumo e notificação no CRM;
- nenhum envio ou banco real em teste.

### Fase 2 — agendamento autônomo com fallback humano

- coletar preferência de dia/horário;
- usar a agenda interna `activities` como fonte de ocupação da CENNO;
- oferecer apenas slots calculados a partir da agenda configurada;
- reservar o horário atomicamente antes de responder que está agendado;
- permitir que Junior confirme ou ajuste pelo celular quando a agenda estiver desligada ou indisponível.

Estado atual: o contrato de agenda é configurado no próprio número do WhatsApp e fica desativado por padrão. A tela exige um responsável e define fuso, antecedência, horizonte e até quatro faixas por dia útil. O mesmo painel administra almoço semanal, ocupado em data específica e folga de dia inteiro. Quando habilitado, a Aurora pode oferecer e confirmar somente slots livres daquela agenda; reuniões e bloqueios são descontados antes da oferta, e a reserva no Supabase serializa concorrência por organização e responsável. Confirmações humanas e automáticas usam a mesma função atômica, que revalida reuniões e bloqueios manuais dentro da transação. Sem configuração, sem disponibilidade ou aos sábados, ela registra a preferência e aciona o fallback humano.

### Fase 3 — experiência móvel

- chat responsivo/PWA como primeira superfície;
- alerta em tempo real enquanto o CRM estiver aberto;
- push em segundo plano quando houver infraestrutura e consentimento;
- deep link para a conversa correta.

## Critério de sucesso da Fase 1

1. Uma conexão pode declarar `aiAgentName=Aurora` e `aiPromptKey=task_conversations_whatsapp_cenno_aurora` sem alterar os outros tenants.
2. A saída do modelo é validada por schema e inclui o tipo de handoff.
3. Um handoff muda a conversa para `human_queue`, pausa automações, preserva o resumo e cria uma notificação no tenant correto.
4. Reprocessar o mesmo evento atualiza a mesma notificação, sem criar outra.
5. Testes, TypeScript e lint passam sem chamar Evolution, IA ou Supabase reais.

## Fora da Fase 1

- ativar a Aurora no número real;
- aplicar configuração no tenant de produção;
- enviar mensagem real;
- trocar Evolution;
- integrar agenda externa (Google Agenda, Microsoft 365 ou outro provedor);
- push com o app fechado;
- deploy/merge em produção ou conexão com o WhatsApp real.
