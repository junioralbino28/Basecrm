-- P3-11/P3-12: conjuntos relacionados mudam dentro de uma única transação.

CREATE OR REPLACE FUNCTION public.sync_professional_specialties(
  p_organization_id uuid,
  p_professional_id uuid,
  p_specialty_ids uuid[]
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ids uuid[] := coalesce(p_specialty_ids, ARRAY[]::uuid[]);
  v_entered uuid[];
  v_left uuid[];
  v_mirror text;
BEGIN
  IF NOT coalesce(public.can_configure_organization(p_organization_id), false) THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_professional_id::text, 0));
  IF NOT EXISTS (SELECT 1 FROM public.professionals p WHERE p.id = p_professional_id AND p.organization_id = p_organization_id) THEN
    RAISE EXCEPTION 'profissional inválido' USING ERRCODE = '23503';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_ids) x(id)
    WHERE NOT EXISTS (SELECT 1 FROM public.specialties s WHERE s.id = x.id AND s.organization_id = p_organization_id)
  ) THEN
    RAISE EXCEPTION 'specialty_ids_invalidos' USING ERRCODE = '23503';
  END IF;

  SELECT coalesce(array_agg(x.id), ARRAY[]::uuid[]) INTO v_entered
  FROM unnest(v_ids) x(id)
  WHERE NOT EXISTS (SELECT 1 FROM public.professional_specialties ps WHERE ps.professional_id = p_professional_id AND ps.specialty_id = x.id);
  SELECT coalesce(array_agg(ps.specialty_id), ARRAY[]::uuid[]) INTO v_left
  FROM public.professional_specialties ps
  WHERE ps.organization_id = p_organization_id AND ps.professional_id = p_professional_id
    AND NOT (ps.specialty_id = ANY(v_ids));

  DELETE FROM public.professional_specialties ps
  WHERE ps.organization_id = p_organization_id AND ps.professional_id = p_professional_id
    AND NOT (ps.specialty_id = ANY(v_ids));
  INSERT INTO public.professional_specialties (organization_id, professional_id, specialty_id)
  SELECT p_organization_id, p_professional_id, x.id FROM unnest(v_entered) x(id)
  ON CONFLICT DO NOTHING;

  -- Entrar numa especialidade sempre restaura o padrão dos produtos dela.
  DELETE FROM public.professional_product_overrides o
  WHERE o.organization_id = p_organization_id AND o.professional_id = p_professional_id
    AND o.product_id IN (
      SELECT sp.product_id
      FROM public.specialty_products sp
      WHERE sp.organization_id = p_organization_id
        AND sp.specialty_id = ANY(v_entered)
    );

  -- Ao sair, restaure somente produtos que não continuam cobertos por outra
  -- especialidade mantida pela pessoa.
  DELETE FROM public.professional_product_overrides o
  WHERE o.organization_id = p_organization_id AND o.professional_id = p_professional_id
    AND o.product_id IN (
      SELECT sp.product_id
      FROM public.specialty_products sp
      WHERE sp.organization_id = p_organization_id
        AND sp.specialty_id = ANY(v_left)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.specialty_products kept
      WHERE kept.organization_id = p_organization_id AND kept.product_id = o.product_id AND kept.specialty_id = ANY(v_ids)
    );

  SELECT min(s.name) INTO v_mirror FROM public.specialties s WHERE s.organization_id = p_organization_id AND s.id = ANY(v_ids);
  UPDATE public.professionals SET specialty = v_mirror, updated_at = now()
  WHERE id = p_professional_id AND organization_id = p_organization_id;
  RETURN v_mirror;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_specialty_products_batch(
  p_organization_id uuid, p_specialty_id uuid, p_product_ids uuid[], p_enabled boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_product_ids uuid[] := coalesce(p_product_ids, ARRAY[]::uuid[]);
BEGIN
  IF NOT coalesce(public.can_configure_organization(p_organization_id), false) THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF p_enabled IS NULL THEN RAISE EXCEPTION 'enabled obrigatório' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('specialty-products:' || p_specialty_id::text, 0));
  IF NOT EXISTS (SELECT 1 FROM public.specialties s WHERE s.id = p_specialty_id AND s.organization_id = p_organization_id)
     OR EXISTS (SELECT 1 FROM unnest(v_product_ids) x(id) WHERE NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = x.id AND p.organization_id = p_organization_id))
  THEN RAISE EXCEPTION 'referência inválida' USING ERRCODE = '23503'; END IF;
  IF p_enabled THEN
    INSERT INTO public.specialty_products (organization_id, specialty_id, product_id)
    SELECT p_organization_id, p_specialty_id, x.id FROM unnest(v_product_ids) x(id) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.specialty_products WHERE organization_id = p_organization_id AND specialty_id = p_specialty_id AND product_id = ANY(v_product_ids);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_professional_product_overrides_batch(
  p_organization_id uuid, p_professional_id uuid, p_changes jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_changes jsonb := coalesce(p_changes, '[]'::jsonb);
BEGIN
  IF NOT coalesce(public.can_configure_organization(p_organization_id), false) THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(v_changes) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'changes deve ser array' USING ERRCODE = '22023'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(v_changes) x(product_id uuid, enabled boolean)
    GROUP BY x.product_id HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'produto duplicado em changes' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('professional-products:' || p_professional_id::text, 0));
  IF NOT EXISTS (SELECT 1 FROM public.professionals p WHERE p.id = p_professional_id AND p.organization_id = p_organization_id)
     OR EXISTS (SELECT 1 FROM jsonb_to_recordset(v_changes) x(product_id uuid, enabled boolean) WHERE NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = x.product_id AND p.organization_id = p_organization_id))
  THEN RAISE EXCEPTION 'referência inválida' USING ERRCODE = '23503'; END IF;
  DELETE FROM public.professional_product_overrides o USING jsonb_to_recordset(v_changes) x(product_id uuid, enabled boolean)
  WHERE o.organization_id = p_organization_id AND o.professional_id = p_professional_id AND o.product_id = x.product_id AND x.enabled IS NULL;
  INSERT INTO public.professional_product_overrides (organization_id, professional_id, product_id, enabled, updated_at)
  SELECT p_organization_id, p_professional_id, x.product_id, x.enabled, now()
  FROM jsonb_to_recordset(v_changes) x(product_id uuid, enabled boolean) WHERE x.enabled IS NOT NULL
  ON CONFLICT (professional_id, product_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_professional_specialties(uuid, uuid, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_specialty_products_batch(uuid, uuid, uuid[], boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_professional_product_overrides_batch(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_professional_specialties(uuid, uuid, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_specialty_products_batch(uuid, uuid, uuid[], boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_professional_product_overrides_batch(uuid, uuid, jsonb) TO authenticated, service_role;
