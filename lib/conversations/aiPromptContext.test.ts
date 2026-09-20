import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createStaticAdminClient: vi.fn() }));

import {
  DEFAULT_MEETING_HOST_NAME,
  formatLocalDateTimeForPrompt,
  pickMeetingHostName,
  readConfiguredMeetingHostName,
} from './aiPromptContext';

describe('data local no prompt da IA', () => {
  it('traz dia da semana, data e hora no fuso da agenda', () => {
    expect(formatLocalDateTimeForPrompt('2026-09-22T13:05:00.000Z', 'America/Sao_Paulo'))
      .toBe('terça-feira, 22/09/2026 10:05 (America/Sao_Paulo)');
    // virada do dia: 02:30 UTC de quarta ainda e terca a noite em Sao Paulo
    expect(formatLocalDateTimeForPrompt('2026-09-23T02:30:00.000Z', 'America/Sao_Paulo'))
      .toBe('terça-feira, 22/09/2026 23:30 (America/Sao_Paulo)');
  });

  it('fuso invalido ou data invalida caem no texto original, sem derrubar a geracao', () => {
    expect(formatLocalDateTimeForPrompt('2026-09-22T13:05:00.000Z', 'Fuso/Inexistente')).toBe('2026-09-22T13:05:00.000Z');
    expect(formatLocalDateTimeForPrompt('nao-e-data', 'America/Sao_Paulo')).toBe('nao-e-data');
  });
});

describe('quem conduz as reunioes no prompt da IA', () => {
  it('o nome configurado no numero vence o perfil', () => {
    expect(pickMeetingHostName({
      connectionConfig: { meetingHostName: ' Junior ' },
      ownerProfile: { nickname: 'Outro', email: 'x@y.com' },
    })).toBe('Junior');
  });

  it('perfil so com e-mail cai no padrao neutro: o login nao entra no prompt', () => {
    expect(pickMeetingHostName({
      connectionConfig: {},
      ownerProfile: { email: 'junioralbino28@gmail.com', first_name: null, last_name: null, nickname: null },
    })).toBe(DEFAULT_MEETING_HOST_NAME);
    expect(pickMeetingHostName({ connectionConfig: null, ownerProfile: null })).toBe(DEFAULT_MEETING_HOST_NAME);
  });

  it('usa apelido, senao nome completo, do responsavel da agenda', () => {
    expect(pickMeetingHostName({
      connectionConfig: {},
      ownerProfile: { nickname: 'Ju', first_name: 'Junior', last_name: 'Albino', email: 'a@b.com' },
    })).toBe('Ju');
    expect(pickMeetingHostName({
      connectionConfig: {},
      ownerProfile: { first_name: 'Junior', last_name: 'Albino', email: 'a@b.com' },
    })).toBe('Junior Albino');
  });

  it('recusa nome configurado fora do contrato', () => {
    expect(readConfiguredMeetingHostName({ meetingHostName: '<script>Junior</script>' })).toBe('');
    expect(readConfiguredMeetingHostName({ meetingHostName: 'x'.repeat(81) })).toBe('');
    expect(readConfiguredMeetingHostName({ meetingHostName: "Maria D'Avila-Souza" })).toBe("Maria D'Avila-Souza");
  });
});
