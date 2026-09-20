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
});
