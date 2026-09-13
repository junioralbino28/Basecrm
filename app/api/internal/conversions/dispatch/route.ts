/**
 * POST /api/internal/conversions/dispatch — despacha os marcos de conversão pendentes
 * para a Meta agora (3c). O tick das automações já faz isto a cada 5 min; esta rota
 * serve para forçar um envio (ensaio, suporte) e para um cron externo, se um dia
 * o tick não estiver de pé.
 *
 * SEGURANÇA: só com o mesmo Bearer do tick (AUTOMATION_TICK_SECRET). Nada de
 * sessão de usuário aqui; a resposta não traz token nem etiqueta.
 */
import { z } from 'zod';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { authorizeAutomationInternalRequest } from '@/lib/automations/internalAuth';
import { dispatchPendingConversionEvents } from '@/lib/meta/conversionDispatch';

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

export async function POST(request: Request) {
  if (!authorizeAutomationInternalRequest(request, process.env.AUTOMATION_TICK_SECRET)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const payload = z
    .object({ batch_limit: z.number().int().min(1).max(200).optional() })
    .safeParse((await request.json().catch(() => null)) ?? {});
  if (!payload.success) {
    return json({ error: 'Parâmetros inválidos.' }, 400);
  }

  const admin = createStaticAdminClient();
  try {
    const summary = await dispatchPendingConversionEvents({ admin, batchLimit: payload.data.batch_limit ?? 50 });
    return json({ ok: true, ...summary });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Falha ao despachar conversões.' }, 500);
  }
}
