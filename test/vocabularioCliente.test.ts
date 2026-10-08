/**
 * O CRM e multi-nicho: no texto que vai para a tela o tenant se chama CLIENTE, nunca "clinica".
 *
 * Decisao travada em 14/09/2026 (`02-Decisions/2026-09-14-basecrm-plataforma-modular-menu-agentes`,
 * item 7) e aplicada em 24/09 a pedido do Junior, que encontrou "Clinicas"/"Nova Clinica" ainda
 * no menu da agencia depois do rebranding.
 *
 * O que este teste NAO proibe, e por que:
 * - `clinic_admin`, `clinic_staff`, `edition: 'clinic'`, colunas: sao valores gravados no banco e
 *   usados na RLS — trocar pede migration;
 * - `brandTheme: 'clinica'` / `[data-brand="clinica"]`: chave do tema em `branding_config`;
 * - nome de variavel (`isClinicAdmin`, `selectedClinicId`): nao aparece na tela;
 * - Clinicorp (`app/api/agenda/*`, `lib/channels/clinicorp*`): integracao com software DE
 *   clinica, onde a palavra esta certa — ha "dentistas" na mesma frase;
 * - comentario de codigo: nao aparece na tela.
 *
 * 07/10/2026: a pessoa do funil tambem nao se chama "paciente" na tela (o Junior: "erro grotesco que ja
 * era para estar resolvido"). O vocabulario do CRM e Lead (negocio/pessoa) e Cliente (estagio final do
 * ciclo). Ficam de fora o Clinicorp, o titulo historico 'Paciente Criado' gravado no banco (a tela o traduz
 * para "Lead criado"), o id `task-paciente` (o rotulo e "Lead") e a linha do prompt padrao do WhatsApp que
 * hoje e o texto da Julia (clinica da Dra. Jessica), travado em lib/ai/prompts/migrated-prompts.lock.json:
 * separar o texto dela do padrao e decisao pendente do Junior.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tituloDaAtividade } from '@/lib/utils/tituloDaAtividade';

const RAIZ = path.resolve(__dirname, '..');
const PASTAS = ['app', 'components', 'context', 'features', 'lib'];
const IGNORAR_PASTA = new Set(['node_modules', '.next', 'dist', 'coverage']);

/** Caminhos onde "clinica" e a palavra certa. */
const PERMITIDO = [
  path.join('app', 'api', 'agenda'),
  path.join('lib', 'channels', 'clinicorp'),
  path.join('lib', 'branding', 'brandTheme.ts'),
];

/** Identificador, chave de banco ou nome de variavel na mesma linha do texto. */
const LINHA_TECNICA =
  /brandTheme|data-brand|BRAND_THEME|'clinica'|"clinica"|clinic_|Clinicorp|clinicorp|isClinicAdmin|selectedClinic|hasActiveClinic|ClinicAdmin/;
const LINHA_COMENTARIO = /^\s*(\/\/|\*|\/\*|\{\/\*)/;

type Regra = { palavra: RegExp; permitido: string[]; tecnica: RegExp };

const CLINICA: Regra = { palavra: /[Cc]l[íi]nica/, permitido: PERMITIDO, tecnica: LINHA_TECNICA };

/** "Paciente" so onde e a palavra certa ou dado gravado; ver o cabecalho. */
const PACIENTE: Regra = {
  palavra: /[Pp]acientes?/,
  permitido: [path.join('app', 'api', 'agenda'), path.join('lib', 'channels', 'clinicorp')],
  tecnica: /'Paciente Criado'|task-paciente|quando o paciente fecha/,
};

/**
 * Uso do título de uma atividade: variável com "activity" no nome (activity, lastActivity, activeEntry.activity...),
 * `act`, ou `a` num objeto de linha do tempo ou num template. Todo uso passa por tituloDaAtividade ou está em
 * USOS_DE_DADO (2ª revisão do Codex, 07/10: a regra por nome exato deixou passar `lastActivity.title`).
 */
const USO_DO_TITULO = /\b(\w*[Aa]ctivit\w*|act)\??\.title\b|title:\s*a\.title\b|\$\{\s*a\.title\s*\}/;

/** Usos que tratam o DADO gravado, não o texto da tela: arquivo e trecho da linha. */
const USOS_DE_DADO: Array<[string, string]> = [
  // formatTitle chama tituloDaAtividade.
  [path.join('features', 'activities', 'components', 'ActivityRow.tsx'), 'formatTitle(activity.title)'],
  // Formulário de editar: mostra o dado real, que é o que vai ser regravado.
  [path.join('features', 'activities', 'hooks', 'useActivitiesController.ts'), 'title: activity.title,'],
  // Lógica, não texto: detecção do tipo, mudança de etapa, extração do nome do contato.
  [path.join('features', 'dashboard', 'components', 'ActivityFeedItem.tsx'), 'activity.title.toLowerCase()'],
  [path.join('features', 'inbox', 'components', 'FocusContextPanel.tsx'), "activity.title.includes('Moveu para')"],
  [path.join('features', 'inbox', 'components', 'FocusContextPanel.tsx'), "activity.title.replace('Moveu para'"],
  [path.join('features', 'inbox', 'components', 'InboxFocusView.tsx'), 'tryExtractContactNameFromText(act.title)'],
  [path.join('features', 'inbox', 'components', 'InboxFocusView.tsx'), 'act.title?.match('],
  // Gravação no banco.
  [path.join('lib', 'conversations', 'aiReply.ts'), 'p_title: activity.title'],
];

/** Pastas de dado: as rotas de API devolvem o título gravado (contrato) e lib/supabase é a camada do banco. */
const PASTAS_DE_DADO = [path.join('app', 'api'), path.join('lib', 'supabase')];

function usoCruDoTitulo(rel: string, linha: string): boolean {
  if (!USO_DO_TITULO.test(linha) || LINHA_COMENTARIO.test(linha)) return false;
  if (linha.includes('tituloDaAtividade(')) return false;
  return !USOS_DE_DADO.some(([arquivo, trecho]) => rel === arquivo && linha.includes(trecho));
}

function linhaProibida(linha: string, regra: Regra): boolean {
  return regra.palavra.test(linha) && !regra.tecnica.test(linha) && !LINHA_COMENTARIO.test(linha);
}

function varrer(dir: string, regra: Regra, achados: string[] = []): string[] {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORAR_PASTA.has(entrada.name)) continue;
    const completo = path.join(dir, entrada.name);
    const rel = path.relative(RAIZ, completo);
    if (regra.permitido.some(p => rel.startsWith(p))) continue;
    if (entrada.isDirectory()) {
      varrer(completo, regra, achados);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entrada.name)) continue;
    if (/\.(test|spec)\.(ts|tsx)$/.test(entrada.name)) continue;

    const linhas = fs.readFileSync(completo, 'utf8').split('\n');
    linhas.forEach((linha, i) => {
      if (!linhaProibida(linha, regra)) return;
      achados.push(`${rel}:${i + 1}  ${linha.trim().slice(0, 110)}`);
    });
  }
  return achados;
}

describe('vocabulário do produto — o tenant se chama CLIENTE', () => {
  it('nenhum texto de tela chama o tenant de "clínica"', () => {
    const achados = PASTAS.flatMap(p => varrer(path.join(RAIZ, p), CLINICA));
    expect(achados, `Troque por "cliente" (concordância no masculino):\n${achados.join('\n')}`).toEqual([]);
  });

  it('nenhum texto de tela chama a pessoa do funil de "paciente"', () => {
    const achados = PASTAS.flatMap(p => varrer(path.join(RAIZ, p), PACIENTE));
    expect(achados, `Troque por "lead" (ou "cliente" no estágio final do ciclo):\n${achados.join('\n')}`).toEqual([]);
  });

  it('o detector pega texto de tela e deixa passar comentário e dado gravado (prova do próprio detector)', () => {
    expect(linhaProibida('                  Paciente Perdido', PACIENTE)).toBe(true);
    expect(linhaProibida("formatter={(value: number) => [`${value} pacientes`, 'Quantidade']}", PACIENTE)).toBe(true);
    expect(linhaProibida('        <h3>Nova Clínica</h3>', CLINICA)).toBe(true);
    expect(linhaProibida(' * Usado pelos relatórios do N7 (export de pacientes).', PACIENTE)).toBe(false);
    expect(linhaProibida("        if (title === 'Paciente Criado') return 'Lead criado';", PACIENTE)).toBe(false);
  });

  it('o título histórico gravado no banco continua traduzido na tela', () => {
    expect(tituloDaAtividade('Paciente Criado')).toBe('Lead criado');
  });

  // Revisão do Codex (07/10): a tradução existia só na lista de atividades; painel, calendário, caixa de entrada e o
  // analisador de negócios parados mostravam o título cru. Todo uso do título passa por tituloDaAtividade ou é dado.
  it('todo uso do título de uma atividade passa por tituloDaAtividade ou está na lista de dado', () => {
    const achados: string[] = [];
    const visitar = (dir: string) => {
      for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
        if (IGNORAR_PASTA.has(entrada.name)) continue;
        const completo = path.join(dir, entrada.name);
        const rel = path.relative(RAIZ, completo);
        if (PASTAS_DE_DADO.some(p => rel.startsWith(p))) continue;
        if (entrada.isDirectory()) {
          visitar(completo);
          continue;
        }
        if (!/\.tsx?$/.test(entrada.name) || /\.(test|spec)\.tsx?$/.test(entrada.name)) continue;
        fs.readFileSync(completo, 'utf8').split('\n').forEach((linha, i) => {
          if (usoCruDoTitulo(rel, linha)) achados.push(`${rel}:${i + 1}  ${linha.trim().slice(0, 110)}`);
        });
      }
    };
    ['app', 'components', 'features', 'lib'].forEach(p => visitar(path.join(RAIZ, p)));
    expect(
      achados,
      `Use tituloDaAtividade(...) ou, se for dado e não tela, inclua em USOS_DE_DADO com o motivo:\n${achados.join('\n')}`,
    ).toEqual([]);
  });

  it('o detector do uso cru pega os padrões que existiam, inclusive o que escapou (prova do próprio detector)', () => {
    const outro = path.join('features', 'qualquer.tsx');
    expect(usoCruDoTitulo(outro, 'parts.push(`A última interação foi ${activityType}: "${lastActivity.title}".`);')).toBe(true);
    expect(usoCruDoTitulo(outro, '                    {activity.title}')).toBe(true);
    expect(usoCruDoTitulo(outro, 'title={`${activity.title} - ${x}`}')).toBe(true);
    expect(usoCruDoTitulo(outro, '      title: a.title,')).toBe(true);
    expect(usoCruDoTitulo(outro, '                    {tituloDaAtividade(activity.title)}')).toBe(false);
    // A exceção vale só no arquivo dela.
    const feed = path.join('features', 'dashboard', 'components', 'ActivityFeedItem.tsx');
    expect(usoCruDoTitulo(feed, '    const titleLower = activity.title.toLowerCase();')).toBe(false);
    expect(usoCruDoTitulo(outro, '    const titleLower = activity.title.toLowerCase();')).toBe(true);
  });

  it('o menu da agência diz Clientes e Novo Cliente', () => {
    const nav = fs.readFileSync(path.join(RAIZ, 'components', 'navigation', 'navConfig.ts'), 'utf8');
    expect(nav).toContain("label: 'Clientes'");
    expect(nav).toContain("label: 'Novo Cliente'");
  });

  it('o identificador técnico NÃO foi renomeado junto — isso quebraria a RLS', () => {
    const scope = fs.readFileSync(path.join(RAIZ, 'lib', 'auth', 'scope.ts'), 'utf8');
    expect(scope).toContain('clinic_admin');
    expect(scope).toContain('clinic_staff');
  });
});
