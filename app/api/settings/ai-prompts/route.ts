import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { requireAdminTenantContext } from '@/lib/platform/adminTenantContext';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function GET() {
  const supabase = await createClient();
  const auth = await requireAdminTenantContext();
  if ('error' in auth) return auth.error;

  const { data, error } = await supabase
    .from('ai_prompt_templates')
    .select('key, version, is_active, updated_at')
    .eq('organization_id', auth.targetOrganizationId)
    .order('updated_at', { ascending: false });

  if (error) return json({ error: error.message }, 500);

  const activeByKey: Record<string, { version: number; updatedAt: string }> = {};
  for (const row of data || []) {
    if (row.is_active && !activeByKey[row.key]) {
      activeByKey[row.key] = { version: row.version, updatedAt: row.updated_at };
    }
  }

  return json({ activeByKey });
}

const UpsertPromptSchema = z
  .object({
    key: z.string().min(3).max(120),
    content: z.string().min(1).max(50_000),
  })
  .strict();

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const supabase = await createClient();
  const auth = await requireAdminTenantContext();
  if ('error' in auth) return auth.error;

  const rawBody = await req.json().catch(() => null);
  const parsed = UpsertPromptSchema.safeParse(rawBody);
  if (!parsed.success) return json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400);

  const { key, content } = parsed.data;

  const { data: existing, error: existingError } = await supabase
    .from('ai_prompt_templates')
    .select('version')
    .eq('organization_id', auth.targetOrganizationId)
    .eq('key', key)
    .order('version', { ascending: false })
    .limit(1);

  if (existingError) return json({ error: existingError.message }, 500);

  const lastVersion = existing && existing.length > 0 ? (existing[0].version as number) : 0;
  const nextVersion = lastVersion + 1;

  const { error: deactivateError } = await supabase
    .from('ai_prompt_templates')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('organization_id', auth.targetOrganizationId)
    .eq('key', key)
    .eq('is_active', true);

  if (deactivateError) return json({ error: deactivateError.message }, 500);

  const { error: insertError } = await supabase.from('ai_prompt_templates').insert({
    organization_id: auth.targetOrganizationId,
    key,
    version: nextVersion,
    content,
    is_active: true,
    created_by: auth.me.id,
    updated_at: new Date().toISOString(),
  });

  if (insertError) return json({ error: insertError.message }, 500);

  return json({ ok: true, key, version: nextVersion });
}
