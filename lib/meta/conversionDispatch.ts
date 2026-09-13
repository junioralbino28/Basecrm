/**
 * Despachante dos marcos de conversão (3c): pega o que está pendente, aplica as
 * regras (mapa de eventos do cliente, etiqueta do clique, janela de 7 dias) e envia
 * à Meta um evento por vez, gravando o resultado em cada marco.
 *
 * Roda como service_role, chamado pelo tick das automações (a cada 5 min) e pela
 * rota interna de despacho. Nunca lança: cada marco termina em sent / skipped /
 * error / pending-com-retry, e o resumo diz o que aconteceu.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CTWA_ATTRIBUTION_WINDOW_MS,
  buildBusinessMessagingEvent,
  isBusinessMessagingEventName,
  sendBusinessMessagingEvents,
} from './conversionsApi';

type Admin = SupabaseClient;

export const MAX_SEND_ATTEMPTS = 5;

export type ClaimedConversionEvent = {
  id: string;
  organization_id: string;
  deal_id: string;
  contact_id: string | null;
  event_type: 'replied' | 'scheduled' | 'attended' | 'no_show' | 'won';
  occurred_at: string;
  value: number | string | null;
  meta_event_id: string;
  meta_attempts: number;
};

type OrgCapiSettings = {
  organization_id: string;
  meta_capi_enabled: boolean;
  meta_capi_dataset_id: string | null;
  meta_capi_access_token: string | null;
  meta_capi_test_event_code: string | null;
  meta_capi_send_value: boolean;
  meta_capi_event_map: Record<string, unknown> | null;
};

export type DispatchSummary = {
  claimed: number;
  sent: number;
  skipped: number;
  retried: number;
  failed: number;
  reasons: Record<string, number>;
};

export type SkipReason =
  | 'cliente_desligado'
  | 'nao_mapeado'
  | 'nao_enviavel'
  | 'fora_da_janela'
  | 'sem_etiqueta'
  | 'clique_fora_da_janela';

function retryDelaySeconds(attempts: number) {
  // 5, 10, 20, 40 min... com teto de 1 h.
  return Math.min(3600, 300 * 2 ** Math.max(0, attempts - 1));
}

async function findCtwaClid(admin: Admin, event: ClaimedConversionEvent) {
  const porNegocio = await admin
    .from('lead_source_attributions')
    .select('ctwa_clid, observed_at')
    .eq('organization_id', event.organization_id)
    .eq('deal_id', event.deal_id)
    .not('ctwa_clid', 'is', null)
    .order('observed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (porNegocio.error) throw new Error(porNegocio.error.message);
  if (porNegocio.data?.ctwa_clid) return porNegocio.data as { ctwa_clid: string; observed_at: string };

  if (!event.contact_id) return null;
  const porContato = await admin
    .from('lead_source_attributions')
    .select('ctwa_clid, observed_at')
    .eq('organization_id', event.organization_id)
    .eq('contact_id', event.contact_id)
    .not('ctwa_clid', 'is', null)
    .order('observed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (porContato.error) throw new Error(porContato.error.message);
  return porContato.data?.ctwa_clid ? (porContato.data as { ctwa_clid: string; observed_at: string }) : null;
}

export async function dispatchPendingConversionEvents(params: {
  admin: Admin;
  batchLimit?: number;
  leaseSeconds?: number;
  now?: Date;
  fetchImpl?: typeof fetch;
}): Promise<DispatchSummary> {
  const { admin } = params;
  const now = params.now ?? new Date();
  const summary: DispatchSummary = { claimed: 0, sent: 0, skipped: 0, retried: 0, failed: 0, reasons: {} };

  const claimed = await admin.rpc('claim_conversion_events', {
    p_batch_limit: params.batchLimit ?? 50,
    p_lease_seconds: params.leaseSeconds ?? 120,
  });
  if (claimed.error) throw new Error(`Falha ao reservar marcos: ${claimed.error.message}`);
  const raw = claimed.data as unknown;
  const events = (Array.isArray(raw) ? raw : raw ? [raw] : []) as ClaimedConversionEvent[];
  summary.claimed = events.length;
  if (events.length === 0) return summary;

  const organizationIds = Array.from(new Set(events.map((e) => e.organization_id)));
  const settingsResult = await admin
    .from('organization_settings')
    .select(
      'organization_id, meta_capi_enabled, meta_capi_dataset_id, meta_capi_access_token, meta_capi_test_event_code, meta_capi_send_value, meta_capi_event_map'
    )
    .in('organization_id', organizationIds);
  if (settingsResult.error) throw new Error(`Falha ao ler a configuração da Meta: ${settingsResult.error.message}`);
  const settingsByOrg = new Map<string, OrgCapiSettings>();
  for (const row of (settingsResult.data ?? []) as OrgCapiSettings[]) settingsByOrg.set(row.organization_id, row);

  async function complete(
    event: ClaimedConversionEvent,
    status: 'sent' | 'error' | 'skipped' | 'pending',
    extra: { error?: string; skipReason?: SkipReason; retryInSeconds?: number } = {}
  ) {
    const res = await admin.rpc('complete_conversion_event', {
      p_organization_id: event.organization_id,
      p_event_id: event.id,
      p_status: status,
      p_error: extra.error ?? null,
      p_skip_reason: extra.skipReason ?? null,
      p_retry_in_seconds: extra.retryInSeconds ?? null,
    });
    if (res.error) {
      console.warn('[conversões Meta] Falha ao concluir marco', { eventId: event.id, status, error: res.error.message });
    }
  }

  async function skip(event: ClaimedConversionEvent, reason: SkipReason) {
    await complete(event, 'skipped', { skipReason: reason });
    summary.skipped += 1;
    summary.reasons[reason] = (summary.reasons[reason] ?? 0) + 1;
  }

  for (const event of events) {
    try {
      const settings = settingsByOrg.get(event.organization_id);
      const datasetId = settings?.meta_capi_dataset_id?.trim() ?? '';
      const accessToken = settings?.meta_capi_access_token?.trim() ?? '';
      if (!settings?.meta_capi_enabled || !datasetId || !accessToken) {
        await skip(event, 'cliente_desligado');
        continue;
      }

      if (event.event_type === 'no_show') {
        await skip(event, 'nao_enviavel');
        continue;
      }

      const mapped = settings.meta_capi_event_map?.[event.event_type];
      if (!isBusinessMessagingEventName(mapped)) {
        await skip(event, 'nao_mapeado');
        continue;
      }

      const occurredAtMs = new Date(event.occurred_at).getTime();
      if (!Number.isFinite(occurredAtMs) || now.getTime() - occurredAtMs > CTWA_ATTRIBUTION_WINDOW_MS) {
        await skip(event, 'fora_da_janela');
        continue;
      }

      const click = await findCtwaClid(admin, event);
      if (!click) {
        await skip(event, 'sem_etiqueta');
        continue;
      }
      const clickAtMs = new Date(click.observed_at).getTime();
      if (Number.isFinite(clickAtMs) && occurredAtMs - clickAtMs > CTWA_ATTRIBUTION_WINDOW_MS) {
        await skip(event, 'clique_fora_da_janela');
        continue;
      }

      const sendValue = settings.meta_capi_send_value === true && event.event_type === 'won';
      const value = sendValue ? Number(event.value ?? 0) : null;
      const payload = buildBusinessMessagingEvent({
        eventName: mapped,
        occurredAt: event.occurred_at,
        eventId: event.meta_event_id,
        ctwaClid: click.ctwa_clid,
        value,
        currency: 'BRL',
      });

      const result = await sendBusinessMessagingEvents({
        datasetId,
        accessToken,
        events: [payload],
        testEventCode: settings.meta_capi_test_event_code,
        fetchImpl: params.fetchImpl,
      });

      if (result.ok) {
        await complete(event, 'sent');
        summary.sent += 1;
        continue;
      }

      const message = `${result.status ?? 'rede'}${result.code !== null ? `/${result.code}` : ''}: ${result.message}`.slice(0, 500);
      if (result.permanent || event.meta_attempts >= MAX_SEND_ATTEMPTS) {
        await complete(event, 'error', { error: message });
        summary.failed += 1;
      } else {
        await complete(event, 'pending', { error: message, retryInSeconds: retryDelaySeconds(event.meta_attempts) });
        summary.retried += 1;
      }
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      console.warn('[conversões Meta] Marco falhou fora do envio', { eventId: event.id, error: message });
      if (event.meta_attempts >= MAX_SEND_ATTEMPTS) {
        await complete(event, 'error', { error: message });
        summary.failed += 1;
      } else {
        await complete(event, 'pending', { error: message, retryInSeconds: retryDelaySeconds(event.meta_attempts) });
        summary.retried += 1;
      }
    }
  }

  return summary;
}
