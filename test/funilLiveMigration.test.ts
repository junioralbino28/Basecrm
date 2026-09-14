import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Só o SQL executável (o cabeçalho explica a decisão em prosa).
const sql = () => readFileSync(join(
  process.cwd(), 'supabase', 'migrations',
  '20260913040000_funil_live_envio_real.sql',
), 'utf8')
  .split('\n')
  .filter((linha) => !linha.trimStart().startsWith('--'))
  .join('\n');

const read = (...parts: string[]) =>
  readFileSync(join(process.cwd(), ...parts), 'utf8').replace(/\r\n/g, '\n');

const FUNCOES = [
  'prepare_automation_outbound(uuid)',
  'complete_automation_live(uuid, uuid, text, integer, text, text, text, text)',
  'open_automation_wait_for_job(uuid, text, integer)',
  'execute_automation_create_task(uuid, text, integer)',
  'execute_automation_move_deal(uuid, text, integer)',
  'fail_automation_job_and_pause(uuid, text, integer, text, text)',
  'defer_automation_jobs_before_claim(integer)',
  'record_automation_opt_out(uuid, uuid, uuid, timestamptz, text)',
];

describe('2a/2c — caminho live do motor (migration)', () => {
  it('prepare_automation_outbound mantém o cabeçalho da F4 e só aceita live com a chave do cliente ligada e sem opt-out', () => {
    const s = sql();
    const inicio = s.indexOf('create or replace function public.prepare_automation_outbound(p_job_id uuid)');
    expect(inicio).toBeGreaterThan(-1);
    const fim = s.indexOf('$$;', inicio);
    const corpo = s.slice(inicio, fim);
    expect(corpo).toContain('security definer');
    expect(corpo).toContain("set search_path = ''");
    expect(corpo).toContain("if v_mode = 'live' then");
    expect(corpo).toContain('and settings.automation_live_enabled = true');
    expect(corpo).toContain("message = 'envio real desligado para esta organização'");
    expect(corpo).toContain('and contact.automation_opt_out_at is not null');
    expect(corpo).toContain("message = 'contato pediu para não receber automações'");
    expect(corpo).toContain("elsif v_mode is distinct from 'simulation' then");
    // O que a F4 exigia continua exigido: lease ativo, tentativa running, inscrição ativa com thread.
    expect(corpo).toContain("message = 'job precisa de lease ativo'");
    expect(corpo).toContain("message = 'tentativa do lease não encontrada'");
    expect(corpo).toContain("message = 'inscrição pausada ou inativa'");
  });

  it('complete_automation_live: sent avança; failed segue a aresta "failed" ou pausa; unknown pausa e nunca reenvia', () => {
    const s = sql();
    expect(s).toContain("if p_delivery_status not in ('sent', 'failed', 'unknown') then");
    expect(s).toContain("v_job := public.complete_automation_job(v_job.id, p_lease_owner, p_attempt_count, 'sent', null);");
    expect(s).toContain("'lastOutboundAt', v_now");
    expect(s).toContain("v_job := public.complete_automation_job(v_job.id, p_lease_owner, p_attempt_count, 'unknown', p_error);");
    expect(s).toContain("perform public.pause_automation_enrollments_for_thread(v_message.thread_id, null, 'delivery_unknown');");
    expect(s).toContain("and edge->>'outcome' = 'failed'");
    expect(s).toContain("perform public.advance_automation_enrollment(v_job.enrollment_id, v_job.step_key, 'failed');");
    expect(s).toContain("perform public.pause_automation_enrollments_for_thread(v_message.thread_id, null, 'delivery_failed');");
    expect(s).not.toContain("'retryable_failure'");
  });

  it('a espera fecha o job sem avançar; tarefa e movimentação são idempotentes e avançam por "sent"', () => {
    const s = sql();
    const espera = s.slice(s.indexOf('function public.open_automation_wait_for_job'), s.indexOf('function public.execute_automation_create_task'));
    expect(espera).toContain('v_wait := public.open_automation_wait(');
    expect(espera).not.toContain('complete_automation_job(');
    expect(espera).not.toContain('advance_automation_enrollment(');
    expect(s).toContain("v_marker := 'automation_job:' || v_job.id::text;");
    expect(s).toContain("and task.note like '%' || v_marker || '%'");
    expect(s).toContain('and stage.board_id = v_board_id');
    expect(s).toContain("return public.complete_automation_job(v_job.id, p_lease_owner, p_attempt_count, 'sent', null);");
  });

  it('adiar antes de reservar: só envio live pendente; live desligado +1 h; silêncio noturno até o fim da janela no fuso do cliente', () => {
    const s = sql();
    expect(s).toContain("and job.job_type = 'send_message'");
    expect(s).toContain("and version.definition->>'deliveryMode' = 'live'");
    expect(s).toContain('for update of job skip locked');
    expect(s).toContain("v_reason := 'live_desligado';");
    expect(s).toContain("v_available_at := v_now + interval '1 hour';");
    expect(s).toContain('v_in_quiet := v_local_time >= v_start or v_local_time < v_end;');
    expect(s).toContain("v_reason := 'horario_silencio';");
    expect(s).toContain("v_available_at := greatest(v_next_end, v_now + interval '1 minute');");
  });

  it('opt-out marca o contato uma vez e pausa as inscrições da conversa', () => {
    const s = sql();
    expect(s).toContain('add column if not exists automation_opt_out_at timestamptz;');
    expect(s).toContain('set automation_opt_out_at = coalesce(p_occurred_at, now()),');
    expect(s).toContain("'opt_out:' || left(coalesce(p_keyword, ''), 40)");
  });

  it('só o servidor executa: DEFINER, search_path vazio, EXECUTE só do service_role em todas', () => {
    const s = sql();
    for (const fn of FUNCOES) {
      expect(s, fn).toContain(`revoke all on function public.${fn}`);
      expect(s, fn).toContain(`grant execute on function public.${fn}`);
    }
    expect(s).not.toMatch(/grant execute[^;]*to[^;]*\b(anon|authenticated)\b/i);
    expect(s).not.toContain('security invoker');
  });
});

describe('2a — claim_automation_jobs sem estouro de integer na reconciliação', () => {
  const s = readFileSync(join(
    process.cwd(), 'supabase', 'migrations', '20260913050000_funil_claim_sem_overflow.sql',
  ), 'utf8')
    .split('\n')
    .filter((linha) => !linha.trimStart().startsWith('--'))
    .join('\n');

  it('mantém o cabeçalho da F4 e limita a duração antes do cast', () => {
    expect(s).toContain('create or replace function public.claim_automation_jobs(');
    expect(s).toContain('security definer');
    expect(s).toContain("set search_path = ''");
    expect(s).toContain('2147483647::double precision');
    expect(s).toContain("error = 'lease_expired'");
    expect(s).toContain('for update skip locked');
    expect(s).toContain('revoke all on function public.claim_automation_jobs(text, integer, integer, uuid) from public, anon, authenticated;');
    expect(s).toContain('grant execute on function public.claim_automation_jobs(text, integer, integer, uuid) to service_role;');
  });
});

describe('2a — encaixe do executor no tick e na rota interna', () => {
  it('o tick executa depois de materializar, antes das conversões, sem derrubar o tick', () => {
    const rota = read('app', 'api', 'internal', 'automations', 'tick', 'route.ts');
    expect(rota).toContain('export const maxDuration = 60;');
    expect(rota).toContain("executeDueAutomationJobs({ admin, workerId: `tick:${tickAttemptId}` })");
    const materializou = rota.indexOf("rpc('materialize_automation_jobs'");
    const executou = rota.indexOf('executeDueAutomationJobs({');
    const conversoes = rota.indexOf('dispatchPendingConversionEvents({');
    expect(materializou).toBeGreaterThan(0);
    expect(executou).toBeGreaterThan(materializou);
    expect(conversoes).toBeGreaterThan(executou);
    const bloco = rota.slice(executou - 40, conversoes);
    expect(bloco).toContain('try {');
    expect(bloco).toContain('catch (error)');
    expect(bloco).not.toContain('return json(');
  });

  it('a rota interna de execução usa o Bearer do worker e não aceita tenant no corpo', () => {
    const rota = read('app', 'api', 'internal', 'automations', 'execute', 'route.ts');
    expect(rota).toContain('process.env.AUTOMATION_WORKER_SECRET');
    expect(rota).toContain('.strict()');
    expect(rota).not.toContain('organizationId');
    expect(rota).not.toContain('organization_id');
  });

  it('o executor exige a chave de ambiente, nunca retenta envio e resolve credencial sem devolvê-la', () => {
    const exec = read('lib', 'automations', 'executor.ts');
    expect(exec).toContain("export const AUTOMATION_EXECUTOR_ENV = 'AUTOMATION_LIVE_SENDS_ENABLED';");
    expect(exec).toContain("summary.skippedReason = `${AUTOMATION_EXECUTOR_ENV} desligado; jobs aguardam`;");
    expect(exec).toContain("rpc('defer_automation_jobs_before_claim'");
    expect(exec).toContain("rpc('claim_automation_jobs'");
    expect(exec).not.toContain("'retryable_failure'");
    expect(exec).toContain("const status = isEvolutionDeliveryUnknown(error) ? 'unknown' : 'failed';");
    expect(exec).toContain("error: 'tentativa anterior não concluiu; revisão obrigatória'");
    expect(exec).not.toMatch(/console\.(log|warn|error)\([^)]*apiKey/);
  });
});

describe('2b — rota admin de ligar/desligar o envio real', () => {
  const rota = read('app', 'api', 'settings', 'automations-live', 'route.ts');

  it('só admin, mesma origem no POST, chave pela função de sistema (gate de saúde) e 409 quando o tick não está de pé', () => {
    expect(rota).toContain('requireAdminTenantContext()');
    expect(rota).toContain('if (!isAllowedOrigin(req)) return json({ error: \'Forbidden\' }, 403);');
    expect(rota).toContain("admin.rpc('set_automation_live_enabled'");
    expect(rota).toContain("if (toggled.error.code === '55000') {");
    expect(rota).toContain('}, 409);');
    expect(rota).toContain("admin.rpc('automation_scheduler_health').single()");
    expect(rota).not.toContain('automation_live_enabled:');
  });

  it('silêncio noturno validado (HH:MM, fuso conhecido, começo ≠ fim) e gravado pelo cliente do usuário (RLS)', () => {
    expect(rota).toContain('const TIME_PATTERN = /^([01]\\d|2[0-3]):[0-5]\\d$/;');
    expect(rota).toContain("new Intl.DateTimeFormat('pt-BR', { timeZone: value });");
    expect(rota).toContain('updates.quietHoursStart === updates.quietHoursEnd');
    expect(rota).toContain('const supabase = await createClient();');
  });
});

describe('2c — opt-out é decisão da IA de atendimento, nunca palavra fixa (Junior, 13/09)', () => {
  it('o webhook não detecta palavra de parada; a função e o gate no banco ficam para a IA usar (1a)', () => {
    const rota = read('app', 'api', 'public', 'channels', 'evolution', '[connectionId]', 'webhook', 'route.ts');
    expect(rota).not.toContain('detectAutomationOptOut');
    expect(rota).not.toContain("rpc('record_automation_opt_out'");
    expect(rota).toContain("if (parsed.direction === 'inbound' && threadStatus === 'ai_active') {");

    const s = sql();
    expect(s).toContain('create or replace function public.record_automation_opt_out(');
    expect(s).toContain("message = 'contato pediu para não receber automações'");
  });
});
