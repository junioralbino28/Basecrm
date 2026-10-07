// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ehUuid, escolherModo } from './modoDaMigracao';

const ID = '20532687-e868-48c4-977b-f6f7cac72131';

describe('escolherModo (migrar-agentes)', () => {
  it.each([
    ['--webhook sem id', ['--webhook'], '--webhook exige o id (uuid) do numero.'],
    ['--webhook seguido de outra opção', ['--webhook', '--confirmar-banco', 'abc'], '--webhook exige o id (uuid) do numero.'],
    ['--ligar com id inválido', ['--ligar', '123'], '--ligar exige o id (uuid) do numero.'],
    ['--desligar sem id', ['--desligar'], '--desligar exige o id (uuid) do numero.'],
  ])('%s: recusa', (_nome, args, erro) => {
    expect(escolherModo(args)).toEqual({ erro });
  });

  it('dois modos juntos, ou nenhum: recusa', () => {
    expect(escolherModo(['--prova', '--webhook', ID])).toMatchObject({ erro: expect.stringContaining('exatamente um modo') });
    expect(escolherModo(['--criar', '--ligar', ID])).toMatchObject({ erro: expect.stringContaining('exatamente um modo') });
    expect(escolherModo([])).toMatchObject({ erro: expect.stringContaining('veio: nenhum') });
  });

  it('modos válidos', () => {
    expect(escolherModo(['--prova', '--org', ID])).toEqual({ modo: 'prova' });
    expect(escolherModo(['--criar', '--org', ID, '--somente', ID])).toEqual({ modo: 'criar' });
    expect(escolherModo(['--webhook', ID])).toEqual({ modo: 'webhook', numero: ID });
    expect(escolherModo(['--ligar', ID, '--confirmar-banco', 'x'])).toEqual({ modo: 'ligar', numero: ID });
  });

  it('ehUuid', () => {
    expect(ehUuid(ID)).toBe(true);
    expect(ehUuid('--confirmar-banco')).toBe(false);
    expect(ehUuid(undefined)).toBe(false);
  });
});
