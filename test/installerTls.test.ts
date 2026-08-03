import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const files = [
  'app/api/installer/health-check/route.ts',
  'lib/installer/migrations.ts',
];

describe('instalador — transporte TLS', () => {
  it.each(files)('%s nunca desativa a validação do certificado', (file) => {
    const source = fs.readFileSync(file, 'utf8');
    expect(source).not.toContain('rejectUnauthorized: false');
    expect(source).toContain('rejectUnauthorized: true');
  });
});
