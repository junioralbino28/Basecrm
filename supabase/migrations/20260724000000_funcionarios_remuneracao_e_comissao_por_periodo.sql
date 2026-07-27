-- =============================================================================
-- Funcionários (remuneração) + Comissão por PERÍODO DE VIGÊNCIA
-- =============================================================================
-- Decisões do Junior em 2026-07-24 (docs/decisoes.md):
--
--  1. O cadastro deixa de ser só "profissional de saúde" e vira FUNCIONÁRIO com
--     CARGO — dentista, secretária, comercial, o que for. No cadastro se define
--     como a pessoa ganha: fixo, comissionado ou os dois. Tudo editável (gente é
--     promovida, acordo muda, valor reajusta).
--
--  2. Comissão NUNCA é editada por cima: ao mudar, nasce um NOVO PERÍODO com
--     data de início (`valid_from`). O anterior fica intacto, e cada atendimento
--     é calculado pela regra que valia NO DIA DELE. Assim, puxar um período
--     longo não quebra e relatório antigo continua batendo com o que já foi pago.
--     (O Junior escolheu isto no lugar de congelar o valor no atendimento: é mais
--     flexível — cobre acordo fechado em maio e cadastrado só em julho.)
--
--  3. A comissão pode ser PERCENTUAL **ou** VALOR FIXO, em qualquer nível de
--     precedência. É isso que permite qualquer cliente/nicho caber sem hardcode:
--     nada de odontologia nem de valores de cliente específico entra no motor.
--
--  4. Quem não produziu no período PRECISA aparecer, zerado (report do Adel).
--
-- Compatibilidade: `commission_rules.percent` continua existindo e é espelhado
-- em `amount` quando `amount_type = 'percent'`, para não quebrar UI/serviços atuais.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. FUNCIONÁRIO: cargo + forma de remuneração
-- -----------------------------------------------------------------------------
ALTER TABLE public.professionals
  ADD COLUMN IF NOT EXISTS role text,
  ADD COLUMN IF NOT EXISTS pay_type text NOT NULL DEFAULT 'commission',
  ADD COLUMN IF NOT EXISTS fixed_amount numeric NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'professionals_pay_type_chk'
  ) THEN
    ALTER TABLE public.professionals
      ADD CONSTRAINT professionals_pay_type_chk
      CHECK (pay_type IN ('fixed', 'commission', 'both'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'professionals_fixed_amount_chk'
  ) THEN
    ALTER TABLE public.professionals
      ADD CONSTRAINT professionals_fixed_amount_chk CHECK (fixed_amount >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.professionals.role IS
  'Cargo do funcionário (dentista, secretária, comercial…). Agrupa a listagem do admin.';
COMMENT ON COLUMN public.professionals.pay_type IS
  'Como a pessoa ganha: fixed | commission | both. Editável (promoção, novo acordo).';
COMMENT ON COLUMN public.professionals.fixed_amount IS
  'Valor fixo do período quando pay_type é fixed ou both.';

-- -----------------------------------------------------------------------------
-- 2. COMISSÃO: valor fixo OU percentual, com vigência e escopo por procedimento
-- -----------------------------------------------------------------------------
ALTER TABLE public.commission_rules
  ADD COLUMN IF NOT EXISTS amount_type text NOT NULL DEFAULT 'percent',
  ADD COLUMN IF NOT EXISTS amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS procedimento text,
  ADD COLUMN IF NOT EXISTS valid_from date NOT NULL DEFAULT DATE '1900-01-01';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'commission_rules_amount_type_chk'
  ) THEN
    ALTER TABLE public.commission_rules
      ADD CONSTRAINT commission_rules_amount_type_chk
      CHECK (amount_type IN ('percent', 'fixed'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'commission_rules_amount_chk'
  ) THEN
    ALTER TABLE public.commission_rules
      ADD CONSTRAINT commission_rules_amount_chk
      CHECK (amount >= 0 AND (amount_type <> 'percent' OR amount <= 100));
  END IF;
END $$;

-- Regras que já existiam eram todas percentuais: espelha percent -> amount.
UPDATE public.commission_rules
   SET amount = percent
 WHERE amount_type = 'percent' AND amount = 0 AND percent > 0;

-- COMPATIBILIDADE: a UI/serviço atual grava só `percent`. Sem isto, uma regra
-- criada pela tela antiga entraria com amount = 0 e a comissão sairia ZERADA.
-- O gatilho mantém os dois lados espelhados enquanto amount_type = 'percent'.
CREATE OR REPLACE FUNCTION public.sync_commission_rule_amount()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.amount_type = 'percent' THEN
    IF NEW.amount = 0 AND NEW.percent > 0 THEN
      NEW.amount := NEW.percent;
    ELSIF NEW.percent = 0 AND NEW.amount > 0 THEN
      NEW.percent := NEW.amount;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_commission_rule_amount ON public.commission_rules;
CREATE TRIGGER trg_sync_commission_rule_amount
  BEFORE INSERT OR UPDATE ON public.commission_rules
  FOR EACH ROW EXECUTE FUNCTION public.sync_commission_rule_amount();

CREATE INDEX IF NOT EXISTS idx_commission_rules_lookup
  ON public.commission_rules (organization_id, professional_id, valid_from DESC);

COMMENT ON COLUMN public.commission_rules.amount_type IS
  'percent = % sobre (valor - desconto); fixed = valor fixo por atendimento.';
COMMENT ON COLUMN public.commission_rules.procedimento IS
  'Escopo opcional: casa com atendimentos.procedimento. É o nível mais específico.';
COMMENT ON COLUMN public.commission_rules.valid_from IS
  'Data em que esta regra passa a valer. NUNCA editar uma regra por cima — criar '
  'um novo período. O cálculo usa a regra vigente na data do atendimento, então '
  'mudar a comissão hoje não reescreve o passado.';

-- -----------------------------------------------------------------------------
-- 3. RELATÓRIO DE COMISSÃO
--    (a) parte de PROFESSIONALS (LEFT JOIN) — quem não produziu aparece zerado;
--    (b) resolve a regra VIGENTE NA DATA do atendimento;
--    (c) entende valor fixo além de percentual.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_commission_report(
  p_start timestamptz,
  p_end timestamptz,
  p_organization_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_period_start text;
  v_period_end text;
  result json;
BEGIN
  v_org := coalesce(p_organization_id, public.current_profile_organization_id());
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'organização não resolvida' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_configure_organization(v_org) THEN
    RAISE EXCEPTION 'acesso negado' USING ERRCODE = '42501';
  END IF;

  v_period_start := to_char(p_start AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM');
  v_period_end := to_char(p_end AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM');

  SELECT json_build_object(
    'total_comissao', coalesce(sum(linha.comissao), 0),
    'por_profissional', coalesce(
      json_agg(
        json_build_object(
          'professional_id', linha.professional_id,
          'professional_name', linha.professional_name,
          'role', linha.role,
          'pay_type', linha.pay_type,
          'fixed_amount', linha.fixed_amount,
          'atendimentos', linha.atendimentos,
          'comissao', linha.comissao,
          'faturamento_base', linha.faturamento_base,
          'pago', linha.pago
        )
        ORDER BY linha.comissao DESC, linha.professional_name ASC
      ),
      '[]'::json
    ),
    -- Atendimentos recebidos SEM profissional no range (não entram na tabela
    -- por-profissional). Reconcilia "Receita" com "Recebido bruto" do Financeiro.
    'sem_profissional', (
      SELECT json_build_object(
        'atendimentos', count(*),
        'faturamento', coalesce(sum(sp.valor - sp.desconto), 0)
      )
      FROM public.atendimentos sp
      WHERE sp.organization_id = v_org
        AND sp.professional_id IS NULL
        AND sp.recebido = true
        AND sp.paid_at >= p_start
        AND sp.paid_at <= p_end
    )
  ) INTO result
  FROM (
    SELECT
      p.id AS professional_id,
      p.name AS professional_name,
      p.role AS role,
      p.pay_type AS pay_type,
      p.fixed_amount AS fixed_amount,
      count(a.id) AS atendimentos,
      -- Valor fixo por atendimento OU percentual sobre (valor - desconto).
      -- `desconto` já sai da base antes da comissão (regra confirmada com o
      -- Adel: o custo do material não gera comissão).
      coalesce(sum(
        CASE
          WHEN regra.amount_type = 'fixed' THEN regra.amount
          -- fallback pro `percent` legado: regra gravada pela tela antiga pode
          -- ter amount = 0 (o gatilho cobre daqui pra frente; isto cobre o que
          -- já estiver no banco).
          ELSE (a.valor - a.desconto)
               * coalesce(nullif(regra.amount, 0), regra.percent, 0) / 100
        END
      ), 0) AS comissao,
      coalesce(sum(a.valor - a.desconto), 0) AS faturamento_base,
      coalesce((
        SELECT sum(cp.amount)
        FROM public.commission_payments cp
        WHERE cp.organization_id = v_org
          AND cp.professional_id = p.id
          AND cp.period >= v_period_start
          AND cp.period <= v_period_end
      ), 0) AS pago
    FROM public.professionals p
    -- LEFT JOIN: quem não produziu no período aparece zerado (pedido do Adel,
    -- 2026-07-24 — antes o relatório partia de `atendimentos` e a pessoa sumia).
    LEFT JOIN public.atendimentos a
      ON a.professional_id = p.id
     AND a.organization_id = v_org
     AND a.recebido = true
     AND a.paid_at >= p_start
     AND a.paid_at <= p_end
    LEFT JOIN LATERAL (
      SELECT c.amount_type, c.amount, c.percent
      FROM public.commission_rules c
      WHERE c.organization_id = v_org
        -- Só regras JÁ VIGENTES na data do atendimento: mudar a comissão hoje
        -- não altera o que já foi apurado.
        AND c.valid_from <= (a.paid_at AT TIME ZONE 'America/Sao_Paulo')::date
        AND (
          (c.professional_id = p.id
            AND (c.procedimento IS NULL OR c.procedimento = a.procedimento)
            AND (c.specialty IS NULL OR c.specialty = p.specialty))
          OR (c.professional_id IS NULL
            AND (c.procedimento IS NULL OR c.procedimento = a.procedimento)
            AND c.specialty = p.specialty)
        )
      -- Precedência: pessoa+procedimento > pessoa+especialidade > pessoa >
      -- coringa por especialidade. Empate → a que passou a valer mais tarde.
      ORDER BY
        (c.professional_id IS NOT NULL) DESC,
        (c.procedimento IS NOT NULL AND c.procedimento = a.procedimento) DESC,
        (c.specialty IS NOT NULL AND c.specialty = p.specialty) DESC,
        c.valid_from DESC,
        c.created_at DESC
      LIMIT 1
    ) regra ON true
    WHERE p.organization_id = v_org
      AND p.active = true
    GROUP BY p.id, p.name, p.role, p.pay_type, p.fixed_amount
  ) linha;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.get_commission_report(timestamptz, timestamptz, uuid) IS
  'Comissão por funcionário no período. Parte de professionals (LEFT JOIN) para '
  'que quem não produziu apareça zerado; resolve a regra VIGENTE na data do '
  'atendimento (valid_from) e aceita valor fixo ou percentual.';
