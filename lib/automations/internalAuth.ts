import { timingSafeEqual } from 'node:crypto';

export function authorizeAutomationInternalRequest(
  request: Request,
  expectedSecret: string | undefined,
): boolean {
  const secret = expectedSecret?.trim();
  if (!secret) return false;

  const authorization = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  const actualBuffer = Buffer.from(authorization);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(actualBuffer, expectedBuffer);
}
