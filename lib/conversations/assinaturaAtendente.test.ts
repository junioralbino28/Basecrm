import { describe, expect, it } from 'vitest';
import {
  LIMITE_LEGENDA_EXTERNA,
  LIMITE_TEXTO_EXTERNO,
  assinarMensagemDoAtendente,
  resolveAssinaturaAtivada,
  resolveNomeDoAtendente,
} from './assinaturaAtendente';

describe('resolveAssinaturaAtivada: o interruptor por numero', () => {
  it('nasce desligado — conexao sem o campo, com nulo ou com lixo no lugar', () => {
    expect(resolveAssinaturaAtivada(null)).toBe(false);
    expect(resolveAssinaturaAtivada(undefined)).toBe(false);
    expect(resolveAssinaturaAtivada({})).toBe(false);
    expect(resolveAssinaturaAtivada({ signManualReplies: null })).toBe(false);
    expect(resolveAssinaturaAtivada({ signManualReplies: 'true' })).toBe(false);
    expect(resolveAssinaturaAtivada({ signManualReplies: 1 })).toBe(false);
    expect(resolveAssinaturaAtivada({ signManualReplies: false })).toBe(false);
  });

  it('so o booleano verdadeiro liga', () => {
    expect(resolveAssinaturaAtivada({ signManualReplies: true })).toBe(true);
  });
});

describe('resolveNomeDoAtendente: identidade que o lead pode ver', () => {
  it('prefere o apelido', () => {
    expect(
      resolveNomeDoAtendente({ nickname: 'Vitoria', first_name: 'Maria', last_name: 'Souza', email: 'm@x.com' }),
    ).toBe('Vitoria');
  });

  it('sem apelido, junta nome e sobrenome', () => {
    expect(
      resolveNomeDoAtendente({ nickname: null, first_name: 'Maria', last_name: 'Souza', email: 'm@x.com' }),
    ).toBe('Maria Souza');
  });

  it('aceita so o primeiro nome', () => {
    expect(
      resolveNomeDoAtendente({ nickname: '  ', first_name: 'Maria', last_name: null, email: 'm@x.com' }),
    ).toBe('Maria');
  });

  it('NUNCA cai no e-mail: sem nome utilizavel devolve null', () => {
    // O trecho antes do @ vazaria parte do endereco para o lead.
    expect(
      resolveNomeDoAtendente({ nickname: null, first_name: null, last_name: null, email: 'vitoria@clinica.com' }),
    ).toBeNull();
    expect(resolveNomeDoAtendente({ nickname: '   ', first_name: '', last_name: '  ', email: null })).toBeNull();
  });

  it('recusa nome sem nenhuma letra', () => {
    expect(resolveNomeDoAtendente({ nickname: '123', first_name: null, last_name: null, email: null })).toBeNull();
    expect(resolveNomeDoAtendente({ nickname: '...', first_name: null, last_name: null, email: null })).toBeNull();
  });

  it('preserva acento e caixa do jeito que a pessoa escreveu', () => {
    expect(
      resolveNomeDoAtendente({ nickname: 'Vitória', first_name: null, last_name: null, email: null }),
    ).toBe('Vitória');
  });
});

describe('assinarMensagemDoAtendente', () => {
  it('desligado devolve o texto intacto', () => {
    expect(
      assinarMensagemDoAtendente({ texto: 'Oi, tudo bem?', nomeDoAtendente: 'Vitoria', ativada: false }),
    ).toBe('Oi, tudo bem?');
  });

  it('ligado poe o nome na frente', () => {
    expect(
      assinarMensagemDoAtendente({ texto: 'Oi, tudo bem?', nomeDoAtendente: 'Vitoria', ativada: true }),
    ).toBe('Vitoria: Oi, tudo bem?');
  });

  it('texto vazio continua vazio — midia sem legenda nao ganha legenda', () => {
    expect(assinarMensagemDoAtendente({ texto: '', nomeDoAtendente: 'Vitoria', ativada: true })).toBe('');
    expect(assinarMensagemDoAtendente({ texto: '   ', nomeDoAtendente: 'Vitoria', ativada: true })).toBe('   ');
  });

  it('sem nome utilizavel devolve o texto intacto', () => {
    expect(assinarMensagemDoAtendente({ texto: 'Oi', nomeDoAtendente: null, ativada: true })).toBe('Oi');
    expect(assinarMensagemDoAtendente({ texto: 'Oi', nomeDoAtendente: '   ', ativada: true })).toBe('Oi');
  });

  it('NAO deduplica: corpo que ja comeca com o proprio nome recebe o prefixo assim mesmo', () => {
    // Decisao do Junior (25/09): ninguem digita o proprio nome; no maximo se apresenta. Deduzir
    // assinatura pela aparencia da string errava nos dois sentidos, entao a guarda nao existe.
    expect(
      assinarMensagemDoAtendente({ texto: 'Vitoria: Oi', nomeDoAtendente: 'Vitoria', ativada: true }),
    ).toBe('Vitoria: Vitoria: Oi');
  });

  it('corpo que comeca com outra palavra seguida de dois-pontos e so corpo', () => {
    // "Rio: entrega quinta; SP: entrega sexta" nao pode ser confundido com assinatura.
    expect(
      assinarMensagemDoAtendente({ texto: 'Rio: quinta; SP: sexta', nomeDoAtendente: 'Rio', ativada: true }),
    ).toBe('Rio: Rio: quinta; SP: sexta');
  });

  it('apresentacao do atendente convive com o prefixo', () => {
    expect(
      assinarMensagemDoAtendente({ texto: 'oi, aqui e a Vitoria', nomeDoAtendente: 'Vitoria', ativada: true }),
    ).toBe('Vitoria: oi, aqui e a Vitoria');
  });

  it('texto de varias linhas recebe o nome so na primeira', () => {
    expect(
      assinarMensagemDoAtendente({ texto: 'Oi\nsegue o endereco', nomeDoAtendente: 'Vitoria', ativada: true }),
    ).toBe('Vitoria: Oi\nsegue o endereco');
  });

  it('apara sobra nas pontas sem mexer no miolo', () => {
    expect(
      assinarMensagemDoAtendente({ texto: '  Oi  ', nomeDoAtendente: 'Vitoria', ativada: true }),
    ).toBe('Vitoria: Oi');
  });
});

describe('limites do payload externo', () => {
  it('sao contados em unidades UTF-16, depois do prefixo', () => {
    expect(LIMITE_TEXTO_EXTERNO).toBe(4000);
    expect(LIMITE_LEGENDA_EXTERNA).toBe(1024);
  });

  it('o prefixo cabe dentro do limite do texto quando o corpo ja esta no teto do schema', () => {
    // O schema aceita content de ate 4000; com o prefixo, o payload estoura e tem que ser recusado.
    const corpo = 'a'.repeat(4000);
    const assinado = assinarMensagemDoAtendente({ texto: corpo, nomeDoAtendente: 'Vitoria', ativada: true });
    expect(assinado.length).toBeGreaterThan(LIMITE_TEXTO_EXTERNO);
  });
});
