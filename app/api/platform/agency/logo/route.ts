import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { isAgencyAdminRole, normalizeAppUserRole } from '@/lib/auth/scope';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

async function requireAgencyAdminProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: json({ error: 'Unauthorized' }, 401) };

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, role, organization_id')
    .eq('id', user.id)
    .single();

  if (error || !profile?.organization_id) return { error: json({ error: 'Profile not found' }, 404) };
  if (!isAgencyAdminRole(normalizeAppUserRole(profile.role))) return { error: json({ error: 'Forbidden' }, 403) };

  return { profile };
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const auth = await requireAgencyAdminProfile();
  if ('error' in auth) return auth.error;

  const formData = await req.formData().catch(() => null);
  const file = formData?.get('file');

  if (!(file instanceof File)) return json({ error: 'Arquivo nao informado.' }, 400);

  const isPngMime = file.type === 'image/png' || file.type === 'image/x-png';
  const isPngExt = file.name.toLowerCase().endsWith('.png');
  if (!isPngMime && !isPngExt) return json({ error: 'Envie um arquivo PNG.' }, 400);
  if (file.size > 2 * 1024 * 1024) return json({ error: 'O arquivo deve ter no maximo 2MB.' }, 400);

  const bytes = await file.arrayBuffer();
  const admin = createStaticAdminClient();
  const filePath = `agency-branding/${auth.profile.organization_id}.png`;

  const { error: uploadError } = await admin.storage
    .from('avatars')
    .upload(filePath, bytes, { upsert: true, contentType: 'image/png' });

  if (uploadError) return json({ error: uploadError.message }, 500);

  const { data } = admin.storage.from('avatars').getPublicUrl(filePath);
  const logoUrl = `${data.publicUrl}?t=${Date.now()}`;

  return json({ ok: true, logoUrl });
}

