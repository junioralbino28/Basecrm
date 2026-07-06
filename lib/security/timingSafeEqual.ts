import { timingSafeEqual } from 'crypto';

/**
 * Comparação de string em tempo constante (evita timing attack em secret/token).
 *
 * Retorna false imediatamente quando os tamanhos diferem (o próprio timingSafeEqual
 * do Node exige buffers do mesmo tamanho). Compartilhado entre o auth do webhook
 * Evolution (achado C3) e o guard do instalador (achado X) para não duplicar.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
