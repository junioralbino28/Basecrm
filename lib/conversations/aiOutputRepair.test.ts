import { describe, expect, it } from 'vitest';
import { repairStructuredOutputText } from './aiOutputRepair';

describe('reparo da saida estruturada do modelo', () => {
  it('tira a cerca de markdown e devolve o objeto', () => {
    expect(repairStructuredOutputText('```json\n{"replyText":"Oi","shouldHandoff":false}\n```'))
      .toBe('{"replyText":"Oi","shouldHandoff":false}');
  });

  it('recorta o objeto quando ha raciocinio antes ou lixo depois', () => {
    expect(repairStructuredOutputText('Pensando... {"replyText":"Oi"} fim'))
      .toBe('{"replyText":"Oi"}');
    expect(repairStructuredOutputText('{"replyText":"Tem } aqui","summary":null}\n\nobs'))
      .toBe('{"replyText":"Tem } aqui","summary":null}');
  });

  it('devolve null quando nao ha objeto valido para recortar ou quando nada muda', () => {
    expect(repairStructuredOutputText('sem json nenhum')).toBeNull();
    expect(repairStructuredOutputText('{"replyText": "quebrado"')).toBeNull();
    expect(repairStructuredOutputText('')).toBeNull();
    expect(repairStructuredOutputText(null)).toBeNull();
    // ja era um JSON limpo: o SDK e quem falhou por outro motivo (schema); nao ha o que reparar
    expect(repairStructuredOutputText('{"replyText":"Oi"}')).toBeNull();
  });
});
