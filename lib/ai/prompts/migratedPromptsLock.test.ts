// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getPromptCatalogMap } from './catalog';

type Trava = {
  _leia: string;
  chaves: Record<string, { sha256: string; caracteres: number; agente: string; observacao?: string }>;
};

const trava = JSON.parse(readFileSync(resolve(process.cwd(), 'lib/ai/prompts/migrated-prompts.lock.json'), 'utf8')) as Trava;
const catalogo = getPromptCatalogMap() as Record<string, { defaultTemplate: string }>;
const sha256 = (texto: string) => createHash('sha256').update(texto, 'utf8').digest('hex');

describe('trava das chaves migradas para a Central de Agentes', () => {
  it('lista as três chaves travadas, e as três existem no catálogo (o detector funciona)', () => {
    expect(Object.keys(trava.chaves).sort()).toEqual([
      'task_conversations_whatsapp_auto_reply',
      'task_conversations_whatsapp_cenno_aurora',
      'task_conversations_whatsapp_julia',
    ]);
    for (const [chave, item] of Object.entries(trava.chaves)) {
      expect(catalogo[chave], chave).toBeDefined();
      expect(item.sha256, chave).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it.each(Object.entries(trava.chaves))('%s: o texto do catálogo é o que foi migrado', (chave, item) => {
    const texto = catalogo[chave].defaultTemplate;
    expect(
      sha256(texto),
      `O texto de "${chave}" mudou no catálogo. Os números ligados ao agente (${item.agente}) respondem pela versão publicada na Central de Agentes, não por este texto. ${trava._leia}`,
    ).toBe(item.sha256);
    expect(texto.length, chave).toBe(item.caracteres);
  });

  it('as chaves travadas têm o aviso logo acima, no catálogo', () => {
    const fonte = readFileSync(resolve(process.cwd(), 'lib/ai/prompts/catalog.ts'), 'utf8');
    for (const chave of Object.keys(trava.chaves)) {
      const posicao = fonte.indexOf(`key: '${chave}'`);
      expect(posicao, chave).toBeGreaterThan(-1);
      expect(fonte.slice(Math.max(0, posicao - 600), posicao), `${chave}: falta o aviso logo acima da entrada`).toContain('migratedPromptsLock.test.ts de propósito');
    }
  });
});
