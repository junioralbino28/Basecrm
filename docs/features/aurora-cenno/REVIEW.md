# Aurora CENNO — REVIEW

Status: **REVISÃO INDEPENDENTE CONCLUÍDA; AINDA NÃO ATIVADO**

## Auto-revisão do lote atual

- Escopo limitado à fundação do agente e handoff no CRM.
- Nenhuma mudança em campanha, provedor real, tenant real ou produção.
- Compatibilidade de identidade preservada para conexões explicitamente ativas; conexões sem `aiEnabled=true` agora falham fechado.
- A Cenoura usa um prompt separado, evitando levar regras comerciais da agência para tenants existentes.
- O alerta reutiliza a infraestrutura multi-tenant existente em vez de criar outra tabela.
- O ID do alerta/atividade inclui organização e thread antes de derivar o UUID, evitando colisão entre tenants quando provedores repetem IDs.
- Horários ambíguos permanecem como texto; somente ISO futuro validado gera atividade.
- O primeiro carregamento não dispara notificações antigas; o polling só alerta itens altos surgidos após a foto inicial.
- O deep link aceita apenas a thread presente na lista autorizada devolvida pela API do tenant.
- A ação de agenda exige `conversations.reply`, valida horário futuro e revalida organização, contato e negócio antes de tocar na atividade.
- O teste local usa usuário real + chave pública; o isolamento A↔B é exercido pela RLS, não por filtro do teste.
- A confirmação automática só sobrevive se o horário ainda estiver na lista de slots livres imediatamente antes da reserva.
- A RPC de reserva é serializada por organização/responsável e não é executável por `anon` ou `authenticated`.
- O mesmo lock agora cobre confirmação humana e alterações de bloqueio; a reserva revalida reuniões e bloqueios dentro da transação.
- `aiEnabled=false` é aplicado na entrada externa e novamente no executor central.
- O gate agora exige também a flag `ai_conversation_auto_reply` e `organization_settings.ai_enabled`, ambos explicitamente ativos, com releitura antes da geração e do envio.
- Prompt fora do catálogo não cai mais no conteúdo da Julia/Dra. Jessica; o fluxo para e chama atendimento humano.
- Pedido de reunião pendente não cria atividade `MEETING`; somente reserva confirmada ocupa a agenda.
- Falhas de geração/envio entram em fila humana e geram alerta alto; falha posterior ao início da execução nativa não aciona fallback duplicado.
- Rate limit distribuído foi aplicado aos dois endpoints públicos e validado no Supabase local.
- Bloqueios são filtrados por organização, conexão e responsável; o banco recusa responsável de outro tenant mesmo via `service_role`.
- Sábado não entra na lista de slots e um pedido explícito é convertido em confirmação humana.
- O painel mantém alvos móveis de 44px, separa expediente regular de exceções e reutiliza o sistema visual existente.

## Critique visual Howl M7

- Score de implementação: **9/10** para este componente isolado.
- Sem AI Purple, gradiente decorativo, glow, partículas ou animação sem função.
- Ações têm hover, foco, pressionado, desabilitado e loading; erros aparecem no próprio card.
- Alvos móveis usam altura mínima de 44px e o layout empilha em telas estreitas.
- Hierarquia: urgência/contexto primeiro, ligação imediata depois, confirmação primária e ajuste secundário.
- Pendente para validação visual real: captura em navegador autenticado nos breakpoints 375px e desktop.

## Itens para o revisor conferir

1. Contrato `handoffType` do modelo até `system_notifications`.
2. Idempotência usando `notificationEventId=insertedMessageId`.
3. Defesa em profundidade dos três gates na rota externa, geração e executor.
4. Isolamento por `organization_id`.
5. Comportamento quando o envio à Evolution falha mas o handoff precisa aparecer.
6. Se o prompt da Aurora está curto o suficiente para a campanha atual.
7. Portões restantes G11, G15, G18, G20 e G24 antes de ativar em produção; G7 foi coberto neste lote.
8. Push fechado e integração com uma agenda externa antes da evolução avançada da agenda.

## Veredito

Código local aprovado nos testes e no baseline automatizado parcial. Ainda não aprovado para ativação: faltam configuração/teste da conexão não produtiva, ensaio adversarial do prompt, simulação ponta a ponta com envio falso e autorização explícita para migration/deploy/WhatsApp real.
