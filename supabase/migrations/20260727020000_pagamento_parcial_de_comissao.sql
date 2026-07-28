-- =============================================================================
-- PAGAMENTO PARCIAL DE COMISSÃO (e o desfazer)
-- =============================================================================
-- Pedido do Junior (2026-07-27): *"seria selecionar o valor que estou pagando, e
-- também desfazer para caso de erro."*
--
-- Hoje só dá pra pagar o total de uma vez: o índice único
-- `uniq_commission_payments_org_prof_period` permite UM pagamento por pessoa por
-- mês. Pagar R$ 300 de R$ 700 e depois o resto quebraria com "chave duplicada".
--
-- O índice existia como trava anti-clique-duplo. Ele sai daqui, e a trava
-- continua onde ela realmente funciona: o botão fica desabilitado enquanto o
-- pagamento está gravando e enquanto o relatório recalcula. Em troca, a tabela
-- vira o que sempre deveria ter sido — o HISTÓRICO de pagamentos do mês, que é
-- justamente o que permite desfazer o último sem apagar os anteriores.
--
-- O relatório NÃO muda: `get_commission_report` já SOMA os pagamentos do período
-- (`sum(cp.amount)`), então dois pagamentos de 300 e 400 valem os mesmos 700.
-- =============================================================================

DROP INDEX IF EXISTS public.uniq_commission_payments_org_prof_period;

-- Buscar "o último pagamento desta pessoa neste mês" é o que o desfazer faz.
CREATE INDEX IF NOT EXISTS idx_commission_payments_prof_period_data
  ON public.commission_payments (organization_id, professional_id, period, paid_at DESC);

COMMENT ON TABLE public.commission_payments IS
  'Histórico de pagamentos de comissão. VÁRIAS linhas por pessoa/mês são '
  'esperadas — é o que permite pagar em parcelas e desfazer só a última. O '
  'relatório soma as linhas do período.';
