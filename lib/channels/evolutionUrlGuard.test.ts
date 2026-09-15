// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  EvolutionUrlRejectedError,
  assertSafeEvolutionUrl,
  isEvolutionUrlRejected,
  isPrivateOrReservedIp,
  validateEvolutionPairForWrite,
  validateEvolutionUrlSyntax,
} from './evolutionUrlGuard';

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
const privateLookup = async () => [
  { address: '93.184.216.34', family: 4 },
  { address: '10.0.0.5', family: 4 },
];
const noPrivate = { allowPrivateHosts: false };

describe('isPrivateOrReservedIp', () => {
  it('bloqueia loopback, privadas, link-local/metadados, CGNAT, documentação e multicast', () => {
    for (const ip of [
      '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
      '100.64.0.1', '0.0.0.0', '192.0.2.10', '198.51.100.1', '203.0.113.7', '224.0.0.1', '255.255.255.255',
      '::1', '::', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1',
      '64:ff9b::192.168.0.1', '2001:db8::1',
    ]) {
      expect(isPrivateOrReservedIp(ip), ip).toBe(true);
    }
  });

  it('libera IP público v4 e v6', () => {
    expect(isPrivateOrReservedIp('93.184.216.34')).toBe(false);
    expect(isPrivateOrReservedIp('172.32.0.1')).toBe(false);
    expect(isPrivateOrReservedIp('2606:2800:220:1:248:1893:25c8:1946')).toBe(false);
    expect(isPrivateOrReservedIp('::ffff:93.184.216.34')).toBe(false);
  });

  it('trata texto que não é IP como reservado (nunca libera por engano)', () => {
    expect(isPrivateOrReservedIp('nao-e-ip')).toBe(true);
    expect(isPrivateOrReservedIp('')).toBe(true);
  });
});

describe('validateEvolutionUrlSyntax', () => {
  it('aceita https e http com domínio público, com porta e barra final', () => {
    expect(validateEvolutionUrlSyntax('https://evolution.example.com/', noPrivate).ok).toBe(true);
    expect(validateEvolutionUrlSyntax('http://evolution.example.com:8080', noPrivate).ok).toBe(true);
  });

  it('recusa protocolo, credencial embutida, vazio e lixo', () => {
    for (const raw of ['ftp://evolution.example.com', 'file:///etc/passwd', 'https://user:pw@evolution.example.com', '', 'evolution', 'javascript:alert(1)']) {
      const check = validateEvolutionUrlSyntax(raw, noPrivate);
      expect(check.ok, raw).toBe(false);
    }
  });

  it('recusa IP literal interno e nomes internos; libera com allowPrivateHosts (testes)', () => {
    for (const raw of ['http://127.0.0.1:8080', 'http://169.254.169.254/latest', 'http://[::1]:8080', 'http://localhost:8080', 'http://evolution.local', 'http://api.internal', 'http://evo']) {
      expect(validateEvolutionUrlSyntax(raw, noPrivate).ok, raw).toBe(false);
      expect(validateEvolutionUrlSyntax(raw, { allowPrivateHosts: true }).ok, `${raw} (liberado)`).toBe(true);
    }
  });
});

describe('assertSafeEvolutionUrl', () => {
  it('passa quando o DNS resolve só para IP público', async () => {
    await expect(assertSafeEvolutionUrl('https://evolution.example.com', { ...noPrivate, lookupHost: publicLookup }))
      .resolves.toBeUndefined();
  });

  it('recusa quando QUALQUER IP resolvido é interno (rebinding/split-horizon)', async () => {
    await expect(assertSafeEvolutionUrl('https://evolution.example.com', { ...noPrivate, lookupHost: privateLookup }))
      .rejects.toThrow(/rede interna/);
  });

  it('recusa host que não resolve, sem virar "entrega desconhecida"', async () => {
    const error = await assertSafeEvolutionUrl('https://nao-existe.example.com', {
      ...noPrivate,
      lookupHost: async () => { throw new Error('ENOTFOUND'); },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EvolutionUrlRejectedError);
    expect(isEvolutionUrlRejected(error)).toBe(true);
    expect((error as Error).message).toMatch(/resolver o nome/);
    expect('deliveryUnknown' in (error as object)).toBe(false);
  });

  it('não consulta DNS para IP literal público nem quando hosts internos estão liberados', async () => {
    let calls = 0;
    const counting = async () => { calls += 1; return [{ address: '93.184.216.34', family: 4 }]; };
    await assertSafeEvolutionUrl('https://93.184.216.34', { ...noPrivate, lookupHost: counting });
    await assertSafeEvolutionUrl('http://127.0.0.1:1234', { allowPrivateHosts: true, lookupHost: counting });
    expect(calls).toBe(0);
  });
});

describe('validateEvolutionPairForWrite (regra do B7 na escrita)', () => {
  it('sem endereço não há o que validar', async () => {
    expect(await validateEvolutionPairForWrite({ apiKey: 'x' }, noPrivate)).toBeNull();
    expect(await validateEvolutionPairForWrite({}, noPrivate)).toBeNull();
  });

  it('endereço sem chave é recusado com mensagem leiga', async () => {
    const message = await validateEvolutionPairForWrite({ apiUrl: 'https://evolution.example.com' }, noPrivate);
    expect(message).toMatch(/informe também a chave/);
  });

  it('endereço interno é recusado mesmo com chave', async () => {
    const message = await validateEvolutionPairForWrite({ apiUrl: 'http://10.0.0.8:8080', apiKey: 'k' }, noPrivate);
    expect(message).toMatch(/rede interna/);
  });

  it('par completo e público passa', async () => {
    expect(await validateEvolutionPairForWrite(
      { apiUrl: 'https://evolution.example.com', apiKey: 'k' },
      { ...noPrivate, lookupHost: publicLookup },
    )).toBeNull();
  });
});
