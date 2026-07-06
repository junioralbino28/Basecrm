import { z } from 'zod';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { AI_DEFAULT_MODELS } from '@/lib/ai/defaults';
import { requireAdminTenantContext } from '@/lib/platform/adminTenantContext';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

type Provider = 'google' | 'openai' | 'anthropic';

/**
 * Últimos 4 dígitos de uma chave, para exibir "•••• 1234" na UI sem devolver o segredo.
 * Fix do achado C1: o GET NUNCA mais devolve a chave crua ao browser — só last4 + o selo
 * "configurada". Exige >= 8 chars pra nunca vazar uma chave curta inteira (chaves reais
 * têm dezenas de chars; abaixo disso, não expõe nada).
 */
function keyLast4(value: string | null | undefined): string {
  const s = (value ?? '').trim();
  return s.length >= 8 ? s.slice(-4) : '';
}

const UpdateOrgAISettingsSchema = z
  .object({
    aiEnabled: z.boolean().optional(),
    aiProvider: z.enum(['google', 'openai', 'anthropic']).optional(),
    aiModel: z.string().min(1).max(200).optional(),
    aiGoogleKey: z.string().optional(),
    aiOpenaiKey: z.string().optional(),
    aiAnthropicKey: z.string().optional(),
  })
  .strict();

export async function GET() {
  const auth = await requireAdminTenantContext();
  if ('error' in auth) return auth.error;

  // Secrets (ai_*_key) só são legíveis via service-role (M6: coluna revogada de
  // authenticated). A rota já validou que o caller é admin do targetOrganizationId,
  // então ler via admin é autorizado — e a redação por papel (canManageSecrets) segue abaixo.
  const supabase = createStaticAdminClient();
  const { data: orgSettings, error: orgError } = await supabase
    .from('organization_settings')
    .select('ai_enabled, ai_provider, ai_model, ai_google_key, ai_openai_key, ai_anthropic_key')
    .eq('organization_id', auth.targetOrganizationId)
    .maybeSingle();

  if (orgError) return json({ error: orgError.message }, 500);

  const aiEnabled = typeof orgSettings?.ai_enabled === 'boolean' ? orgSettings.ai_enabled : true;
  const canManageSecrets = auth.isAgencyAdmin || auth.isClinicAdmin;

  // Fix C1: a chave crua NUNCA vai pro browser (a IA agora infere no servidor via
  // /api/ai/chat). Ambos os papéis recebem só os booleans "configurada"; o admin
  // ganha também os últimos 4 dígitos pra reconhecer a chave na UI.
  const base = {
    aiEnabled,
    aiProvider: (orgSettings?.ai_provider || 'google') as Provider,
    aiModel: orgSettings?.ai_model || AI_DEFAULT_MODELS.google,
    aiGoogleKey: '',
    aiOpenaiKey: '',
    aiAnthropicKey: '',
    aiHasGoogleKey: Boolean(orgSettings?.ai_google_key),
    aiHasOpenaiKey: Boolean(orgSettings?.ai_openai_key),
    aiHasAnthropicKey: Boolean(orgSettings?.ai_anthropic_key),
  };

  if (!canManageSecrets) {
    return json(base);
  }

  return json({
    ...base,
    aiGoogleKeyLast4: keyLast4(orgSettings?.ai_google_key),
    aiOpenaiKeyLast4: keyLast4(orgSettings?.ai_openai_key),
    aiAnthropicKeyLast4: keyLast4(orgSettings?.ai_anthropic_key),
  });
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) {
    return json({ error: 'Forbidden' }, 403);
  }

  const supabase = await createClient();
  const auth = await requireAdminTenantContext();
  if ('error' in auth) return auth.error;

  const rawBody = await req.json().catch(() => null);
  const parsed = UpdateOrgAISettingsSchema.safeParse(rawBody);
  if (!parsed.success) {
    return json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400);
  }

  const updates = parsed.data;

  const normalizeKey = (value: string | undefined) => {
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  };

  const dbUpdates: Record<string, unknown> = {
    organization_id: auth.targetOrganizationId,
    updated_at: new Date().toISOString(),
  };

  if (updates.aiEnabled !== undefined) dbUpdates.ai_enabled = updates.aiEnabled;
  if (updates.aiProvider !== undefined) dbUpdates.ai_provider = updates.aiProvider;
  if (updates.aiModel !== undefined) dbUpdates.ai_model = updates.aiModel;

  const googleKey = normalizeKey(updates.aiGoogleKey);
  if (googleKey !== undefined) dbUpdates.ai_google_key = googleKey;

  const openaiKey = normalizeKey(updates.aiOpenaiKey);
  if (openaiKey !== undefined) dbUpdates.ai_openai_key = openaiKey;

  const anthropicKey = normalizeKey(updates.aiAnthropicKey);
  if (anthropicKey !== undefined) dbUpdates.ai_anthropic_key = anthropicKey;

  const { error: upsertError } = await supabase
    .from('organization_settings')
    .upsert(dbUpdates, { onConflict: 'organization_id' });

  if (upsertError) {
    return json({ error: upsertError.message }, 500);
  }

  return json({ ok: true });
}
