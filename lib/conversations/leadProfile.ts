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

/**
 * O que gravar em `contacts` a partir do que o lead informou. Devolve null quando nao ha nada novo:
 * e-mail so entra se o contato nao tem; o segmento vira uma linha "Segmento: X" nas notas, uma vez.
 */
export function buildContactProfileUpdate(input: {
  contact: { email?: string | null; notes?: string | null } | null | undefined;
  leadEmail?: unknown;
  leadSegment?: unknown;
}) {
  const update: { email?: string; notes?: string } = {};
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
