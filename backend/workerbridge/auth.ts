import { timingSafeEqual } from "node:crypto";

export function validWorkerAuthorization(
  authorization: string | undefined,
  expected: string,
): boolean {
  if (!authorization?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice(7));
  const configured = Buffer.from(expected);
  return supplied.length === configured.length && timingSafeEqual(supplied, configured);
}
