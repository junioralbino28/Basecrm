/**
 * GET/POST /api/settings/meta-capi — configuração do envio de conversões à Meta (3c)
 * por organização: liga/desliga, dataset, token, código de teste, valor no ganho,
 * mapa de eventos e DDDs da região (3d).
 *
 * SEGURANÇA (mesmo padrão de /api/settings/ai): só admin (agência ou clínica) do
 * tenant; o token NUNCA volta ao navegador (só "configurado" + últimos 4); a
 * escrita vai pelo cliente do usuário, então o RLS can_configure decide.
 */
import { z } from 'zod';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { requireAdminTenantContext } from '@/lib/platform/adminTenantContext';
import { BUSINESS_MESSAGING_EVENT_NAMES } from '@/lib/meta/conversionsApi';
import {
  BUSINESS_MESSAGING_EVENT_LABELS_PT,
  CONVERSION_EVENT_TYPE_LABELS_PT,
  DEFAULT_CONVERSION_EVENT_MAP,
} from '@/lib/meta/conversionEventLabels';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function last4(value: string | null | undefined): string {
  const s = (value ?? '').trim();
  return s.length >= 8 ? s.slice(-4) : '';
}

const EVENT_TYPES = ['replied', 'scheduled', 'attended', 'won'] as const;
const EVENT_NAME = z.enum(BUSINESS_MESSAGING_EVENT_NAMES);

const UpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    datasetId: z.string().max(64).optional(),
    whatsappBusinessAccountId: z.string().max(64).optional(),
    accessToken: z.string().max(1024).optional(),
    testEventCode: z.string().max(64).optional(),
    sendValue: z.boolean().optional(),
    eventMap: z
      .object({
        replied: EVENT_NAME.nullable().optional(),
        scheduled: EVENT_NAME.nullable().optional(),
        attended: EVENT_NAME.nullable().optional(),
        won: EVENT_NAME.nullable().optional(),
      })
      .strict()
      .optional(),
    regionDdds: z.array(z.string().regex(/^\d{2}$/)).max(40).optional(),
  })
  .strict();

// Escada padrão decidida pelo Junior em 13/09 (compareceu → InitiateCheckout); a tradução de
// cada nome vive em lib/meta/conversionEventLabels.ts e no comentário da coluna.
const DEFAULT_EVENT_MAP: Record<(typeof EVENT_TYPES)[number], string | null> = {
  ...DEFAULT_CONVERSION_EVENT_MAP,
};

function readEventMap(value: unknown) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const map: Record<string, string | null> = { ...DEFAULT_EVENT_MAP };
  for (const type of EVENT_TYPES) {
    if (type in source) {
      const v = source[type];
      map[type] = typeof v === 'string' && v.trim() ? v.trim() : null;
    }
  }
  return map;
}

export async function GET() {
  const auth = await requireAdminTenantContext();
  if ('error' in auth) return auth.error;

  // O token só é legível via service-role (coluna sem SELECT para authenticated).
  const admin = createStaticAdminClient();
  const { data, error } = await admin
    .from('organization_settings')
    .select(
      'meta_capi_enabled, meta_capi_dataset_id, meta_capi_whatsapp_business_account_id, meta_capi_access_token, meta_capi_test_event_code, meta_capi_send_value, meta_capi_event_map, conversion_region_ddds'
    )
    .eq('organization_id', auth.targetOrganizationId)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);

  return json({
    enabled: data?.meta_capi_enabled === true,
    datasetId: data?.meta_capi_dataset_id ?? '',
    whatsappBusinessAccountId: data?.meta_capi_whatsapp_business_account_id ?? '',
    hasToken: Boolean(data?.meta_capi_access_token),
    tokenLast4: last4(data?.meta_capi_access_token),
    testEventCode: data?.meta_capi_test_event_code ?? '',
    sendValue: data?.meta_capi_send_value === true,
    eventMap: readEventMap(data?.meta_capi_event_map),
    regionDdds: Array.isArray(data?.conversion_region_ddds) ? data.conversion_region_ddds : [],
    supportedEventNames: BUSINESS_MESSAGING_EVENT_NAMES,
    // Tradução para a tela: o nome da Meta é só um rótulo; o que ele significa para nós está aqui.
    eventNameLabels: BUSINESS_MESSAGING_EVENT_LABELS_PT,
    eventTypeLabels: CONVERSION_EVENT_TYPE_LABELS_PT,
  });
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const supabase = await createClient();
  const auth = await requireAdminTenantContext();
  if ('error' in auth) return auth.error;

  const rawBody = await req.json().catch(() => null);
  const parsed = UpdateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return json({ error: 'Payload inválido', details: parsed.error.flatten() }, 400);
  }
  const updates = parsed.data;

  const normalize = (value: string | undefined) => {
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  };

  const dbUpdates: Record<string, unknown> = {
    organization_id: auth.targetOrganizationId,
    updated_at: new Date().toISOString(),
  };
  if (updates.enabled !== undefined) dbUpdates.meta_capi_enabled = updates.enabled;
  if (updates.sendValue !== undefined) dbUpdates.meta_capi_send_value = updates.sendValue;
  const datasetId = normalize(updates.datasetId);
  if (datasetId !== undefined) dbUpdates.meta_capi_dataset_id = datasetId;
  const wabaId = normalize(updates.whatsappBusinessAccountId);
  if (wabaId !== undefined) dbUpdates.meta_capi_whatsapp_business_account_id = wabaId;
  const accessToken = normalize(updates.accessToken);
  if (accessToken !== undefined) dbUpdates.meta_capi_access_token = accessToken;
  const testEventCode = normalize(updates.testEventCode);
  if (testEventCode !== undefined) dbUpdates.meta_capi_test_event_code = testEventCode;
  if (updates.regionDdds !== undefined) dbUpdates.conversion_region_ddds = Array.from(new Set(updates.regionDdds));

  if (updates.eventMap !== undefined) {
    // Mescla com o que já existe: o admin pode mandar só a chave que mudou.
    const admin = createStaticAdminClient();
    const current = await admin
      .from('organization_settings')
      .select('meta_capi_event_map')
      .eq('organization_id', auth.targetOrganizationId)
      .maybeSingle();
    if (current.error) return json({ error: current.error.message }, 500);
    const merged = readEventMap(current.data?.meta_capi_event_map);
    for (const type of EVENT_TYPES) {
      if (updates.eventMap[type] !== undefined) merged[type] = updates.eventMap[type] ?? null;
    }
    dbUpdates.meta_capi_event_map = merged;
  }

  // O TOKEN sai deste lote de propósito. `authenticated` não tem SELECT em
  // `meta_capi_access_token` (para o token nunca voltar ao navegador), e um `upsert` referencia
  // `excluded.<coluna>` — o Postgres exige leitura da coluna para isso e devolve
  // "permission denied for table organization_settings". Resultado: o token era o ÚNICO campo
  // que NINGUÉM conseguia salvar por esta tela (as 4 organizações estavam com `hasToken: false`
  // desde sempre). Medido em 23/09/2026.
  const { meta_capi_access_token: tokenNovo, ...semToken } = dbUpdates;

  // Esta escrita é a que passa pela RLS (`can_configure`): ela é a PROVA de que este usuário
  // pode configurar esta organização. Sem ela, o passo seguinte não acontece.
  const { error: upsertError } = await supabase
    .from('organization_settings')
    .upsert(semToken, { onConflict: 'organization_id' });
  if (upsertError) return json({ error: upsertError.message }, 500);

  if (tokenNovo !== undefined) {
    // Só agora, e só a coluna ilegível: `update` não referencia `excluded`, e o filtro usa
    // `organization_id`, que o usuário pode ler. Vai pelo cliente administrativo porque a
    // coluna é invisível para `authenticated` — de propósito.
    const admin = createStaticAdminClient();
    const { error: tokenError } = await admin
      .from('organization_settings')
      .update({ meta_capi_access_token: tokenNovo, updated_at: dbUpdates.updated_at })
      .eq('organization_id', auth.targetOrganizationId);
    if (tokenError) return json({ error: tokenError.message }, 500);
  }

  return json({ ok: true });
}
