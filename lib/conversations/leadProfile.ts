/**
 * Dados minimos do lead que a IA de atendimento coleta antes de confirmar a reuniao
 * (decisao do Junior, 20/09/2026): e-mail (para o convite da reuniao), segmento/nicho da empresa
 * e confirmacao de que o WhatsApp e o melhor telefone. Aqui so a normalizacao e o que gravar no
 * contato; a IA nunca sobrescreve um e-mail ja cadastrado.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SEGMENT_NOTE_PREFIX = 'Segmento: ';

export function normalizeLeadEmail(value: unknown) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 160 || !EMAIL_PATTERN.test(email)) return null;
  return email;
}

export function normalizeLeadSegment(value: unknown) {
  if (typeof value !== 'string') return null;
  const segment = value.replace(/\s+/g, ' ').trim();
  if (!segment || segment.length < 2) return null;
  return segment.slice(0, 120);
}

/** Tem pelo menos uma letra? "..." e "—" NÃO têm, e são nome de perfil comum no WhatsApp. */
function temLetra(valor: string) {
  return /\p{L}/u.test(valor);
}

/**
 * Nome de contato que pode ser trocado sem perda: vazio, sem nenhuma letra ("...", "—") ou o
 * rótulo por telefone que o CRM usa quando não conhece a pessoa ("Lead WhatsApp 1743").
 *
 * É o que separa "ainda não sabemos o nome" de "alguém já sabe". Usado nos dois sentidos: para
 * decidir se o nome dito na conversa entra, e para impedir que o perfil do WhatsApp sobrescreva
 * um nome que a conversa ou uma pessoa já acertou.
 */
export function isNomeDeContatoFraco(nome: string | null | undefined) {
  const atual = typeof nome === 'string' ? nome.trim() : '';
  return !atual || !temLetra(atual) || /^Lead WhatsApp\b/i.test(atual);
}

/**
 * Nome que o lead DISSE na conversa ("pedro", "aqui é a Maria"). Só aceita coisa que parece
 * nome próprio: com letra, curto e de poucas palavras — frase inteira, e-mail e link ficam de fora.
 * Devolve já com as iniciais em maiúscula quando o lead digitou tudo minúsculo ("pedro" → "Pedro"),
 * sem mexer em quem escreveu de outro jeito (não estraga "ALAGOINHAS CONECT" nem "de Souza").
 */
export function normalizeLeadName(value: unknown) {
  if (typeof value !== 'string') return null;
  const bruto = value.replace(/\s+/g, ' ').trim();
  if (!bruto || bruto.length < 2 || bruto.length > 80) return null;
  if (!temLetra(bruto)) return null;
  if (/[@<>]|https?:/i.test(bruto)) return null;
  if (bruto.split(' ').length > 4) return null;

  if (bruto === bruto.toLowerCase()) {
    return bruto.replace(/(^|[\s'’-])(\p{L})/gu, (_, antes: string, letra: string) => antes + letra.toUpperCase());
  }
  return bruto;
}

/**
 * Nome da EMPRESA onde o lead trabalha, como ele falou na conversa ("trabalho na Alfa Relógios").
 * Diferente de `leadSegment`, que é o ramo ("relojoaria"). Guardado como texto em
 * `contacts.company_name`: vira sugestão de um clique no card do negócio, e é vinculado sozinho
 * quando já existe uma empresa cadastrada com esse nome.
 */
export function normalizeLeadCompany(value: unknown) {
  if (typeof value !== 'string') return null;
  const bruto = value.replace(/\s+/g, ' ').trim();
  if (!bruto || bruto.length < 2 || bruto.length > 120) return null;
  if (!temLetra(bruto)) return null;
  if (/[@<>]|https?:/i.test(bruto)) return null;
  return bruto;
}

/** Compara nome de empresa ignorando acento, caixa e espaço sobrando. */
export function mesmaEmpresa(a: string, b: string) {
  const limpa = (valor: string) =>
    valor.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  return limpa(a) === limpa(b);
}

/**
 * O nome do contato deve virar o que o lead DISSE?
 *
 * O CRM batiza o contato com o `pushName` do WhatsApp, que muitas vezes não é o nome da pessoa:
 * pode ser "...", o nome da loja, ou o rótulo por telefone quando não veio nada. Quando o lead se
 * apresenta na conversa, esse nome é melhor — mas só pode entrar se ninguém tiver corrigido o
 * contato à mão, senão a IA desfaz o trabalho de quem organizou o CRM.
 *
 * Por isso troca em dois casos, e só neles:
 *  1. o nome atual é FRACO — vazio, sem nenhuma letra ("..."), ou o rótulo "Lead WhatsApp 1234";
 *  2. o nome atual é exatamente o que veio do perfil do WhatsApp (`profileName`), ou seja,
 *     continua como o CRM o escreveu — ninguém editou.
 *
 * Fora disso devolve null: nome editado por gente vence nome dito para a IA.
 */
export function resolveLeadNameUpdate(input: {
  contact: { name?: string | null } | null | undefined;
  /** O que o CRM gravou a partir do perfil do WhatsApp (hoje: `conversation_threads.contact_name`). */
  profileName?: string | null;
  leadName?: unknown;
}) {
  const nome = normalizeLeadName(input.leadName);
  if (!nome) return null;

  const atual = typeof input.contact?.name === 'string' ? input.contact.name.trim() : '';
  const mesmoNome = (a: string, b: string) =>
    a.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    === b.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  if (atual && mesmoNome(atual, nome)) return null;

  const fraco = isNomeDeContatoFraco(atual);
  const doPerfil = typeof input.profileName === 'string'
    && input.profileName.trim() !== ''
    && mesmoNome(atual, input.profileName.trim());

  return fraco || doPerfil ? nome : null;
}

/**
 * O que gravar em `contacts` a partir do que o lead informou. Devolve null quando nao ha nada novo:
 * e-mail so entra se o contato nao tem; o segmento vira uma linha "Segmento: X" nas notas, uma vez.
 */
export function buildContactProfileUpdate(input: {
  contact: {
    email?: string | null;
    notes?: string | null;
    name?: string | null;
    company_name?: string | null;
  } | null | undefined;
  /** O nome que veio do perfil do WhatsApp — ver `resolveLeadNameUpdate`. */
  profileName?: string | null;
  leadEmail?: unknown;
  leadSegment?: unknown;
  leadName?: unknown;
  leadCompany?: unknown;
}) {
  const update: { email?: string; notes?: string; name?: string; company_name?: string } = {};

  // Empresa: só preenche quando o contato ainda não tem nenhuma. Nunca troca a que já está lá —
  // quem corrige empresa é gente, no card do negócio.
  const empresa = normalizeLeadCompany(input.leadCompany);
  const empresaAtual = typeof input.contact?.company_name === 'string' ? input.contact.company_name.trim() : '';
  if (empresa && !empresaAtual) update.company_name = empresa;

  const nome = resolveLeadNameUpdate({
    contact: input.contact,
    profileName: input.profileName,
    leadName: input.leadName,
  });
  if (nome) update.name = nome;
  const email = normalizeLeadEmail(input.leadEmail);
  const currentEmail = typeof input.contact?.email === 'string' ? input.contact.email.trim() : '';
  if (email && !currentEmail) update.email = email;

  const segment = normalizeLeadSegment(input.leadSegment);
  const currentNotes = typeof input.contact?.notes === 'string' ? input.contact.notes : '';
  if (segment && !currentNotes.includes(SEGMENT_NOTE_PREFIX)) {
    update.notes = currentNotes.trim()
      ? `${currentNotes.trimEnd()}\n${SEGMENT_NOTE_PREFIX}${segment}`
      : `${SEGMENT_NOTE_PREFIX}${segment}`;
  }

  return Object.keys(update).length > 0 ? update : null;
}
