// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** O script roda ao ser importado; este teste lê o código e trava as três peças da liberação da fatia 2. */
const fonte = readFileSync(resolve(process.cwd(), 'scripts/central-agentes/migrar-agentes.ts'), 'utf8');

describe('migrar-agentes: ligar em produção só com o webhook conferido', () => {
  it('a produção está liberada', () => {
    expect(fonte).toMatch(/^const LIGAR_EM_PRODUCAO_LIBERADO = true;$/m);
  });

  it('--ligar passa pelo leitor que confere publicação E webhook, antes e depois de ligar', () => {
    expect(fonte).toMatch(/ligarComConferencia\(admin, ligar, lerPublicacaoEWebhook, commit\)/);
    expect(fonte).not.toMatch(/ligarComConferencia\(admin, ligar, lerPublicacao, commit\)/);
    expect(fonte).toMatch(/conferirWebhookDoNumero\(\{ admin, connectionId: ligar, dominios: ambiente\.dominios \}\)/);
  });

  it('--webhook existe e só lê', () => {
    expect(fonte).toMatch(/const webhook = argumento\('--webhook'\);/);
    expect(fonte).toMatch(/conferirWebhookDoNumero\(\{ admin, connectionId: webhook, dominios: ambiente\.dominios \}\)/);
  });

  it('o modo sai de escolherModo (testada à parte) e --criar em produção exige --somente', () => {
    expect(fonte).toMatch(/const escolhido = escolherModo\(process\.argv\.slice\(2\)\);/);
    expect(fonte).toMatch(/if \(ambiente\.producao && !somente\)/);
    expect(fonte).toMatch(/if \(somente && grupos\.length !== 1\)/);
  });
});
