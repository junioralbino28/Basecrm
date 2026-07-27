-- =============================================================================
-- VÁRIAS ESPECIALIDADES POR FUNCIONÁRIO (+ limpeza das entradas coladas)
-- =============================================================================
-- Decisão do Junior (2026-07-27), olhando a tela de Especialidades:
--
--   "essa parte tem um com várias especialidades juntas, e isso é desnecessário;
--    o ideal é que se possa colocar mais de uma especialidade por funcionário se
--    necessário, pois ele pode fazer vários procedimentos."
--
-- DUAS COISAS, mesma causa:
--
--  1. O catálogo nasceu sujo. A migration `20260724010000` semeou `specialties`
--     (e `job_roles`) a partir do TEXTO LIVRE de `professionals`. Um cadastro que
--     trazia "Clínica geral, Ortodontia, Lentes em resina, Harmonização orofacial"
--     numa string só virou UMA especialidade colada. É o princípio "texto livre
--     onde vai haver comparação = bug" aparecendo dentro do próprio remédio.
--     → aqui a entrada colada é DESMEMBRADA nas partes e removida.
--
--  2. Uma pessoa pode ter N especialidades. Vira TABELA DE LIGAÇÃO
--     (`professional_specialties`) — não uma string com vírgulas, que reintroduz
--     exatamente o defeito acima.
--
-- COMPATIBILIDADE (lição de `commission_rules.amount`, 24/07): `professionals.
-- specialty` CONTINUA existindo e sendo preenchida com UMA das especialidades.
-- Quem ainda lê a coluna antiga não quebra. A verdade completa vive na ligação.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Desmembra entradas coladas nos DOIS catálogos
-- -----------------------------------------------------------------------------
-- Só mexe em linha com vírgula cujas partes são todas nomes plausíveis (>= 2
-- caracteres) — um nome legítimo que contenha vírgula fica intacto.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['job_roles', 'specialties'] LOOP
    EXECUTE format($f$
      WITH colados AS (
        SELECT id, organization_id, name
          FROM public.%1$s
         WHERE name LIKE '%%,%%'
           AND NOT EXISTS (
             SELECT 1 FROM unnest(string_to_array(name, ',')) parte
              WHERE length(btrim(parte)) < 2
           )
      ), partes AS (
        SELECT c.organization_id, btrim(parte) AS nome
          FROM colados c, unnest(string_to_array(c.name, ',')) parte
      ), inseridos AS (
        INSERT INTO public.%1$s (organization_id, name)
        SELECT DISTINCT organization_id, nome FROM partes
        ON CONFLICT DO NOTHING
        RETURNING 1
      )
      DELETE FROM public.%1$s WHERE id IN (SELECT id FROM colados);
    $f$, t);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Tabela de ligação: funcionário ⇄ especialidades
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.professional_specialties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
  specialty_id uuid NOT NULL REFERENCES public.specialties(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_professional_specialties
  ON public.professional_specialties (professional_id, specialty_id);
CREATE INDEX IF NOT EXISTS idx_professional_specialties_org
  ON public.professional_specialties (organization_id, professional_id);

ALTER TABLE public.professional_specialties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS professional_specialties_select_by_tenant ON public.professional_specialties;
CREATE POLICY professional_specialties_select_by_tenant ON public.professional_specialties
  FOR SELECT TO authenticated
  USING (public.can_access_organization(organization_id));

DROP POLICY IF EXISTS professional_specialties_insert_by_admin ON public.professional_specialties;
CREATE POLICY professional_specialties_insert_by_admin ON public.professional_specialties
  FOR INSERT TO authenticated
  WITH CHECK (public.can_configure_organization(organization_id));

DROP POLICY IF EXISTS professional_specialties_delete_by_admin ON public.professional_specialties;
CREATE POLICY professional_specialties_delete_by_admin ON public.professional_specialties
  FOR DELETE TO authenticated
  USING (public.can_configure_organization(organization_id));

-- ⚠️ RLS NÃO concede acesso — só restringe. Sem o GRANT o Postgres devolve
-- "permission denied" antes de olhar a policy (foi o bug de 24/07 em job_roles).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.professional_specialties TO authenticated, service_role;

COMMENT ON TABLE public.professional_specialties IS
  'Especialidades de cada funcionário. Tabela de ligação porque uma pessoa faz '
  'vários procedimentos (decisão do Junior, 2026-07-27). NUNCA voltar a guardar '
  'lista em string separada por vírgula — foi assim que o catálogo nasceu sujo.';

-- -----------------------------------------------------------------------------
-- 3. Backfill: o que estava na coluna antiga vira ligação
-- -----------------------------------------------------------------------------
-- Cada pedaço do texto livre precisa existir no catálogo antes de virar ligação.
INSERT INTO public.specialties (organization_id, name)
SELECT DISTINCT p.organization_id, btrim(parte)
  FROM public.professionals p, unnest(string_to_array(p.specialty, ',')) parte
 WHERE p.specialty IS NOT NULL
   AND length(btrim(parte)) >= 2
ON CONFLICT DO NOTHING;

INSERT INTO public.professional_specialties (organization_id, professional_id, specialty_id)
SELECT DISTINCT p.organization_id, p.id, s.id
  FROM public.professionals p
  CROSS JOIN LATERAL unnest(string_to_array(p.specialty, ',')) parte
  JOIN public.specialties s
    ON s.organization_id = p.organization_id
   AND lower(btrim(s.name)) = lower(btrim(parte))
 WHERE p.specialty IS NOT NULL
   AND length(btrim(parte)) >= 2
ON CONFLICT DO NOTHING;

-- Espelho legado: a coluna antiga passa a guardar UMA especialidade (a primeira
-- em ordem alfabética, para ser determinística), nunca mais a lista colada.
UPDATE public.professionals p
   SET specialty = sub.nome
  FROM (
    SELECT ps.professional_id, min(s.name) AS nome
      FROM public.professional_specialties ps
      JOIN public.specialties s ON s.id = ps.specialty_id
     GROUP BY ps.professional_id
  ) sub
 WHERE sub.professional_id = p.id
   AND p.specialty IS DISTINCT FROM sub.nome;

COMMENT ON COLUMN public.professionals.specialty IS
  'ESPELHO LEGADO — uma das especialidades da pessoa, mantida para quem ainda lê '
  'esta coluna. A verdade completa está em professional_specialties.';

-- -----------------------------------------------------------------------------
-- 4. "Essa pessoa tem esta especialidade?" — usado pelo relatório de comissão
-- -----------------------------------------------------------------------------
-- Casa pelo nome normalizado porque `commission_rules.specialty` é texto (é o
-- escopo da REGRA, não a chave do catálogo). Olha a ligação e, se a pessoa ainda
-- não tiver nenhuma ligação, cai no espelho legado.
CREATE OR REPLACE FUNCTION public.professional_has_specialty(
  p_professional_id uuid,
  p_specialty text
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_specialty IS NULL OR btrim(p_specialty) = '' THEN false
    WHEN EXISTS (
      SELECT 1 FROM public.professional_specialties ps
      WHERE ps.professional_id = p_professional_id
    ) THEN EXISTS (
      SELECT 1
        FROM public.professional_specialties ps
        JOIN public.specialties s ON s.id = ps.specialty_id
       WHERE ps.professional_id = p_professional_id
         AND lower(btrim(s.name)) = lower(btrim(p_specialty))
    )
    ELSE EXISTS (
      SELECT 1 FROM public.professionals p
       WHERE p.id = p_professional_id
         AND lower(btrim(coalesce(p.specialty, ''))) = lower(btrim(p_specialty))
    )
  END;
$$;

GRANT EXECUTE ON FUNCTION public.professional_has_specialty(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.professional_has_specialty(uuid, text) IS
  'true se o funcionário tem a especialidade informada. Usa a tabela de ligação; '
  'cai no espelho legado professionals.specialty quando não há ligação nenhuma.';

-- -----------------------------------------------------------------------------
-- 5. Relatório de comissão: o coringa por especialidade passa a casar com
--    QUALQUER especialidade da pessoa
-- -----------------------------------------------------------------------------
-- ⚠️ CABEÇALHO DE SEGURANÇA COPIADO CAMPO A CAMPO da versão anterior
-- (`20260724000000`, que por sua vez preserva `20260635000000`):
-- STABLE · SECURITY DEFINER · SET search_path = '' · gate
-- can_access_organization + has_permission('reports.professionals').
-- NÃO reescrever esta função a partir do corpo — o cabeçalho se perde em silêncio
-- (foi o que aconteceu em 24/07 e só a suíte COMPLETA pegou).
CREATE OR REPLACE FUNCTION public.get_commission_report(
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
  v_period_start text;
  v_period_end text;
  result json;
BEGIN
  v_org := coalesce(p_organization_id, public.current_profile_organization_id());

  -- ⚠️ GATE PRESERVADO DE `20260635000000_e2_server_permission_enforcement.sql`.
  -- NÃO trocar por can_configure_organization: staff COM a permissão
  -- `reports.professionals` precisa continuar lendo (há teste de isolamento
  -- cobrindo isso — `e2ServerIsolation.local.test.ts`).
  IF v_org IS NULL
    OR NOT public.can_access_organization(v_org)
    OR NOT public.has_permission('reports.professionals') THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'acesso negado';
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
            -- casa com QUALQUER especialidade da pessoa (2026-07-27)
            AND (c.specialty IS NULL OR public.professional_has_specialty(p.id, c.specialty)))
          OR (c.professional_id IS NULL
            AND (c.procedimento IS NULL OR c.procedimento = a.procedimento)
            AND public.professional_has_specialty(p.id, c.specialty))
        )
      -- Precedência: pessoa+procedimento > pessoa+especialidade > pessoa >
      -- coringa por especialidade. Empate → a que passou a valer mais tarde e,
      -- persistindo, a cadastrada por último. Com VÁRIAS especialidades por
      -- pessoa duas regras coringa podem casar com o mesmo atendimento; o
      -- desempate abaixo mantém o resultado determinístico. O conserto de raiz
      -- é ligar PROCEDIMENTO → especialidade (fila, item 5).
      ORDER BY
        (c.professional_id IS NOT NULL) DESC,
        (c.procedimento IS NOT NULL AND c.procedimento = a.procedimento) DESC,
        (c.specialty IS NOT NULL AND public.professional_has_specialty(p.id, c.specialty)) DESC,
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
