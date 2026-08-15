import { describe, expect, it } from "vitest";
import { signWebhook, verifyWebhook } from "./webhook-integrity";

describe("integration webhook integrity", () => {
  const key = "test-signing-key-with-at-least-32-bytes";
  const body = Buffer.from('{"eventId":"evt_1"}');
  const now = new Date("2026-08-15T12:00:00.000Z");
  const timestamp = String(Math.floor(now.getTime() / 1_000));

  it("accepts an intact, fresh payload", () => {
    expect(
      verifyWebhook({ body, timestamp, signature: signWebhook(body, timestamp, key), key, now }),
    ).toBe(true);
  });

  it("rejects body tampering and stale timestamps", () => {
    const signature = signWebhook(body, timestamp, key);
    expect(verifyWebhook({ body: Buffer.from("tampered"), timestamp, signature, key, now })).toBe(
      false,
    );
    expect(
      verifyWebhook({ body, timestamp, signature, key, now: new Date("2026-08-15T12:06:00.000Z") }),
    ).toBe(false);
  });
});
