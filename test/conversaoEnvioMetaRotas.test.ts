// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ler = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf-8').replace(/\r\n/g, '\n');

describe('3c — encaixe do despacho no tick e rotas', () => {
  it('o tick despacha DEPOIS de materializar as automações e nunca cai por causa da Meta', () => {
    const tick = ler('app/api/internal/automations/tick/route.ts');
    const materializeAt = tick.indexOf("rpc('materialize_automation_jobs'");
    const dispatchAt = tick.indexOf('dispatchPendingConversionEvents({ admin, batchLimit: 50 })');
    const completeAt = tick.indexOf("rpc('complete_automation_tick', {\n    p_attempt_token: tickAttemptId,\n    p_http_status: 200");
    expect(materializeAt).toBeGreaterThan(0);
    expect(dispatchAt).toBeGreaterThan(materializeAt);
    expect(completeAt).toBeGreaterThan(dispatchAt);

    const bloco = tick.slice(dispatchAt - 200, completeAt);
    expect(bloco).toContain('try {');
    expect(bloco).toContain('} catch (error) {');
    expect(bloco).not.toContain('return json(');
    expect(tick).toContain('conversions,');
  });

  it('a rota interna de despacho exige o mesmo Bearer do tick e não expõe token nem etiqueta', () => {
    const rota = ler('app/api/internal/conversions/dispatch/route.ts');
    expect(rota).toContain('authorizeAutomationInternalRequest(request, process.env.AUTOMATION_TICK_SECRET)');
    expect(rota).toContain("return json({ error: 'Unauthorized' }, 401)");
    expect(rota).toContain('dispatchPendingConversionEvents({ admin, batchLimit: payload.data.batch_limit ?? 50 })');
    expect(rota).not.toMatch(/access_token|ctwa_clid/);
  });

  it('a rota de configuração é só para admin, mesma origem, e nunca devolve o token cru', () => {
    const rota = ler('app/api/settings/meta-capi/route.ts');
    expect(rota).toContain('requireAdminTenantContext()');
    expect(rota).toContain('isAllowedOrigin(req)');
    expect(rota).toContain('hasToken: Boolean(data?.meta_capi_access_token)');
    expect(rota).toContain('tokenLast4: last4(data?.meta_capi_access_token)');
    expect(rota).not.toMatch(/accessToken: data\?\.meta_capi_access_token/);
    expect(rota).toContain("z.enum(BUSINESS_MESSAGING_EVENT_NAMES)");
    expect(rota).toContain(".upsert(dbUpdates, { onConflict: 'organization_id' })");
  });

  it('o despachante nunca manda telefone, nome ou procedimento: user_data só tem a etiqueta', () => {
    const api = ler('lib/meta/conversionsApi.ts');
    expect(api).toContain('user_data: { ctwa_clid: ctwaClid }');
    expect(api).not.toMatch(/user_data:\s*\{[^}]*(ph|em|fn|ln|phone|email)\b/);
    expect(api).toContain("action_source: 'business_messaging'");
    expect(api).toContain("messaging_channel: 'whatsapp'");
    // O token vai no corpo, nunca na URL.
    expect(api).toContain('access_token: accessToken');
    expect(api).not.toMatch(/events\?access_token/);
  });
});
