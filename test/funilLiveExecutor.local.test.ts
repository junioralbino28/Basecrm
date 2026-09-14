// @vitest-environment node
/**
 * 2a/2c — executor live de ponta a ponta no Supabase local, com uma Evolution FALSA em HTTP
 * (servidor Node na porta livre): o executor resolve a credencial da conexão, chama
 * `sendEvolutionTextMessage` de verdade contra o servidor falso e grava o resultado pelas
 * funções reais do motor. Nada sai para a internet.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createE2AdminClient,
  createE2UserClient,
  loadE2SupabaseConfig,
} from './helpers/e2Supabase';
import {
  createFunilTestFixture,
  type FunilTestFixture,
} from './helpers/funilTestFixture';
import { executeDueAutomationJobs } from '@/lib/automations/executor';

const config = loadE2SupabaseConfig();
const describeLocal = config ? describe : describe.skip;

type FakeMode = 'ok' | 'http400' | 'http500' | 'hang';

function hhmmss(minutesOfDay: number): string {
  const m = ((minutesOfDay % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;
}

const ENVIAR: Record<string, unknown> = {
  link_mode: 'copied',
  body_local: 'Olá {{ contato.primeiro_nome | default: "tudo bem" }}',
  message_kind: 'text',
};

describeLocal('2a/2c — executor live no Supabase local (Evolution simulada por HTTP)', () => {
  const admin = config ? createE2AdminClient(config) : null;
  const fixtures: FunilTestFixture[] = [];
  let server: Server;
  let baseUrl = '';
  let fakeMode: FakeMode = 'ok';
  let sequence = 0;
  const requests: Array<{ path: string; apikey: string | undefined; body: Record<string, unknown> }> = [];
  const pendentes: Array<() => void> = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        requests.push({
          path: req.url ?? '',
          apikey: typeof req.headers.apikey === 'string' ? req.headers.apikey : undefined,
          body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
        });
        res.setHeader('content-type', 'application/json');
        if (fakeMode === 'hang') {
          pendentes.push(() => { res.statusCode = 200; res.end('{}'); });
          return;
        }
        if (fakeMode === 'http400') {
          res.statusCode = 400;
          res.end(JSON.stringify({ status: 400, error: 'Bad Request', response: { message: ['numero invalido'] } }));
          return;
        }
        if (fakeMode === 'http500') {
          res.statusCode = 503;
          res.end(JSON.stringify({ message: 'evolution fora do ar' }));
          return;
        }
        sequence += 1;
        res.statusCode = 201;
        res.end(JSON.stringify({
          key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: true, id: `EVO-${sequence}` },
          status: 'PENDING',
        }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    // O executor reserva qualquer job vencido do banco (é um worker). Para as contagens deste
    // arquivo valerem, drena antes o que outros testes ou o seed local deixaram vencido.
    if (admin) {
      await executeDueAutomationJobs({
        admin,
        workerId: 'teste-live-drenagem',
        enabled: true,
        sendText: async () => { throw new Error('drenagem não envia'); },
      });
    }
  });

  afterAll(async () => {
    for (const fechar of pendentes) fechar();
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const fixture of fixtures) await fixture.cleanup();
  }, 180_000);

  // ------------------------------------------------------------------ ajudantes
  function db() {
    if (!admin) throw new Error('admin local ausente');
    return admin;
  }

  async function tickSaudavel() {
    const started = await db().rpc('begin_automation_tick_request');
    expect(started.error).toBeNull();
    const received = await db().rpc('mark_automation_tick_received', { p_attempt_token: started.data });
    expect(received.data).toBe(true);
    const completed = await db().rpc('complete_automation_tick', {
      p_attempt_token: started.data,
      p_http_status: 200,
      p_materialized_count: 0,
      p_error: null,
    });
    expect(completed.data).toBe(true);
  }

  async function ligarLive(organizationId: string) {
    await tickSaudavel();
    const enabled = await db().rpc('set_automation_live_enabled', {
      p_organization_id: organizationId,
      p_enabled: true,
    });
    expect(enabled.error).toBeNull();
    expect(enabled.data).toBe(true);
  }

  async function silencio(organizationId: string, inicioMin: number, fimMin: number) {
    const updated = await db()
      .from('organization_settings')
      .update({
        automation_timezone: 'UTC',
        automation_quiet_hours_start: hhmmss(inicioMin),
        automation_quiet_hours_end: hhmmss(fimMin),
      })
      .eq('organization_id', organizationId);
    expect(updated.error).toBeNull();
  }

  function minutosAgoraUtc() {
    const now = new Date();
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }

  async function silencioLonge(organizationId: string) {
    const agora = minutosAgoraUtc();
    await silencio(organizationId, agora + 120, agora + 180);
  }

  async function conectarCanal(fixture: FunilTestFixture) {
    const updated = await db()
      .from('channel_connections')
      .update({
        config: { instanceName: 'inst-live', apiUrl: baseUrl, apiKey: 'chave-fake', sendMode: 'number_text' },
      })
      .eq('id', fixture.channelConnectionId);
    expect(updated.error).toBeNull();
  }

  async function materializar() {
    const result = await db().rpc('materialize_automation_jobs', { p_batch_limit: 50 });
    expect(result.error).toBeNull();
    return result.data ?? [];
  }

  type Resumo = Awaited<ReturnType<typeof executeDueAutomationJobs>>;

  async function executar(extra: Partial<Parameters<typeof executeDueAutomationJobs>[0]> = {}) {
    return executeDueAutomationJobs({
      admin: db(),
      workerId: 'teste-live',
      enabled: true,
      sendTimeoutMs: 3_000,
      ...extra,
    });
  }

  /**
   * O executor é global (reserva jobs de qualquer organização, inclusive os que outros arquivos
   * da suíte deixam para trás). As contagens deste arquivo olham só os jobs da própria fixture.
   */
  function meus(resumo: Resumo, fixture: FunilTestFixture) {
    const jobs = resumo.jobs.filter((job) => job.organizationId === fixture.organizationId);
    const contagem: Record<string, number> = { claimed: jobs.length };
    for (const job of jobs) contagem[job.outcome] = (contagem[job.outcome] ?? 0) + 1;
    const erros = resumo.errors.filter(
      (erro) => erro.organizationId === fixture.organizationId || erro.jobId === '-',
    );
    return { ...contagem, erros };
  }

  async function jobDe(fixture: FunilTestFixture, stepIndex: number) {
    const job = await db()
      .from('automation_jobs')
      .select('id, status, attempt_count, available_at, last_error, job_type')
      .eq('enrollment_id', fixture.enrollmentId)
      .eq('step_key', fixture.stepKeys[stepIndex])
      .maybeSingle();
    expect(job.error).toBeNull();
    return job.data;
  }

  async function inscricao(fixture: FunilTestFixture) {
    const row = await db()
      .from('automation_enrollments')
      .select('status, current_step_key, pause_reason, paused_from_status')
      .eq('id', fixture.enrollmentId)
      .single();
    expect(row.error).toBeNull();
    return row.data!;
  }

  async function mensagemDoJob(jobId: string) {
    const row = await db()
      .from('conversation_messages')
      .select('delivery_status, provider_message_id, delivery_attempt, delivery_error, delivery_source, metadata, content')
      .eq('automation_job_id', jobId)
      .maybeSingle();
    expect(row.error).toBeNull();
    return row.data;
  }

  async function criarFixtureLive(params: Parameters<typeof createFunilTestFixture>[0]) {
    const fixture = await createFunilTestFixture({ ...params, deliveryMode: 'live' });
    fixtures.push(fixture);
    await conectarCanal(fixture);
    await silencioLonge(fixture.organizationId);
    return fixture;
  }

  // ------------------------------------------------------------------ funil completo
  let funil: FunilTestFixture;

  it('executor desligado por ambiente não adia nem reserva nada', async () => {
    funil = await criarFixtureLive({
      admin: db(),
      label: 'live funil',
      extraStageNames: ['Agendado'],
      steps: ({ boardId, stageIdsByName }) => [
        { type: 'send_message', config: ENVIAR },
        { type: 'wait_for_event', config: { timeout_amount: 1, timeout_unit: 'minutes' } },
        { type: 'create_task', config: { title: 'Ligar para o lead', due_in_minutes: 60 } },
        { type: 'move_stage', config: { board_id: boardId, stage_id: stageIdsByName.Agendado } },
        { type: 'send_message', config: { ...ENVIAR, body_local: 'Ainda tem interesse?' } },
      ],
      edges: [
        { from: 0, to: 1, outcome: 'success' },
        { from: 1, to: 2, outcome: 'answered' },
        { from: 2, to: 3, outcome: 'success' },
        { from: 1, to: 4, outcome: 'timeout' },
      ],
    });
    await materializar();
    const antes = await jobDe(funil, 0);
    expect(antes?.status).toBe('pending');

    const resumo = await executar({ enabled: false });
    expect(resumo.enabled).toBe(false);
    expect(resumo.skippedReason).toContain('AUTOMATION_LIVE_SENDS_ENABLED');
    expect(resumo.claimed).toBe(0);
    const depois = await jobDe(funil, 0);
    expect(depois).toMatchObject({ status: 'pending', attempt_count: 0 });
    expect(requests).toHaveLength(0);
  }, 120_000);

  it('live desligado na organização adia o envio uma hora antes da reserva, sem gastar tentativa', async () => {
    const deferred = await db().rpc('defer_automation_jobs_before_claim', { p_batch_limit: 200 });
    expect(deferred.error).toBeNull();
    const job = await jobDe(funil, 0);
    const linha = (deferred.data as Array<{ job_id: string; reason: string; available_at: string }>)
      .find((row) => row.job_id === job?.id);
    expect(linha?.reason).toBe('live_desligado');
    expect(new Date(linha!.available_at).getTime()).toBeGreaterThan(Date.now() + 55 * 60_000);
    expect(job).toMatchObject({ status: 'pending', attempt_count: 0 });

    const resumo = await executar();
    expect(meus(resumo, funil)).toMatchObject({ claimed: 0, erros: [] });
    expect(requests).toHaveLength(0);

    const reset = await db().from('automation_jobs').update({ available_at: new Date(Date.now() - 1000).toISOString() }).eq('id', job!.id);
    expect(reset.error).toBeNull();
  });

  it('silêncio noturno adia o envio até o fim da janela no fuso do cliente', async () => {
    await ligarLive(funil.organizationId);
    const agora = minutosAgoraUtc();
    await silencio(funil.organizationId, agora - 60, agora + 60);

    const deferred = await db().rpc('defer_automation_jobs_before_claim', { p_batch_limit: 200 });
    expect(deferred.error).toBeNull();
    const job = await jobDe(funil, 0);
    const linha = (deferred.data as Array<{ job_id: string; reason: string; available_at: string }>)
      .find((row) => row.job_id === job?.id);
    expect(linha?.reason).toBe('horario_silencio');

    const fimEsperado = new Date();
    fimEsperado.setUTCHours(Math.floor((((agora + 60) % 1440) + 1440) % 1440 / 60), (agora + 60) % 60, 0, 0);
    if (fimEsperado.getTime() <= Date.now()) fimEsperado.setUTCDate(fimEsperado.getUTCDate() + 1);
    expect(Math.abs(new Date(linha!.available_at).getTime() - fimEsperado.getTime())).toBeLessThan(2 * 60_000);
    expect(job?.attempt_count).toBe(0);

    await silencioLonge(funil.organizationId);
    const reset = await db().from('automation_jobs').update({ available_at: new Date(Date.now() - 1000).toISOString() }).eq('id', job!.id);
    expect(reset.error).toBeNull();
  });

  it('manda a mensagem real, grava o id do provedor, avança e abre a espera citando a mensagem enviada', async () => {
    const resumo = await executar();
    expect(meus(resumo, funil)).toEqual({ claimed: 1, sent: 1, erros: [] });

    expect(requests).toHaveLength(1);
    expect(requests[0].path).toBe('/message/sendText/inst-live');
    expect(requests[0].apikey).toBe('chave-fake');
    expect(requests[0].body).toEqual({ number: '5511999999999', text: 'Olá Maria' });

    const job = await jobDe(funil, 0);
    expect(job?.status).toBe('sent');
    const mensagem = await mensagemDoJob(job!.id);
    expect(mensagem).toMatchObject({
      delivery_status: 'sent',
      provider_message_id: 'EVO-1',
      delivery_attempt: 'sendText:number+text',
      delivery_source: 'automation',
      delivery_error: null,
      content: 'Olá Maria',
    });
    expect((mensagem?.metadata as Record<string, unknown>).delivery_mode).toBe('live');

    const thread = await db().from('conversation_threads').select('metadata').eq('id', funil.threadId).single();
    const meta = thread.data?.metadata as Record<string, unknown>;
    expect(meta.lastDirection).toBe('outbound');
    expect(typeof meta.lastOutboundAt).toBe('string');

    expect(await inscricao(funil)).toMatchObject({ status: 'active', current_step_key: funil.stepKeys[1] });

    // O tick materializa o passo seguinte (a espera); o executor abre a espera sem avançar.
    await materializar();
    const resumoEspera = await executar();
    expect(meus(resumoEspera, funil)).toEqual({ claimed: 1, waiting: 1, erros: [] });
    expect(await jobDe(funil, 1)).toMatchObject({ status: 'sent' });
    const wait = await db()
      .from('automation_waits')
      .select('status, outbound_provider_message_id, expires_at')
      .eq('enrollment_id', funil.enrollmentId)
      .single();
    expect(wait.error).toBeNull();
    expect(wait.data).toMatchObject({ status: 'pending', outbound_provider_message_id: 'EVO-1' });
    const expira = new Date(wait.data!.expires_at).getTime() - Date.now();
    expect(expira).toBeGreaterThan(30_000);
    expect(expira).toBeLessThan(90_000);
    expect(await inscricao(funil)).toMatchObject({ status: 'waiting', current_step_key: funil.stepKeys[1] });

    // Esperando, o tick não cria job nenhum.
    await materializar();
    const jobs = await db().from('automation_jobs').select('id', { count: 'exact', head: true }).eq('enrollment_id', funil.enrollmentId);
    expect(jobs.count).toBe(2);
    expect(requests).toHaveLength(1);
  }, 120_000);

  it('a resposta do lead fecha a espera; o funil cria a tarefa, move o negócio de etapa e termina', async () => {
    const agora = new Date().toISOString();
    const inbound = await db()
      .from('conversation_messages')
      .insert({
        thread_id: funil.threadId,
        organization_id: funil.organizationId,
        channel_connection_id: funil.channelConnectionId,
        direction: 'inbound',
        message_type: 'text',
        author_name: 'Maria',
        content: 'quero sim',
        provider_message_id: 'IN-1',
        delivery_status: 'sent',
        sent_at: agora,
        created_at: agora,
      })
      .select('id')
      .single();
    expect(inbound.error).toBeNull();

    const resolved = await db().rpc('resolve_automation_wait_from_inbox', {
      p_channel_connection_id: funil.channelConnectionId,
      p_provider_message_id: 'IN-1',
      p_thread_id: funil.threadId,
      p_message_id: inbound.data!.id,
      p_quoted_provider_message_id: null,
      p_received_at: agora,
    });
    expect(resolved.error).toBeNull();
    expect((resolved.data as Array<{ resolution: string; duplicate: boolean }>)[0]).toMatchObject({ duplicate: false });
    expect(await inscricao(funil)).toMatchObject({ status: 'active', current_step_key: funil.stepKeys[2] });

    // Tarefa
    await materializar();
    const resumoTarefa = await executar();
    expect(meus(resumoTarefa, funil)).toEqual({ claimed: 1, tasks: 1, erros: [] });
    const jobTarefa = await jobDe(funil, 2);
    expect(jobTarefa?.status).toBe('sent');
    const tarefa = await db()
      .from('tasks')
      .select('title, status, note, contact_id, due_time, type')
      .eq('organization_id', funil.organizationId)
      .single();
    expect(tarefa.error).toBeNull();
    expect(tarefa.data).toMatchObject({ title: 'Ligar para o lead', status: 'open', contact_id: funil.contactId, type: 'reminder' });
    expect(tarefa.data?.note).toContain(`automation_job:${jobTarefa!.id}`);
    expect(tarefa.data?.due_time).not.toBeNull();
    expect(await inscricao(funil)).toMatchObject({ status: 'active', current_step_key: funil.stepKeys[3] });

    // Mover etapa → último passo → funil concluído
    await materializar();
    const resumoMover = await executar();
    expect(meus(resumoMover, funil)).toEqual({ claimed: 1, moved: 1, erros: [] });
    const deal = await db().from('deals').select('stage_id, board_id').eq('id', funil.dealId).single();
    expect(deal.data).toEqual({ stage_id: funil.stageIdsByName.Agendado, board_id: funil.boardId });
    expect(await inscricao(funil)).toMatchObject({ status: 'done' });

    // Nada mais a fazer: o passo de timeout nunca nasceu.
    await materializar();
    expect(await jobDe(funil, 4)).toBeNull();
    expect(meus(await executar(), funil)).toMatchObject({ claimed: 0 });
    expect(requests).toHaveLength(1);
  }, 120_000);

  // ------------------------------------------------------------------ falhas
  it('falha definitiva (4xx) sem aresta "Falhou o envio": mensagem failed, job dead-letter, conversa pausada', async () => {
    const fixture = await criarFixtureLive({ admin: db(), label: 'live 4xx', steps: [{ type: 'send_message', config: ENVIAR }] });
    await ligarLive(fixture.organizationId);
    await materializar();
    fakeMode = 'http400';
    const antes = requests.length;

    const resumo = await executar();
    expect(meus(resumo, fixture)).toEqual({ claimed: 1, failed: 1, erros: [] });
    // Em 4xx a biblioteca da Evolution tenta os 4 formatos de corpo antes de desistir
    // (em 5xx para na primeira, porque o resultado é desconhecido). Uma mensagem, 4 POSTs.
    expect(requests.length).toBe(antes + 4);
    expect(new Set(requests.slice(antes).map((r) => r.path))).toEqual(new Set(['/message/sendText/inst-live']));
    const job = await jobDe(fixture, 0);
    expect(job?.status).toBe('dead_letter');
    const mensagem = await mensagemDoJob(job!.id);
    expect(mensagem?.delivery_status).toBe('failed');
    expect(mensagem?.provider_message_id).toBeNull();
    expect(mensagem?.delivery_error).toContain('numero invalido');
    expect(await inscricao(fixture)).toMatchObject({ status: 'paused', pause_reason: 'delivery_failed', paused_from_status: 'active' });
  }, 120_000);

  it('falha definitiva (4xx) COM aresta "Falhou o envio": o funil segue por ela', async () => {
    const fixture = await criarFixtureLive({
      admin: db(),
      label: 'live 4xx aresta',
      steps: [
        { type: 'send_message', config: ENVIAR },
        { type: 'create_task', config: { title: 'Número inválido: ligar' } },
      ],
      edges: [{ from: 0, to: 1, outcome: 'failed' }],
    });
    await ligarLive(fixture.organizationId);
    await materializar();
    fakeMode = 'http400';

    const resumo = await executar();
    expect(meus(resumo, fixture)).toEqual({ claimed: 1, failed: 1, erros: [] });
    expect(await jobDe(fixture, 0)).toMatchObject({ status: 'dead_letter' });
    expect(await inscricao(fixture)).toMatchObject({ status: 'active', current_step_key: fixture.stepKeys[1] });

    await materializar();
    const resumoTarefa = await executar();
    expect(meus(resumoTarefa, fixture)).toEqual({ claimed: 1, tasks: 1, erros: [] });
    const tarefa = await db().from('tasks').select('title, due_time').eq('organization_id', fixture.organizationId).single();
    expect(tarefa.data).toMatchObject({ title: 'Número inválido: ligar', due_time: null });
    expect(await inscricao(fixture)).toMatchObject({ status: 'done' });
  }, 120_000);

  it('entrega desconhecida (5xx) pausa a conversa e o job nunca é reenviado', async () => {
    const fixture = await criarFixtureLive({ admin: db(), label: 'live 5xx', steps: [{ type: 'send_message', config: ENVIAR }] });
    await ligarLive(fixture.organizationId);
    await materializar();
    fakeMode = 'http500';
    const antes = requests.length;

    const resumo = await executar();
    expect(meus(resumo, fixture)).toEqual({ claimed: 1, unknown: 1, erros: [] });
    expect(requests.length).toBe(antes + 1);
    const job = await jobDe(fixture, 0);
    expect(job?.status).toBe('unknown');
    expect((await mensagemDoJob(job!.id))?.delivery_status).toBe('unknown');
    expect(await inscricao(fixture)).toMatchObject({ status: 'paused', pause_reason: 'delivery_unknown' });

    const denovo = await executar();
    expect(meus(denovo, fixture)).toMatchObject({ claimed: 0 });
    expect(requests.length).toBe(antes + 1);
  }, 120_000);

  it('Evolution sem resposta dentro do tempo limite vira entrega desconhecida', async () => {
    const fixture = await criarFixtureLive({ admin: db(), label: 'live timeout', steps: [{ type: 'send_message', config: ENVIAR }] });
    await ligarLive(fixture.organizationId);
    await materializar();
    fakeMode = 'hang';

    const resumo = await executar({ sendTimeoutMs: 400 });
    expect(meus(resumo, fixture)).toEqual({ claimed: 1, unknown: 1, erros: [] });
    const job = await jobDe(fixture, 0);
    const mensagem = await mensagemDoJob(job!.id);
    expect(mensagem?.delivery_status).toBe('unknown');
    expect(mensagem?.delivery_error).toContain('sem resposta da Evolution');
    for (const fechar of pendentes.splice(0)) fechar();
    fakeMode = 'ok';
  }, 120_000);

  // ------------------------------------------------------------------ opt-out
  it('contato com opt-out: o banco recusa o envio real, o job morre e a conversa é pausada com o motivo', async () => {
    const fixture = await criarFixtureLive({ admin: db(), label: 'live optout banco', steps: [{ type: 'send_message', config: ENVIAR }] });
    await ligarLive(fixture.organizationId);
    await materializar();
    const marcado = await db().from('contacts').update({ automation_opt_out_at: new Date().toISOString() }).eq('id', fixture.contactId);
    expect(marcado.error).toBeNull();
    const antes = requests.length;

    const resumo = await executar();
    expect(meus(resumo, fixture)).toEqual({ claimed: 1, failed: 1, erros: [] });
    expect(requests.length).toBe(antes);
    const job = await jobDe(fixture, 0);
    expect(job).toMatchObject({ status: 'dead_letter' });
    expect(job?.last_error).toContain('não receber');
    expect(await mensagemDoJob(job!.id)).toBeNull();
    expect(await inscricao(fixture)).toMatchObject({ status: 'paused', pause_reason: 'opt_out' });
  }, 120_000);

  it('"PARAR" pela função: marca o contato uma vez, pausa a inscrição, e o job pendente morre sem enviar', async () => {
    const fixture = await criarFixtureLive({ admin: db(), label: 'live optout funcao', steps: [{ type: 'send_message', config: ENVIAR }] });
    await ligarLive(fixture.organizationId);
    await materializar();
    const agora = new Date().toISOString();

    const optOut = await db().rpc('record_automation_opt_out', {
      p_organization_id: fixture.organizationId,
      p_contact_id: fixture.contactId,
      p_thread_id: fixture.threadId,
      p_occurred_at: agora,
      p_keyword: 'PARAR',
    });
    expect(optOut.error).toBeNull();
    expect((optOut.data as Array<Record<string, unknown>>)[0]).toMatchObject({ already: false, paused_enrollments: 1 });
    const contato = await db().from('contacts').select('automation_opt_out_at').eq('id', fixture.contactId).single();
    expect(contato.data?.automation_opt_out_at).not.toBeNull();
    expect(await inscricao(fixture)).toMatchObject({ status: 'paused', pause_reason: 'opt_out:PARAR' });

    const repetido = await db().rpc('record_automation_opt_out', {
      p_organization_id: fixture.organizationId,
      p_contact_id: fixture.contactId,
      p_thread_id: fixture.threadId,
      p_occurred_at: new Date().toISOString(),
      p_keyword: 'SAIR',
    });
    expect((repetido.data as Array<Record<string, unknown>>)[0]).toMatchObject({ already: true, paused_enrollments: 0 });
    const contatoDepois = await db().from('contacts').select('automation_opt_out_at').eq('id', fixture.contactId).single();
    expect(contatoDepois.data?.automation_opt_out_at).toBe(contato.data?.automation_opt_out_at);

    const antes = requests.length;
    const resumo = await executar();
    expect(meus(resumo, fixture)).toEqual({ claimed: 1, failed: 1, erros: [] });
    expect(requests.length).toBe(antes);
    expect(await jobDe(fixture, 0)).toMatchObject({ status: 'dead_letter' });
    expect(await inscricao(fixture)).toMatchObject({ status: 'paused', pause_reason: 'opt_out:PARAR' });
  }, 120_000);

  it('anônimo não executa nenhuma função do caminho live', async () => {
    if (!config) throw new Error('config local ausente');
    const anon = createE2UserClient(config);
    const bloqueadas = [
      anon.rpc('defer_automation_jobs_before_claim', { p_batch_limit: 10 }),
      anon.rpc('complete_automation_live', {
        p_job_id: '00000000-0000-4000-8000-000000000000',
        p_message_id: '00000000-0000-4000-8000-000000000000',
        p_lease_owner: 'x',
        p_attempt_count: 1,
        p_delivery_status: 'sent',
      }),
      anon.rpc('record_automation_opt_out', {
        p_organization_id: '00000000-0000-4000-8000-000000000000',
        p_contact_id: '00000000-0000-4000-8000-000000000000',
        p_thread_id: null,
        p_occurred_at: new Date().toISOString(),
        p_keyword: 'PARAR',
      }),
    ];
    for (const resultado of await Promise.all(bloqueadas)) {
      expect(resultado.error?.code).toBe('42501');
    }
  });
});
