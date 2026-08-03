-- P3-21: especialidade usada é identidade histórica e deve ser arquivada.
-- O aplicativo já faz UPDATE active=false; manter DELETE no papel authenticated
-- permitia contornar esse fluxo e apagar em cascata vínculos de profissionais e
-- procedimentos. TRUNCATE também precisa sair porque ignora RLS por definição.

REVOKE DELETE, TRUNCATE ON TABLE public.specialties FROM authenticated;

DROP POLICY IF EXISTS specialties_delete_by_admin ON public.specialties;

-- `service_role` continua com ALL para manutenção interna e a FK da organização
-- continua podendo remover o tenant inteiro em operação administrativa própria.
