# Aurora CENNO — PLAN

Branch: `feat/aurora-implantacao`  
Worktree: `Basecrm-worktrees/aurora-implantacao`  
Regra: TDD, sem produção; push e deploy permitidos somente para o preview isolado.

## Fase 1 — fundação e handoff

- [x] Criar contrato tipado para os tipos de handoff.
- [x] Tratar metadata persistida como entrada hostil.
- [x] Preservar o último handoff estruturado na thread.
- [x] Criar notificação persistente usando `system_notifications` existente.
- [x] Tornar a notificação idempotente pelo ID da mensagem que acionou o evento.
- [x] Permitir nome e prompt do agente por conexão com fallback compatível para Julia.
- [x] Criar prompt da Aurora sem contaminar o prompt da clínica existente.
- [x] Migrar o structured output usado neste fluxo para AI SDK v6.
- [x] Limitar a saída do modelo e validar com Zod.
- [x] Passar o evento completo do webhook nativo até o CRM.
- [x] Manter a rota externa compatível com handoff tipado e idempotency key.
- [x] Fazer `aiEnabled=false` bloquear tanto o webhook nativo quanto a rota externa e o executor central.
- [x] Rodar testes focados, regressão de conversas, typecheck e lint.
- [x] Revisão independente do diff e correção dos achados confirmados.
- [ ] Configurar tenant/conexão da CENNO em ambiente não produtivo.

## Fase 2 — agendamento autônomo com fallback humano

- [x] Ler timezone por organização, com fallback explícito `America/Sao_Paulo`.
- [x] Definir contrato de disponibilidade por conexão, desativado por padrão.
- [x] Fixar duração prevista em 40 min e inícios separados por 60 min.
- [x] Calcular slots livres a partir das janelas semanais e atividades existentes.
- [x] Permitir oferta e confirmação automática somente para slot livre validado.
- [x] Persistir atividade `MEETING` somente depois da confirmação/reserva; pedido pendente permanece em handoff.
- [x] Preservar preferência ambígua no handoff sem inventar data/hora.
- [x] Criar estado e ação humana de confirmação/ajuste do horário.
- [x] Exibir pedido no chat/CRM móvel com ação confirmar, ajustar ou ligar.
- [x] Bloquear confirmação inventada e conflito sequencial a menos de 60 min no mesmo responsável.
- [x] Garantir concorrência simultânea da reserva automática com advisory lock transacional.
- [x] Usar a mesma reserva atômica na confirmação/alteração humana.
- [x] Criar tela no número do WhatsApp para ativar agenda, dias, faixa, fuso, antecedência e horizonte.
- [x] Exigir e permitir selecionar o responsável específico pela agenda.
- [x] Cobrir isolamento A↔B de threads e atividades no Supabase local.
- [x] Fixar o expediente padrão de segunda a sexta, 09:00–19:00, com horizonte máximo de 14 dias.
- [x] Priorizar o horário livre mais próximo: mesmo dia, dia seguinte e só então datas posteriores.
- [x] Impedir confirmação automática aos sábados e criar handoff para confirmação humana.
- [x] Permitir múltiplas faixas diferentes em cada dia útil.
- [x] Criar painel de bloqueios para almoço recorrente, ocupado pontual e folga de dia inteiro.
- [x] Subtrair bloqueios manuais e reuniões existentes da disponibilidade oferecida pela Aurora.
- [x] Isolar bloqueios por organização, conexão e responsável com RLS e validação no banco.
- [x] Revalidar bloqueios manuais dentro da transação de reserva e serializar alterações pelo mesmo lock.

## Fase 3 — móvel e observabilidade

- [x] Polling de 15 segundos dos alertas com o CRM aberto ou em segundo plano.
- [x] Notificação do navegador somente para alerta alto novo, sem tocar o estoque antigo.
- [x] Deep link até a thread.
- [ ] Push em segundo plano com opt-in e revogação.
- [ ] Métricas: tempo até handoff, aceitou ligação, reunião solicitada e conversão.
- [x] Alertas de falha de envio e geração, com fila humana e pausa das automações.
- [ ] Telemetria externa para falhas de persistência do próprio alerta operacional.

## Portões antes de ativar

- teste no Supabase local;
- revisão RLS e IDOR A↔B;
- [x] rate limit distribuído do webhook/IA verificado no Supabase local;
- prompt adversarial do agente;
- simulação com envio falso;
- autorização explícita para qualquer mensagem real, aplicação de migration ou deploy.
