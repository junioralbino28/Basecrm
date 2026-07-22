import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dealTagsService } from './dealTags';

describe('dealTagsService (C2C — etiquetas controladas, §N1.1)', () => {
  it('expõe só add/remove/set-primary — nunca "salvar a lista" (lição Kommo)', () => {
    expect(typeof dealTagsService.getCatalog).toBe('function');
    expect(typeof dealTagsService.getAssignments).toBe('function');
    expect(typeof dealTagsService.assign).toBe('function');
    expect(typeof dealTagsService.remove).toBe('function');
    expect(typeof dealTagsService.setPrimary).toBe('function');
    expect(typeof dealTagsService.createCategory).toBe('function');
    expect(typeof dealTagsService.createTag).toBe('function');
    expect('setTags' in dealTagsService).toBe(false);
    expect('replaceTags' in dealTagsService).toBe(false);
    expect('update' in dealTagsService).toBe(false);
  });

  it('toda escrita passa pelas RPCs da C2A — nunca insert/update direto', () => {
    const src = readFileSync(resolve(process.cwd(), 'lib/supabase/dealTags.ts'), 'utf-8');
    expect(src).toContain("rpc('assign_deal_tag'");
    expect(src).toContain("rpc('remove_deal_tag'");
    expect(src).toContain("rpc('set_primary_deal_tag'");
    expect(src).toContain("rpc('get_or_create_tag_category'");
    expect(src).toContain("rpc('get_or_create_tag'");
    // Escrever direto nas tabelas driblaria cardinalidade, auditoria e a ponte
    // legacy_value — a RLS até deixaria em alguns cargos, o contrato não.
    expect(src).not.toMatch(/from\('deal_tag_assignments'\)\s*[\s\S]{0,80}\.(insert|update|delete|upsert)\(/);
    expect(src).not.toMatch(/from\('tags'\)\s*[\s\S]{0,80}\.(insert|update|delete|upsert)\(/);
    expect(src).not.toMatch(/from\('tag_categories'\)\s*[\s\S]{0,80}\.(insert|update|delete|upsert)\(/);
  });

  it('sem Supabase configurado retorna erro sem lançar', async () => {
    const catalog = await dealTagsService.getCatalog('00000000-0000-4000-8000-000000000000');
    expect(catalog).toHaveProperty('categories');
    expect(catalog).toHaveProperty('tags');
    expect(catalog).toHaveProperty('error');
    expect(Array.isArray(catalog.categories)).toBe(true);
  });
});
