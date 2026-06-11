/**
 * Resolve as credenciais Clinicorp por tenant a partir de public.clinicorp_config.
 * SEGURANÇA: usado SERVER-SIDE com admin client. O apiToken nunca volta ao client —
 * apenas o adapter (server) consome o objeto resolvido.
 * Espelha o contrato de lib/channels/evolutionCredentials.ts (objeto resolvido ou null).
 */
import { CLINICORP_API_BASE_URL, type ClinicorpCredentials } from './clinicorpTypes';

type ResolveClinicorpCredentialsParams = {
  admin: any;
  tenantId: string;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function resolveClinicorpCredentials(
  params: ResolveClinicorpCredentialsParams
): Promise<ClinicorpCredentials | null> {
  const result = await params.admin
    .from('clinicorp_config')
    .select('api_user, api_token, subscriber_id, code_link, business_id')
    .eq('organization_id', params.tenantId)
    .maybeSingle();

  if (result.error) throw new Error(result.error.message);
  if (!result.data) return null;

  const apiUser = normalizeText(result.data.api_user);
  const apiToken = normalizeText(result.data.api_token);
  const subscriberId = normalizeText(result.data.subscriber_id);
  // code_link é OPCIONAL: só serve pro agendamento online (que a clínica piloto não usa).
  const codeLink = normalizeText(result.data.code_link);
  const businessId = Number(result.data.business_id);

  if (!apiUser || !apiToken || !subscriberId || !Number.isFinite(businessId) || businessId <= 0) {
    return null;
  }

  return {
    apiUrl: CLINICORP_API_BASE_URL,
    apiUser,
    apiToken,
    subscriberId,
    ...(codeLink ? { codeLink } : {}),
    businessId,
  };
}
