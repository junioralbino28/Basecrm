// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('C2A — limpeza coerente com dependências de etiquetas', () => {
  it('remove automações antes das etiquetas para não quebrar as novas FKs', () => {
    const source = readFileSync(resolve(
      process.cwd(),
      'features/settings/components/DataStorageSettings.tsx',
    ), 'utf8');
    const automationsDelete = source.indexOf(".from('automations')");
    const tagsDelete = source.indexOf(".from('tags')");

    expect(automationsDelete).toBeGreaterThan(-1);
    expect(tagsDelete).toBeGreaterThan(automationsDelete);
    expect(source.slice(automationsDelete, tagsDelete)).toContain('.delete()');
    expect(source).toContain('Todas as automações e suas execuções');
  });
});
