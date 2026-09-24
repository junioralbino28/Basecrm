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

    // Redacao mudou em 23/09 (o nome do WhatsApp costuma ser o da EMPRESA); a propriedade
    // que importa continua: nome na saudacao e na confirmacao, esporadico no resto.
    expect(template).toContain('use na saudacao e na confirmacao da reuniao');
    expect(template).toContain('nao abra a resposta com concordancia');
    expect(template).not.toContain('"bora"');
    expect(template).toContain('no maximo 2 horarios por mensagem');
    expect(template).toContain('fica melhor de manha ou de tarde');
    expect(template).toContain('terça-feira funciona para você?');
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
    expect(template).toContain('feche deixando a porta aberta');
    expect(template).toContain('o nicho entra de forma natural no diagnostico, nunca como formulario no fim');
    expect(template).toContain('antes de confirmar o horario, complete so o que ainda faltar');
    expect(template).toContain('nosso especialista {{meetingHostName}} vai conduzir seu diagnóstico');
    expect(template).toContain('Mais alguma dúvida?');
    expect(template).toContain('nunca prometa e-mail de confirmacao');
    expect(template).toContain('- leadEmail:');
    expect(template).toContain('- leadSegment:');
    expect(template).toContain('nunca corte seco');
    expect(template).toContain('{{conversationStageContext}}');
    expect(template).toContain('REUNIAO JA CONFIRMADA');
    expect(template).toContain('diga o dia da semana e o dia do mes ("tenho terça-feira, dia 22, às 9h ou às 10h")');
    expect(template).toContain('use "amanha" so quando o dia seguinte for dia util');
  });

  it('aplica o lote de 21/09: teto do nome, bora liberado, espelhamento, acentuacao, sem travessao, hoje, insistencia e nota interna factual', () => {
    const template = getPromptCatalogMap().task_conversations_whatsapp_cenno_aurora.defaultTemplate;

    expect(template).toContain('no maximo uma vez a cada 4 ou 5 mensagens suas, e nunca em duas mensagens seguidas');
    expect(template).toContain('expressoes naturais de WhatsApp sao bem-vindas');
    expect(template).toContain('observe como o lead escreve e aproxime seu jeito do dele');
    expect(template).toContain('emoji so se ele usar');
    expect(template).toContain('nunca acompanhe grosseria');
    expect(template).toContain('o estilo muda, as regras desta conversa nao mudam');
    expect(template).toContain('escreva sempre com ortografia e acentuacao corretas do portugues');
    expect(template).toContain('mesmo que estas instrucoes estejam sem acento');
    expect(template).toContain('nunca use travessao');
    expect(template).not.toContain('—');
    expect(template).toContain('nao repita a mesma pergunta com as mesmas palavras');
    expect(template).toContain('se for na data local de hoje, diga "hoje"');
    expect(template).toContain('nunca diga so o nome do dia quando esse dia for hoje');
    expect(template).toContain('se ele insistir que precisa ser antes, nao confirme');
    expect(template).toContain('nossa reunião está marcada para {dia da semana}, {data}, às {hora}');
    expect(template).toContain('qualquer dúvida até lá, me chama por aqui');
    expect(template).toContain('registre so o que o lead disse ou o que voce fez, nunca suposicao');
  });

  it('mantem o que o Junior mandou manter em 21/09: pedido de e-mail para o convite, sem prometer confirmacao, e a regra de concordancia', () => {
    const template = getPromptCatalogMap().task_conversations_whatsapp_cenno_aurora.defaultTemplate;

    expect(template).toContain('(para o convite da reuniao)');
    expect(template).toContain('nunca prometa e-mail de confirmacao');
    expect(template).toContain('nao abra a resposta com concordancia');
  });
});

/**
 * Ajustes de 23/09/2026, depois dos dois primeiros leads reais da campanha.
 *
 * O que aconteceu: a Aurora chamou uma pessoa de "Púlpitos" (nome da empresa no perfil do
 * WhatsApp), fez 6 perguntas seguidas sem devolver nada e o lead sumiu, aceitou "amanhã eu
 * chamo" de primeira num atendimento que é 24/7, e convidou para reunião com "o Junior" — um
 * nome que o lead nunca tinha ouvido.
 */
describe('prompt da Aurora — correcoes dos primeiros leads reais (23/09)', () => {
  const template = () => getPromptCatalogMap().task_conversations_whatsapp_cenno_aurora.defaultTemplate;

  it('avisa que o nome do WhatsApp costuma ser o da EMPRESA e manda perguntar com quem fala', () => {
    expect(template()).toContain('e o nome da EMPRESA, nao da pessoa');
    expect(template()).toContain('com quem eu falo?');
    expect(template()).toContain('Use o primeiro nome da PESSOA so depois que ela disser qual e');
  });

  it('poe teto nas perguntas antes de devolver leitura — senao vira interrogatorio', () => {
    expect(template()).toContain('no maximo 3 perguntas suas antes de devolver');
    expect(template()).toContain('PARE de perguntar');
  });

  it('trata resposta curta repetida como cansaco, nao como engajamento', () => {
    expect(template()).toContain('responder curto duas vezes seguidas');
  });

  it('DEFENDE O AGORA: nao aceita "amanha eu chamo" de primeira', () => {
    const t = template();
    expect(t).toContain('NAO aceite de primeira');
    expect(t).toContain('Voce atende 24 horas');
    // Usar a objecao a favor foi o ponto do Junior, e e o que separa esta regra de "insistir".
    expect(t).toContain('o dia dele e corrido');
    expect(t).toContain('So aceite deixar para depois se ele repetir');
  });

  it('apresenta quem conduz a reuniao antes de soltar o nome', () => {
    const t = template();
    expect(t).toContain('o lead nunca ouviu falar de {{meetingHostName}}');
    expect(t).toContain('especialista da nossa assessoria');
    expect(t).toContain('Nunca solte so o primeiro nome');
  });
});
