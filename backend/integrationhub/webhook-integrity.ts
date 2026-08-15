import { createHmac, timingSafeEqual } from "node:crypto";

export const WEBHOOK_MAX_AGE_SECONDS = 300;

export function signWebhook(body: Uint8Array, timestamp: string, key: string): string {
  return `v1=${createHmac("sha256", key).update(timestamp).update(".").update(body).digest("hex")}`;
}

export function verifyWebhook(input: {
  body: Uint8Array;
  timestamp: string | undefined;
  signature: string | undefined;
  key: string;
  now?: Date;
}): boolean {
  if (!input.timestamp || !input.signature) return false;
  const timestampSeconds = Number(input.timestamp);
  if (!Number.isInteger(timestampSeconds)) return false;
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1_000);
  if (Math.abs(nowSeconds - timestampSeconds) > WEBHOOK_MAX_AGE_SECONDS) return false;
  const expected = Buffer.from(signWebhook(input.body, input.timestamp, input.key));
  const supplied = Buffer.from(input.signature);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
