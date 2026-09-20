import { describe, expect, it } from 'vitest';
import { getPromptCatalogMap } from './catalog';

describe('prompt da Aurora', () => {
  it('mantem a qualificacao consultiva e o handoff estruturado da Cenoura Hub', () => {
    const prompt = getPromptCatalogMap().task_conversations_whatsapp_cenno_aurora;

    expect(prompt).toBeDefined();
    expect(prompt.defaultTemplate).toContain('Aurora');
    expect(prompt.defaultTemplate).toContain('Cenoura Hub');
    expect(prompt.defaultTemplate).toContain('uma pergunta por vez');
    expect(prompt.defaultTemplate).toContain('nao mencione um valor minimo de investimento');
    expect(prompt.defaultTemplate).toContain('nunca invente horarios');
    expect(prompt.defaultTemplate).toContain('duracao prevista de 40 minutos');
    expect(prompt.defaultTemplate).toContain('inicios separados por 60 minutos');
    expect(prompt.defaultTemplate).toContain('agenda estiver configurada');
    expect(prompt.defaultTemplate).toContain('apenas horarios listados como livres');
    expect(prompt.defaultTemplate).toContain('pode confirmar e agendar');
    expect(prompt.defaultTemplate).toContain('mesmo dia');
    expect(prompt.defaultTemplate).toContain('sabado exige confirmacao humana');
    expect(prompt.defaultTemplate).toContain('{{calendarContext}}');
    expect(prompt.defaultTemplate).toContain('handoffType');
    expect(prompt.defaultTemplate).toContain('meeting_requested');
    expect(prompt.defaultTemplate).toContain('requestedScheduleAt');
    expect(prompt.defaultTemplate).toContain('requestedScheduleText');
    expect(prompt.defaultTemplate).toContain('{{currentDateTime}}');
    expect(prompt.defaultTemplate).toContain('{{timezone}}');
    expect(prompt.defaultTemplate).toContain('{{recentMessagesText}}');
  });

  it('aplica os ajustes de 20/09: nome e concordancia esporadicos, 2 horarios, sem oferecer ligacao, quem conduz e data local', () => {
    const template = getPromptCatalogMap().task_conversations_whatsapp_cenno_aurora.defaultTemplate;

    expect(template).toContain('use o nome do lead na primeira mensagem e depois so de vez em quando');
    expect(template).toContain('nao abra a resposta com concordancia');
    expect(template).toContain('"bora"');
    expect(template).toContain('no maximo 2 horarios por mensagem');
    expect(template).toContain('fica melhor de manha ou de tarde');
    expect(template).toContain('terca-feira funciona para voce?');
    expect(template).toContain('nunca ofereca ligacao por conta propria');
    expect(template).toContain('So se o proprio lead pedir para ser ligado');
    expect(template).toContain('call_accepted');
    expect(template).toContain('voce nao participa dela');
    expect(template).toContain('{{meetingHostName}}');
    expect(template).toContain('{{currentDateTimeLocal}}');
    expect(template).not.toContain('se o lead aceitar uma ligacao');
  });

  it('confirma a reuniao com formato e quem conduz, e sabe encerrar depois do handoff', () => {
    const template = getPromptCatalogMap().task_conversations_whatsapp_cenno_aurora.defaultTemplate;

    expect(template).toContain('nunca diga que voce estara na reuniao');
    expect(template).toContain('{{meetingChannelText}}');
    expect(template).toContain('ENCERRAMENTO:');
    expect(template).toContain('sem abrir assunto novo, sem oferecer horario nem ligacao');
    expect(template).toContain('nunca corte seco nem prolongue');
    expect(template).toContain('{{conversationStageContext}}');
  });
});
