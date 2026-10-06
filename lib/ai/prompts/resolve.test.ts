// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createFakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';
import { getPromptCatalogMap } from './catalog';
import { buscarPromptResolvido, buscarPromptResolvidoEstrito, escolherPrompt } from './resolve';
import { getResolvedPrompt } from './server';

const ORG = '11111111-1111-4111-8111-111111111111';
const PADRAO = 'task_conversations_whatsapp_auto_reply';

describe('resolução do prompt (regra de sempre, agora num lugar só)', () => {
  it('override ativo com conteúdo vence o catálogo', () => {
    const r = escolherPrompt(PADRAO, { key: PADRAO, content: 'Proprio', version: 3, is_active: true, updated_at: '2026-09-29T00:00:00Z' });
    expect(r).toEqual({ key: PADRAO, content: 'Proprio', source: 'override', version: 3, updatedAt: '2026-09-29T00:00:00Z' });
  });

  it('override vazio cai no catálogo', () => {
    const r = escolherPrompt(PADRAO, { key: PADRAO, content: '', version: 1, is_active: true, updated_at: 'x' });
    expect(r).toEqual({ key: PADRAO, content: getPromptCatalogMap()[PADRAO].defaultTemplate, source: 'default' });
  });

  it('chave fora do catálogo e sem override = null', () => {
    expect(escolherPrompt('task_nao_existe', null)).toBeNull();
  });

  it('falha ao ler o override cai no catálogo, como hoje', async () => {
    const admin = createFakeSupabaseAdmin();
    admin.failOn('ai_prompt_templates', 'select', 'boom');
    const r = await buscarPromptResolvido(admin as never, ORG, PADRAO);
    expect(r?.source).toBe('default');
  });

  it('getResolvedPrompt (servidor) devolve exatamente o mesmo que a função pura', async () => {
    const admin = createFakeSupabaseAdmin({
      ai_prompt_templates: [{ organization_id: ORG, key: PADRAO, content: 'Override X', version: 2, is_active: true, updated_at: 'y' }],
    });
    expect(await getResolvedPrompt(admin as never, ORG, PADRAO)).toEqual(await buscarPromptResolvido(admin as never, ORG, PADRAO));
  });

  it('a leitura estrita lança quando o banco falha (o script nunca cai no catálogo por erro)', async () => {
    const admin = createFakeSupabaseAdmin();
    admin.failOn('ai_prompt_templates', 'select', 'boom');
    await expect(buscarPromptResolvidoEstrito(admin as never, ORG, PADRAO)).rejects.toThrow('boom');
  });

  it('a leitura estrita devolve o mesmo que a tolerante quando o banco responde', async () => {
    const admin = createFakeSupabaseAdmin({
      ai_prompt_templates: [{ organization_id: ORG, key: PADRAO, content: 'Override X', version: 2, is_active: true, updated_at: 'y' }],
    });
    expect(await buscarPromptResolvidoEstrito(admin as never, ORG, PADRAO)).toEqual(await buscarPromptResolvido(admin as never, ORG, PADRAO));
  });
});
