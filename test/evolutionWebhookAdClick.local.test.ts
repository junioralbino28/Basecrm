// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createE2AdminClient, loadE2SupabaseConfig } from './helpers/e2Supabase';

// A rota agenda a resposta da IA com `after` e importa o módulo da IA; aqui a IA fica
// desligada na conexão (aiEnabled=false) e nada disso roda, mas o import precisa existir.
vi.mock('next/server', () => ({ after: vi.fn() }));
vi.mock('@/lib/conversations/aiReply', () => ({
  generateConversationAutoReply: vi.fn(),
  executeConversationAIReply: vi.fn(),
}));

import { POST } from '../app/api/public/channels/evolution/[connectionId]/webhook/route';

const config = loadE2SupabaseConfig();
const describeLocal = config ? describe : describe.skip;

const NOME_ORIGEM = 'Anúncio Meta (WhatsApp)';

// Bloco real de um clique, copiado de uma mensagem da Evolution (dataset da Jéssica, 08/09/2026).
const anuncio = {
  body: 'Você acha que já passou da idade para usar aparelho?\n\nMuitos adultos...',
  title: 'Seu sorriso ainda te incomoda? A ortodontia pode ajudar',
  ctwaClid: 'AfgqwIqB3-mpRoYkyPzyPoKC8f1vNZJjqFwQlDzmispEejiL5lMxOjC6uKbelx5BQGw5R',
  mediaUrl: 'https://www.facebook.com/reel/1006666038440643/',
  sourceId: '120250248464550131',
  mediaType: 2,
  sourceApp: 'instagram',
  sourceUrl: 'https://www.instagram.com/p/DZ3U3KwAssH/',
  thumbnail: '/9j/4AAQSkZJRgABAQAAAQABAAD/7QCEUGhvdG9zaG9w',
  sourceType: 'ad',
  showAdAttribution: true,
  clickToWhatsappCall: true,
  greetingMessageBody: '🟢 ONLINE | Seja bem-vindo (a) ao consultório',
  renderLargerThumbnail: true,
};

const outroAnuncio = {
  ...anuncio,
  title: 'Vagas limitadas para casos de facetas em resina',
  ctwaClid: 'AfgL5xfaER5-Y8iB05Vo1oxU32hJBEiTSBZoPGulCDK0-2Uez61qVqNNHNh4qp1NKdFrt',
  sourceId: '120241355317310131',
  sourceUrl: 'https://www.instagram.com/p/DTIz6KhANLj/',
  mediaUrl: 'https://www.facebook.com/reel/1567305581146976/',
};

describeLocal('3a — webhook da Evolution de ponta a ponta: clique de anúncio vira origem no CRM', () => {
  const admin = config ? createE2AdminClient(config) : null;
  const runId = randomUUID();
  const segredo = `segredo-${runId}`;
  const telefone = `5522${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  let organizationId = '';
  let connectionId = '';
  // Cada mensagem ganha um segundo próprio: duas no mesmo segundo empatam em observed_at e a
  // ordem dos toques oscila sob carga (falhou na suíte completa, passava isolado).
  let relogio = Math.floor(Date.now() / 1000) - 120;

  function payload(id: string, texto: string, clique: typeof anuncio | null) {
    relogio += 1;
    return {
      event: 'messages.upsert',
      instance: `clinica-${runId}`,
      data: {
        key: { remoteJid: `${telefone}@s.whatsapp.net`, fromMe: false, id },
        pushName: 'Maria Lead',
        message: { conversation: texto, messageContextInfo: {} },
        ...(clique ? { contextInfo: { mentionedJid: [], externalAdReply: clique } } : {}),
        messageType: 'conversation',
        messageTimestamp: relogio,
        instanceId: runId,
        source: 'android',
      },
    };
  }

  async function postar(body: unknown) {
    const req = new Request(
      `http://localhost:3000/api/public/channels/evolution/${connectionId}/webhook?secret=${segredo}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
    );
    const res = await POST(req, { params: Promise.resolve({ connectionId }) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  async function atribuicoes() {
    const res = await admin!
      .from('lead_source_attributions')
      .select('id, deal_id, contact_id, source_id, ctwa_clid, ad_title, ad_source_id, provenance, channel')
      .eq('organization_id', organizationId)
      .order('observed_at')
      .order('recorded_at');
    if (res.error) throw res.error;
    return res.data;
  }

  async function conversa() {
    const res = await admin!
      .from('conversation_threads')
      .select('id, status, deal_id, metadata')
      .eq('organization_id', organizationId)
      .single();
    if (res.error) throw res.error;
    return res.data as { id: string; status: string; deal_id: string | null; metadata: Record<string, unknown> };
  }

  beforeAll(async () => {
    if (!admin) return;
    const org = await admin.from('organizations').insert({ name: `Ctwa E2E ${runId}` }).select('id').single();
    if (org.error || !org.data) throw org.error;
    organizationId = org.data.id;

    const board = await admin
      .from('boards')
      .insert({ organization_id: organizationId, name: 'Comercial', position: 0 })
      .select('id')
      .single();
    if (board.error || !board.data) throw board.error;
    const stage = await admin
      .from('board_stages')
      .insert({ organization_id: organizationId, board_id: board.data.id, name: 'Novo lead', order: 0 });
    if (stage.error) throw stage.error;

    // 3d: a região do cliente é o DDD 22 (o telefone da fixture começa com 5522).
    const regiao = await admin
      .from('organization_settings')
      .upsert({ organization_id: organizationId, conversion_region_ddds: ['22'] }, { onConflict: 'organization_id' });
    if (regiao.error) throw regiao.error;

    const connection = await admin
      .from('channel_connections')
      .insert({
        organization_id: organizationId,
        provider: 'evolution',
        channel_type: 'whatsapp',
        name: 'Número de teste',
        config: { webhookSecret: segredo, aiEnabled: false, instanceName: `clinica-${runId}` },
      })
      .select('id')
      .single();
    if (connection.error || !connection.data) throw connection.error;
    connectionId = connection.data.id;
  }, 120_000);

  afterAll(async () => {
    if (!admin || !organizationId) return;
    // O webhook registra cada inbound em automation_inbox_events (correlação de esperas),
    // e essa tabela não cai em cascata com a organização.
    const eventos = await admin.from('automation_inbox_events').delete().eq('organization_id', organizationId);
    if (eventos.error) throw eventos.error;
    const cleanup = await admin.from('organizations').delete().eq('id', organizationId);
    if (cleanup.error) throw cleanup.error;
  }, 120_000);

  it('a primeira mensagem de quem clicou no anúncio vira contato, negócio e origem, sem ninguém marcar nada', async () => {
    const { status, body } = await postar(payload('wamid-ad-1', 'Olá! Vi o anúncio e quero agendar', anuncio));
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.deal_id).toBeTruthy();
    expect(body.ad_attribution_error).toBeUndefined();

    const contato = await admin!.from('contacts').select('name, source').eq('organization_id', organizationId).single();
    expect(contato.data).toEqual({ name: 'Maria Lead', source: NOME_ORIGEM });

    const rows = await atribuicoes();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      deal_id: body.deal_id,
      ctwa_clid: anuncio.ctwaClid,
      ad_title: anuncio.title,
      ad_source_id: anuncio.sourceId,
      provenance: 'automatic',
      channel: 'whatsapp',
    });

    const deal = await admin!
      .from('deals')
      .select('first_lead_source_id, last_lead_source_id')
      .eq('id', body.deal_id as string)
      .single();
    expect(deal.data?.first_lead_source_id).toBe(rows[0].source_id);
    expect(deal.data?.last_lead_source_id).toBe(rows[0].source_id);

    const thread = await conversa();
    expect(thread.deal_id).toBe(body.deal_id);
    expect(thread.metadata.firstAdClick).toMatchObject({ ctwaClid: anuncio.ctwaClid, title: anuncio.title, sourceApp: 'instagram' });
    expect(thread.metadata.lastAdClick).toMatchObject({ ctwaClid: anuncio.ctwaClid });
    // IA desligada na conexão: a conversa fica com humano, nada sai automaticamente.
    expect(thread.status).toBe('human_queue');
  });

  it('o mesmo evento reenviado pela Evolution cai no dedupe e não duplica a origem', async () => {
    const { body } = await postar(payload('wamid-ad-1', 'Olá! Vi o anúncio e quero agendar', anuncio));
    expect(body.duplicate).toBe(true);
    expect(await atribuicoes()).toHaveLength(1);
  });

  it('mensagem seguinte sem anúncio não mexe no clique guardado', async () => {
    const { body } = await postar(payload('wamid-txt-2', 'Bom dia, pode ser amanhã?', null));
    expect(body.ok).toBe(true);
    expect(await atribuicoes()).toHaveLength(1);

    const thread = await conversa();
    expect(thread.metadata.firstAdClick).toMatchObject({ ctwaClid: anuncio.ctwaClid });
    expect(thread.metadata.lastAdClick).toMatchObject({ ctwaClid: anuncio.ctwaClid });
  });

  it('um segundo clique, por outro anúncio, vira novo toque: o primeiro fica, o último muda', async () => {
    const { body } = await postar(payload('wamid-ad-3', 'Vi outro anúncio, das facetas', outroAnuncio));
    expect(body.ok).toBe(true);

    const rows = await atribuicoes();
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ ctwa_clid: outroAnuncio.ctwaClid, ad_title: outroAnuncio.title });

    const thread = await conversa();
    expect(thread.metadata.firstAdClick).toMatchObject({ ctwaClid: anuncio.ctwaClid, title: anuncio.title });
    expect(thread.metadata.lastAdClick).toMatchObject({ ctwaClid: outroAnuncio.ctwaClid, title: outroAnuncio.title });
  });

  it('3d: "lead respondeu" só nasce depois de a clínica falar, uma vez por negócio, com a região por DDD', async () => {
    const thread = await conversa();
    const marcos = () =>
      admin!
        .from('deal_conversion_events')
        .select('event_type, meta_status, meta_skip_reason, contact_id')
        .eq('deal_id', thread.deal_id!)
        .eq('event_type', 'replied');

    // Até aqui só houve mensagens do lead: a clínica nunca falou, então não é "resposta".
    expect((await marcos()).data).toHaveLength(0);

    // A clínica responde (mensagem de saída, fromMe = true, entra pelo mesmo webhook).
    const saida = payload('wamid-out-1', 'Olá! Aqui é a clínica, posso ajudar?', null);
    saida.data.key.fromMe = true;
    const respostaSaida = await postar(saida);
    expect(respostaSaida.body.direction).toBe('outbound');
    expect((await marcos()).data).toHaveLength(0);

    // O lead responde → marco "replied", pendente para a Meta (DDD 22 está na região).
    const { body } = await postar(payload('wamid-in-5', 'Pode sim, quero agendar', null));
    expect(body.ok).toBe(true);
    const depois = (await marcos()).data!;
    expect(depois).toHaveLength(1);
    expect(depois[0]).toMatchObject({ meta_status: 'pending', meta_skip_reason: null });
    expect(depois[0].contact_id).toBeTruthy();

    // Outra resposta do lead não duplica.
    await postar(payload('wamid-in-6', 'Amanhã de manhã?', null));
    expect((await marcos()).data).toHaveLength(1);
  });

  it('sem o segredo da conexão, nada entra', async () => {
    const req = new Request(
      `http://localhost:3000/api/public/channels/evolution/${connectionId}/webhook?secret=errado`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload('wamid-x', 'oi', anuncio)) }
    );
    const res = await POST(req, { params: Promise.resolve({ connectionId }) });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await atribuicoes()).toHaveLength(2);
  });
});
