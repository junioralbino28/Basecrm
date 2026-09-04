-- Comercial por mês de FECHAMENTO (decisão do Junior, 04/09: "o mais importante hoje é
-- metrificar o comercial"; ganho do lead conta no mês em que ele virou ganho).
--
-- O painel atual mede por coorte de ENTRADA (dos negócios criados no período, quantos
-- fecharam). Este relatório responde a outra pergunta — "o que fechou neste mês?" — e é
-- o que a agência mostra ao cliente todo mês. As duas leituras continuam existindo;
-- nunca se subtrai uma da outra.
--
-- Origem (decisão de 04/09): PRIMEIRO toque como padrão (`deals.first_lead_source_id`,
-- de onde o lead veio) e campanha do ÚLTIMO toque como detalhe (última linha de
-- `lead_source_attributions` por negócio ganho, por `observed_at`).
--
-- Duas funções, uma conta:
--   commercial_report_data(org, inicio, fim)  — SECURITY INVOKER, só service_role:
--       a conta canônica, usada também pela planilha pública (que roda como service_role).
--   get_commercial_report(inicio, fim, org?)  — SECURITY DEFINER com gate
--       can_access_organization + reports.view, para a tela.
-- Mesmo padrão do restante do motor: helper interno fechado ao cliente, RPC gateada.

CREATE OR REPLACE FUNCTION public.commercial_report_data(
  p_organization_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH fechados AS (
    SELECT d.id, d.value, d.is_won, d.is_lost, d.closed_at, d.created_at,
           d.first_lead_source_id, d.loss_reason
    FROM public.deals d
    WHERE d.organization_id = p_organization_id
      AND (d.is_won OR d.is_lost)
      AND d.closed_at >= p_start AND d.closed_at <= p_end
  ),
  ganhos AS (
    SELECT * FROM fechados WHERE is_won
  ),
  perdidos AS (
    SELECT * FROM fechados WHERE is_lost AND NOT is_won
  ),
  entrada_negocios AS (
    SELECT d.id, d.value
    FROM public.deals d
    WHERE d.organization_id = p_organization_id
      AND d.created_at >= p_start AND d.created_at <= p_end
  ),
  entrada_leads AS (
    SELECT count(*) AS qtd
    FROM public.contacts c
    WHERE c.organization_id = p_organization_id
      AND c.created_at >= p_start AND c.created_at <= p_end
  ),
  -- Último toque de cada negócio ganho: a atribuição mais recente, tenha ou não campanha.
  campanha_ultimo_toque AS (
    SELECT DISTINCT ON (a.deal_id)
           a.deal_id,
           coalesce(nullif(btrim(a.utm_campaign), ''), nullif(btrim(a.campaign), '')) AS campanha
    FROM public.lead_source_attributions a
    JOIN ganhos g ON g.id = a.deal_id
    WHERE a.organization_id = p_organization_id
    ORDER BY a.deal_id, a.observed_at DESC, a.recorded_at DESC
  )
  SELECT json_build_object(
    'regime', 'fechamento',
    'fechamento', json_build_object(
      'ganhos', json_build_object(
        'qtd', (SELECT count(*) FROM ganhos),
        'valor', (SELECT coalesce(sum(value), 0) FROM ganhos)
      ),
      'perdidos', json_build_object(
        'qtd', (SELECT count(*) FROM perdidos),
        'valor', (SELECT coalesce(sum(value), 0) FROM perdidos),
        'motivos', (
          SELECT coalesce(json_agg(json_build_object('motivo', m.motivo, 'qtd', m.qtd)
                                   ORDER BY m.qtd DESC, m.motivo), '[]'::json)
          FROM (
            SELECT coalesce(nullif(btrim(loss_reason), ''), 'Sem motivo') AS motivo, count(*) AS qtd
            FROM perdidos
            GROUP BY 1
          ) m
        )
      ),
      -- Taxa de fechamento do mês: decisões do mês, ganhos ÷ (ganhos + perdidos).
      'taxa_fechamento', (
        SELECT CASE WHEN count(*) = 0 THEN 0
                    ELSE round(100.0 * count(*) FILTER (WHERE is_won) / count(*), 1) END
        FROM fechados
      ),
      'ticket_medio', (
        SELECT CASE WHEN count(*) = 0 THEN 0
                    ELSE round((coalesce(sum(value), 0) / count(*))::numeric, 2) END
        FROM ganhos
      ),
      'ciclo_medio_dias', (
        SELECT coalesce(round((avg(extract(epoch FROM (closed_at - created_at)) / 86400.0))::numeric, 1), 0)
        FROM ganhos
      )
    ),
    'entrada', json_build_object(
      'leads', (SELECT qtd FROM entrada_leads),
      'negocios', (SELECT count(*) FROM entrada_negocios),
      'valor', (SELECT coalesce(sum(value), 0) FROM entrada_negocios)
    ),
    'por_origem', (
      SELECT coalesce(json_agg(json_build_object(
               'origem', o.origem,
               'ganhos_qtd', o.ganhos_qtd,
               'ganhos_valor', o.ganhos_valor,
               'perdidos_qtd', o.perdidos_qtd
             ) ORDER BY o.ganhos_valor DESC, o.ganhos_qtd DESC, o.origem), '[]'::json)
      FROM (
        SELECT coalesce(ls.name, 'Sem origem') AS origem,
               count(*) FILTER (WHERE f.is_won) AS ganhos_qtd,
               coalesce(sum(f.value) FILTER (WHERE f.is_won), 0) AS ganhos_valor,
               count(*) FILTER (WHERE f.is_lost AND NOT f.is_won) AS perdidos_qtd
        FROM fechados f
        LEFT JOIN public.lead_sources ls
          ON ls.id = f.first_lead_source_id AND ls.organization_id = p_organization_id
        GROUP BY 1
      ) o
    ),
    'por_campanha', (
      SELECT coalesce(json_agg(json_build_object(
               'campanha', c.campanha,
               'ganhos_qtd', c.ganhos_qtd,
               'ganhos_valor', c.ganhos_valor
             ) ORDER BY c.ganhos_valor DESC, c.ganhos_qtd DESC, c.campanha), '[]'::json)
      FROM (
        SELECT coalesce(cu.campanha, 'Sem campanha') AS campanha,
               count(*) AS ganhos_qtd,
               coalesce(sum(g.value), 0) AS ganhos_valor
        FROM ganhos g
        LEFT JOIN campanha_ultimo_toque cu ON cu.deal_id = g.id
        GROUP BY 1
      ) c
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.get_commercial_report(
  p_start timestamptz,
  p_end timestamptz,
  p_organization_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org uuid;
BEGIN
  v_org := coalesce(p_organization_id, public.current_profile_organization_id());
  IF v_org IS NULL OR NOT public.can_access_organization(v_org)
    OR NOT public.has_permission('reports.view') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'acesso negado';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'período inválido';
  END IF;

  RETURN public.commercial_report_data(v_org, p_start, p_end);
END;
$$;

-- Helper interno: nunca executável pelo cliente. RPC: só autenticado, com gate dentro.
REVOKE ALL ON FUNCTION public.commercial_report_data(uuid, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commercial_report_data(uuid, timestamptz, timestamptz)
  TO service_role;
REVOKE ALL ON FUNCTION public.get_commercial_report(timestamptz, timestamptz, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_commercial_report(timestamptz, timestamptz, uuid)
  TO authenticated;

-- Consultas por mês de fechamento e por origem passam a ter índice próprio.
CREATE INDEX IF NOT EXISTS idx_deals_org_closed_at
  ON public.deals (organization_id, closed_at)
  WHERE closed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_source_attributions_deal_observed
  ON public.lead_source_attributions (organization_id, deal_id, observed_at DESC);
