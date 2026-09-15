import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Guarda de destino da Evolution (parecer do Codex, B7 — gates G26 SSRF/egress, G13, G22).
 *
 * Todo endereço que o CRM chama com a chave `apikey` passa por aqui ANTES do fetch:
 * só http(s), sem usuário/senha, nome de host com domínio e que não seja interno, e IP
 * (literal ou resolvido por DNS) fora das faixas privadas, de loopback, link-local, multicast,
 * de documentação e de metadados de nuvem. Redirecionamentos são proibidos no fetch.
 *
 * Liberação de host interno existe SÓ para os testes locais, em que a Evolution é um servidor
 * falso em 127.0.0.1 (`EVOLUTION_ALLOW_PRIVATE_HOSTS=true`). Nunca ligar isso na Vercel.
 *
 * Limite conhecido: a checagem de DNS acontece antes do fetch e o fetch resolve de novo
 * (janela de "rebinding"). Fechar isso exige fixar o IP resolvido no agente HTTP; fica como
 * dívida registrada no IMPL-LOG.
 */
export class EvolutionUrlRejectedError extends Error {
  readonly evolutionUrlRejected = true;

  constructor(reason: string) {
    super(`Endereço da Evolution recusado: ${reason}`);
    this.name = 'EvolutionUrlRejectedError';
  }
}

export function isEvolutionUrlRejected(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'evolutionUrlRejected' in error
    && (error as { evolutionUrlRejected?: unknown }).evolutionUrlRejected === true,
  );
}

export type LookupAddress = { address: string; family: number };
export type HostLookup = (hostname: string, options: { all: true }) => Promise<LookupAddress[]>;

export type EvolutionUrlGuardOptions = {
  /** Libera IP/nome interno (testes locais). Padrão: `EVOLUTION_ALLOW_PRIVATE_HOSTS`. */
  allowPrivateHosts?: boolean;
  /** Resolução de nome injetável (testes). Padrão: `dns.promises.lookup`. */
  lookupHost?: HostLookup;
};

export function allowPrivateHostsFromEnv(): boolean {
  const value = (process.env.EVOLUTION_ALLOW_PRIVATE_HOSTS ?? '').trim().toLowerCase();
  return value === 'true' || value === '1';
}

// ---------------------------------------------------------------------------------------------
// IPv4
// ---------------------------------------------------------------------------------------------

function ipv4ToNumber(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** Faixas que nunca são um servidor público da Evolution. */
const PRIVATE_IPV4_RANGES: Array<[base: string, bits: number]> = [
  ['0.0.0.0', 8], // "esta rede"
  ['10.0.0.0', 8], // privada
  ['100.64.0.0', 10], // CGNAT (compartilhada)
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (inclui 169.254.169.254, metadados de nuvem)
  ['172.16.0.0', 12], // privada
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentação (TEST-NET-1)
  ['192.168.0.0', 16], // privada
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentação (TEST-NET-2)
  ['203.0.113.0', 24], // documentação (TEST-NET-3)
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reservada + broadcast
];

function ipv4InRange(value: number, base: number, bits: number): boolean {
  const mask = bits === 0 ? 0 : ((0xffffffff << (32 - bits)) >>> 0);
  return ((value & mask) >>> 0) === ((base & mask) >>> 0);
}

function isPrivateIpv4Number(value: number): boolean {
  return PRIVATE_IPV4_RANGES.some(([base, bits]) => {
    const baseNumber = ipv4ToNumber(base);
    return baseNumber !== null && ipv4InRange(value, baseNumber, bits);
  });
}

// ---------------------------------------------------------------------------------------------
// IPv6
// ---------------------------------------------------------------------------------------------

function parseIpv6Groups(ip: string): number[] | null {
  let text = ip.toLowerCase().split('%')[0] ?? '';
  // Cauda em IPv4 (`::ffff:127.0.0.1`, `64:ff9b::10.0.0.1`) vira dois grupos hexadecimais.
  if (text.includes('.')) {
    const lastColon = text.lastIndexOf(':');
    const tail = ipv4ToNumber(text.slice(lastColon + 1));
    if (tail === null) return null;
    text = `${text.slice(0, lastColon + 1)}${((tail >>> 16) & 0xffff).toString(16)}:${(tail & 0xffff).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [
    ...head,
    ...(halves.length === 2 ? new Array<string>(missing).fill('0') : []),
    ...tail,
  ].map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : Number.NaN));
  if (groups.length !== 8 || groups.some((group) => Number.isNaN(group))) return null;
  return groups;
}

function isPrivateIpv6Groups(groups: number[]): boolean {
  const zerosUpTo = (count: number) => groups.slice(0, count).every((group) => group === 0);
  const embeddedIpv4 = () => (((groups[6] << 16) >>> 0) | groups[7]) >>> 0;

  if (groups.every((group) => group === 0)) return true; // :: (não especificado)
  if (zerosUpTo(7) && groups[7] === 1) return true; // ::1 loopback
  if (zerosUpTo(5) && groups[5] === 0xffff) return isPrivateIpv4Number(embeddedIpv4()); // ::ffff:a.b.c.d
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0)) {
    return isPrivateIpv4Number(embeddedIpv4()); // 64:ff9b::/96 (NAT64)
  }
  if ((groups[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 (ULA)
  if ((groups[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 (link-local)
  if ((groups[0] & 0xff00) === 0xff00) return true; // ff00::/8 (multicast)
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return true; // 2001:db8::/32 (documentação)
  return false;
}

/** `true` para IP privado, local, reservado ou inválido. Só `false` para IP público válido. */
export function isPrivateOrReservedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const value = ipv4ToNumber(ip);
    return value === null ? true : isPrivateIpv4Number(value);
  }
  if (kind === 6) {
    const groups = parseIpv6Groups(ip);
    return groups === null ? true : isPrivateIpv6Groups(groups);
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Nome de host
// ---------------------------------------------------------------------------------------------

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata',
  'metadata.google.internal',
  'instance-data',
]);
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.lan', '.intranet'];

export type EvolutionUrlSyntaxCheck =
  | { ok: true; url: URL; hostname: string; literalIp: string | null }
  | { ok: false; reason: string };

/**
 * Checagem síncrona (sem rede): protocolo, credenciais embutidas, nome interno e IP literal.
 * A checagem de DNS fica em `assertSafeEvolutionUrl`.
 */
export function validateEvolutionUrlSyntax(
  raw: string,
  options: { allowPrivateHosts?: boolean } = {},
): EvolutionUrlSyntaxCheck {
  const allowPrivateHosts = options.allowPrivateHosts ?? allowPrivateHostsFromEnv();
  const text = (raw ?? '').trim();
  if (!text) return { ok: false, reason: 'endereço vazio' };

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: 'não é um endereço válido (use algo como https://evolution.seudominio.com)' };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: 'só http:// ou https:// são aceitos' };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'o endereço não pode carregar usuário e senha' };
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (!hostname) return { ok: false, reason: 'endereço sem host' };

  const literalIp = isIP(hostname) ? hostname : null;
  if (literalIp) {
    if (!allowPrivateHosts && isPrivateOrReservedIp(literalIp)) {
      return { ok: false, reason: 'o endereço aponta para a rede interna (IP privado, local ou de metadados)' };
    }
    return { ok: true, url, hostname, literalIp };
  }

  if (!allowPrivateHosts) {
    if (BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
      return { ok: false, reason: 'o endereço aponta para um nome interno' };
    }
    if (!hostname.includes('.')) {
      return { ok: false, reason: 'o host precisa ter um domínio completo (ex.: evolution.seudominio.com)' };
    }
  }

  return { ok: true, url, hostname, literalIp: null };
}

/**
 * Checagem completa: sintaxe + resolução de DNS com todos os IPs fora das faixas internas.
 * Lança `EvolutionUrlRejectedError` (nunca "entrega desconhecida": acontece antes de qualquer POST).
 */
export async function assertSafeEvolutionUrl(
  raw: string,
  options: EvolutionUrlGuardOptions = {},
): Promise<void> {
  const allowPrivateHosts = options.allowPrivateHosts ?? allowPrivateHostsFromEnv();
  const syntax = validateEvolutionUrlSyntax(raw, { allowPrivateHosts });
  if (!syntax.ok) throw new EvolutionUrlRejectedError(syntax.reason);
  if (allowPrivateHosts || syntax.literalIp) return;

  const lookupHost: HostLookup = options.lookupHost ?? ((hostname, opts) => dnsLookup(hostname, opts));
  let addresses: LookupAddress[];
  try {
    addresses = await lookupHost(syntax.hostname, { all: true });
  } catch {
    throw new EvolutionUrlRejectedError('não foi possível resolver o nome do host');
  }
  if (!addresses.length) throw new EvolutionUrlRejectedError('o nome do host não resolve para nenhum IP');
  if (addresses.some((entry) => isPrivateOrReservedIp(entry.address))) {
    throw new EvolutionUrlRejectedError('o nome do host aponta para a rede interna');
  }
}

/**
 * Regra de escrita da configuração de uma conexão (B7): endereço próprio só com a chave própria.
 * Devolve a mensagem de erro em linguagem leiga, ou `null` quando pode gravar.
 */
export async function validateEvolutionPairForWrite(
  config: { apiUrl?: unknown; apiKey?: unknown },
  options: EvolutionUrlGuardOptions = {},
): Promise<string | null> {
  const apiUrl = typeof config.apiUrl === 'string' ? config.apiUrl.trim() : '';
  const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
  if (!apiUrl) return null;
  if (!apiKey) {
    return 'Para usar um endereço próprio da Evolution nesta conexão, informe também a chave da API dela. '
      + 'Sem os dois, apague o endereço: a conexão passa a usar o endereço e a chave da agência.';
  }
  try {
    await assertSafeEvolutionUrl(apiUrl, options);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Endereço da Evolution recusado.';
  }
}
