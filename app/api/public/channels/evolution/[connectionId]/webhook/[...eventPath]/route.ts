import { POST as handleWebhook } from '../route';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ connectionId: string; eventPath?: string[] }> }
) {
  const { connectionId } = await ctx.params;
  return handleWebhook(req, {
    params: Promise.resolve({ connectionId }),
  });
}
