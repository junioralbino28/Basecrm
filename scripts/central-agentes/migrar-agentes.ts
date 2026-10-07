/**
 * Central de Agentes, fatia 1 — migração do prompt de hoje para agentes.
 *
 *   npx --yes tsx@4.23.1 scripts/central-agentes/migrar-agentes.ts --prova [--org <uuid>] [--incluir <id,id>]
 *   npx --yes tsx@4.23.1 scripts/central-agentes/migrar-agentes.ts --criar --org <uuid> --confirmar-banco <ref> [--incluir <id,id>] [--somente <connectionId>] (em producao, --somente e obrigatorio)
 *   npx --yes tsx@4.23.1 scripts/central-agentes/migrar-agentes.ts --ligar <connectionId> --confirmar-banco <ref>
 *   npx --yes tsx@4.23.1 scripts/central-agentes/migrar-agentes.ts --desligar <connectionId> --confirmar-banco <ref> [--se-agente <agentId>]
 *   npx --yes tsx@4.23.1 scripts/central-agentes/migrar-agentes.ts --webhook <connectionId>
 *
 * O ambiente (ramo publicado, projeto da Vercel e TODOS os domínios que atendem o banco) sai do banco
 * conectado, numa lista fechada (AMBIENTES). A prova só vale com esta cópia exatamente no commit publicado
 * (HEAD == origin/<ramo>, depois de um fetch), sem mudança local nos arquivos que decidem o prompt, E com
 * todos os domínios do ambiente servindo esse mesmo commit (lido na API da Vercel, recusando transição,
 * rollout e deployment mais novo não servido).
 *
 * Credenciais no ambiente (nunca impressas): NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_URL, SUPABASE_SECRET_KEY ou
 * SUPABASE_SERVICE_ROLE_KEY, VERCEL_TOKEN e VERCEL_TEAM_ID. Toda escrita exige --confirmar-banco com a
 * referência do projeto que o script imprime, para nunca escrever no banco errado.
 *
 * Saída: 0 = feito; 1 = recusado, desfeito (nada ficou ligado, linha conferida) ou numero que nao existe mais; 2 = uso ou trava;
 * 3 = INCERTO (o número pode ter ficado ligado ao agente desta chamada: rodar --desligar com --se-agente e
 * conferir); 4 = LIGADO A OUTRO AGENTE (alguém ligou o número durante a operação: não desligar sem falar com
 * quem ligou).
 *
 * Fatia 2: --ligar também lê na Evolution, antes e depois de ligar, o endereço do webhook do número e exige um domínio
 * do ambiente (lib/agents/webhookDoNumero.ts); com isso ligar em produção ficou liberado. --webhook <id> faz só essa
 * leitura, sem escrever nada.
 */
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import {
  criarAgentes,
  desligarConexao,
  ligarComConferencia,
  planejarMigracao,
  type ConexaoIgnorada,
  type GrupoPlanejado,
} from '@/lib/agents/migracaoAgentes';
import { criarClienteVercel, lerPublicacaoNoAr, type AmbientePublicado, type PublicacaoNoAr } from '@/lib/agents/publicacaoVercel';
import { conferirWebhookDoNumero } from '@/lib/agents/webhookDoNumero';
import { ehUuid, escolherModo } from '@/lib/agents/modoDaMigracao';

const ARQUIVOS_DO_PROMPT = ['lib/ai/prompts', 'lib/agents', 'lib/conversations/aiAgentConfig.ts'];
const PROJETO_VERCEL = 'prj_Bxf5A1vWELuIIHh6P1HHMUC42ErV';
const DOMINIOS_DE_PRODUCAO = ['crm.basea2.com', 'crm.cennohub.com.br', 'basecrm.vercel.app'];
const DOMINIOS_DE_TESTE = ['teste.crm.basea2.com'];

/**
 * Os dois bancos que têm publicação para conferir. Lista FECHADA: banco → projeto → ramo → todos os domínios
 * que atendem aquele banco. As duas listas juntas têm que ser os domínios do projeto na Vercel: se o projeto
 * ganhar ou perder um domínio, toda leitura da publicação recusa (dominios_do_projeto_divergem) até a lista
 * daqui ser atualizada.
 */
const AMBIENTES: Record<string, AmbientePublicado & { nome: string }> = {
  eqidsihasmwwamkaqfka: {
    nome: 'producao',
    dominios: DOMINIOS_DE_PRODUCAO,
    outrosDominiosDoProjeto: DOMINIOS_DE_TESTE,
    ramo: 'main',
    projectId: PROJETO_VERCEL,
    producao: true,
  },
  zvwngsrflkicbbzfmrgy: {
    nome: 'teste',
    dominios: DOMINIOS_DE_TESTE,
    outrosDominiosDoProjeto: DOMINIOS_DE_PRODUCAO,
    ramo: 'feat/aurora-implantacao',
    projectId: PROJETO_VERCEL,
    producao: false,
  },
};

/**
 * Fatia 2: ligar em produção liberado, porque --ligar passou a ler na Evolution o endereço do webhook de cada número
 * (conferirWebhookDoNumero) e a exigir um domínio da lista fechada do ambiente, antes de ligar e de novo depois, junto
 * com a publicação. Webhook desligado ou fora da lista recusa (a Julia, enquanto o webhook dela estiver desligado por
 * decisão do Junior de 15/09).
 */
const LIGAR_EM_PRODUCAO_LIBERADO = true;

function argumento(nome: string) {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const tem = (nome: string) => process.argv.includes(nome);

/** `<ref>.supabase.co` → ref; local → 'local'. Qualquer outro host volta inteiro e não casa com ambiente nenhum. */
function referenciaDoBanco(url: string) {
  const host = new URL(url).hostname;
  if (host === '127.0.0.1' || host === 'localhost') return 'local';
  const projeto = /^([a-z0-9]{20})\.supabase\.co$/.exec(host);
  return projeto ? projeto[1] : host;
}

function git(args: string[]) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function imprimirPlano(plano: { grupos: GrupoPlanejado[]; ignoradas: ConexaoIgnorada[] }) {
  for (const g of plano.grupos) {
    console.log(`AGENTE  org=${g.organizationId} chave=${g.promptKey} origem=${g.promptSource} sha256=${g.sha256.slice(0, 12)} caracteres=${g.conteudo.length} nome=${g.nome} pronto=${g.pronto ? 'sim' : 'nao'}`);
    for (const c of g.conexoes) {
      console.log(`        numero ${c.id} (${c.name}) producao=${c.situacao}${c.respostaEm ? ` evento_entregue=${c.respostaEm}` : ''}`);
    }
  }
  for (const i of plano.ignoradas) console.log(`IGNORADA ${i.id} (${i.name}) org=${i.organizationId} motivo=${i.motivo}`);
}

// Encerramento: NUNCA chamar process.exit logo depois de um fetch. No Windows com Node >= 23 (nodejs/node#56645; visto aqui em
// 07/10 no --desligar, Node 24.8 + tsx: 'Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src/win/async.c:76', saida
// 3221226505 = 0xC0000409), a saida imediata corre contra o fechamento das conexoes keep-alive do undici (o fetch do
// supabase-js e da API da Vercel) e o libuv aborta, perdendo o codigo de saida. Com process.exitCode o processo termina
// sozinho quando os handles drenam (o undici solta a conexao em ate 4 s), com o codigo certo. O contrato da CLI e o codigo.
function sair(codigo: number): void {
  process.exitCode = codigo;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) {
    console.error('Faltam NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL e SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY no ambiente.');
    return sair(2);
  }
  const ref = referenciaDoBanco(url);
  const commit = git(['rev-parse', 'HEAD']);
  const promptAlterado = git(['status', '--porcelain', '--', ...ARQUIVOS_DO_PROMPT]) !== '';
  console.log(`Banco: ${ref}`);
  console.log(`Commit: ${commit}${promptAlterado ? ' (arquivos do prompt com mudanca local)' : ''}`);

  // Um modo por chamada, e o número dos modos que recebem um tem que ser uuid (lib/agents/modoDaMigracao.ts).
  const escolhido = escolherModo(process.argv.slice(2));
  if ('erro' in escolhido) {
    console.error(escolhido.erro);
    return sair(2);
  }

  const escreve = tem('--criar') || tem('--ligar') || tem('--desligar');
  if (escreve && argumento('--confirmar-banco') !== ref) {
    console.error(`Escrita recusada: passe --confirmar-banco ${ref} para confirmar o banco.`);
    return sair(2);
  }

  const admin = createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });

  const desligar = argumento('--desligar');
  if (desligar) {
    // Com --se-agente, só desliga se o número ainda estiver com AQUELE agente: não derruba a ligação de outra pessoa.
    const seAgente = argumento('--se-agente');
    const r = await desligarConexao(admin, desligar, seAgente ? { seAgente } : {});
    console.log(r.ok ? `DESLIGADO numero=${desligar}${seAgente ? ` (estava com o agente ${seAgente})` : ''}` : `NAO DESLIGOU numero=${desligar} (${r.detalhe})`);
    return sair(r.ok ? 0 : 1);
  }

  const ambiente = AMBIENTES[ref];
  if (!ambiente) {
    console.error(`Recusado: o banco ${ref} nao tem publicacao para conferir. --prova, --criar e --ligar so rodam contra ${Object.keys(AMBIENTES).join(' ou ')}.`);
    return sair(2);
  }
  console.log(`Ambiente: ${ambiente.nome} | ramo ${ambiente.ramo} | dominios ${ambiente.dominios.join(', ')}`);
  if (tem('--ligar') && ambiente.producao && !LIGAR_EM_PRODUCAO_LIBERADO) {
    console.error('Recusado: ligar numero em producao entra na fatia 2 (falta conferir na Evolution o endereco do webhook de cada numero). Nesta fatia, --ligar so roda no ambiente de teste.');
    return sair(2);
  }

  const webhook = argumento('--webhook');
  if (webhook) {
    // Só leitura: o mesmo critério que o --ligar usa, para conferir antes de pedir o OK.
    const w = await conferirWebhookDoNumero({ admin, connectionId: webhook, dominios: ambiente.dominios });
    console.log(w.ok ? `WEBHOOK numero=${webhook} confere host=${w.host}` : `WEBHOOK numero=${webhook} recusado motivo=${w.motivo} (${w.detalhe})`);
    return sair(w.ok ? 0 : 1);
  }

  git(['fetch', 'origin', ambiente.ramo]);
  const publicado = git(['rev-parse', `origin/${ambiente.ramo}`]);
  if (publicado !== commit) {
    console.error(`Recusado: esta copia esta em ${commit.slice(0, 7)} e ${ambiente.ramo} publicado esta em ${publicado.slice(0, 7)}. A prova so vale com o codigo publicado.`);
    return sair(2);
  }
  if (promptAlterado) {
    console.error(`Recusado: ha mudanca local em arquivo que decide o prompt (${ARQUIVOS_DO_PROMPT.join(', ')}).`);
    return sair(2);
  }
  const token = process.env.VERCEL_TOKEN;
  const teamId = process.env.VERCEL_TEAM_ID;
  if (!token || !teamId) {
    console.error('Faltam VERCEL_TOKEN e VERCEL_TEAM_ID no ambiente (lidos do cofre em processo, nunca impressos).');
    return sair(2);
  }
  const api = criarClienteVercel({ token, teamId });
  const lerPublicacao = () => lerPublicacaoNoAr(api, ambiente);

  const ligar = argumento('--ligar');
  if (ligar) {
    // Fatia 2: a publicação E o webhook do número, conferidos antes de ligar e de novo depois. ligarComConferencia
    // chama este leitor nas duas pontas e desfaz a ligação se a segunda leitura não confirmar.
    const lerPublicacaoEWebhook = async (): Promise<PublicacaoNoAr> => {
      const p = await lerPublicacao();
      if (!p.ok) return p;
      const w = await conferirWebhookDoNumero({ admin, connectionId: ligar, dominios: ambiente.dominios });
      if (!w.ok) return { ok: false, motivo: 'webhook_do_numero', detalhe: `${w.motivo}: ${w.detalhe}` };
      return p;
    };
    const r = await ligarComConferencia(admin, ligar, lerPublicacaoEWebhook, commit);
    if (r.estado === 'ligado') {
      console.log(`LIGADO numero=${ligar} agente=${r.agentId} publicacao=${r.publicacao.commit.slice(0, 7)} (${r.publicacao.deploymentId}); linha conferida`);
      return;
    }
    if (r.estado === 'nao_ligou') {
      console.log(`NAO LIGOU numero=${ligar} motivo=${r.motivo}`);
      return sair(1);
    }
    if (r.estado === 'desfeito') {
      console.error(`DESFEITO numero=${ligar}: ${r.motivo}. O numero nao esta ligado a agente nenhum (linha conferida).`);
      return sair(1);
    }
    if (r.estado === 'conexao_inexistente') {
      // 5ª rodada do Codex, achado 6: nao e "linha sem agente"; nao ha linha.
      console.error(`NAO LIGOU numero=${ligar}: ${r.motivo}. O numero NAO EXISTE MAIS neste banco (apagado durante a operacao); nada ficou ligado e nao ha o que desligar.`);
      return sair(1);
    }
    if (r.estado === 'ligado_a_outro') {
      console.error(`ATENCAO numero=${ligar}: ${r.motivo}. O numero esta LIGADO A OUTRO AGENTE (${r.agenteAtual}), nao ao ${r.agentId}. Alguem ligou o numero durante a operacao: nao rode --desligar sem falar com quem ligou.`);
      return sair(4);
    }
    console.error(`ATENCAO numero=${ligar}: ${r.motivo}, e NAO foi possivel confirmar a linha (${r.detalhe}). O numero PODE ESTAR LIGADO ao agente ${r.agentId}. Rode --desligar ${ligar} --confirmar-banco ${ref} --se-agente ${r.agentId} e confira antes de qualquer outra coisa.`);
    return sair(3);
  }

  const p = await lerPublicacao();
  if (!p.ok) {
    console.error(`Recusado: a publicacao do ambiente ${ambiente.nome} nao esta parada no ramo ${ambiente.ramo} (${p.motivo}: ${p.detalhe}).`);
    return sair(2);
  }
  if (p.commit !== commit) {
    console.error(`Recusado: os dominios servem ${p.commit.slice(0, 7)} (${p.deploymentId}) e esta copia esta em ${commit.slice(0, 7)}.`);
    return sair(2);
  }
  console.log(`Publicacao: ${ambiente.dominios.join(', ')} servem ${p.commit.slice(0, 7)} (${p.deploymentId})`);

  const organizationId = argumento('--org');
  const incluir = (argumento('--incluir') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

  if (tem('--criar')) {
    if (!organizationId) {
      console.error('--criar exige --org <uuid>: um cliente por vez.');
      return sair(2);
    }
    // Revisão do Codex, 07/10: --org sozinho cria agente para TODOS os grupos prontos do cliente, e o OK de produção é
    // por número. --somente <connectionId> restringe ao grupo desse número; em produção é obrigatório.
    const somente = argumento('--somente');
    if (ambiente.producao && !somente) {
      console.error('Recusado: em producao, --criar exige --somente <connectionId> (so o grupo do numero aprovado).');
      return sair(2);
    }
    if (somente && !ehUuid(somente)) {
      console.error('--somente exige o id (uuid) do numero.');
      return sair(2);
    }
    const plano = await planejarMigracao(admin, { organizationId, incluir, publicacao: { commit: p.commit, deploymentId: p.deploymentId } });
    const grupos = somente ? plano.grupos.filter((g) => g.conexoes.some((c) => c.id === somente)) : plano.grupos;
    if (somente && grupos.length !== 1) {
      console.error(`Recusado: o numero ${somente} nao esta em nenhum grupo deste cliente (confira no --prova).`);
      return sair(2);
    }
    if (somente && !grupos[0].pronto) {
      console.error(`Recusado: o grupo do numero ${somente} nao esta pronto (algum numero dele sem CONFERE).`);
      return sair(2);
    }
    imprimirPlano({ grupos, ignoradas: plano.ignoradas });
    const r = await criarAgentes(admin, { organizationId, grupos, catalogCommit: commit });
    for (const c of r.criados) console.log(`${c.criado ? 'CRIADO' : 'JA EXISTIA'} agente=${c.agentId} org=${c.organizationId}`);
    for (const pulado of r.pulados) console.log(`PULADO sha256=${pulado.sha256.slice(0, 12)} numeros=${pulado.conexoes.join(',')}`);
    return;
  }

  imprimirPlano(await planejarMigracao(admin, { organizationId, incluir, publicacao: { commit: p.commit, deploymentId: p.deploymentId } }));
}

main().catch((erro) => {
  // Só chega aqui erro ANTES de qualquer ligação (ligarComConferencia trata tudo o que acontece depois dela).
  console.error(erro instanceof Error ? erro.message : String(erro));
  process.exitCode = 1;
});
