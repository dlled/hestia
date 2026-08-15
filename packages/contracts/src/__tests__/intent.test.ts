import { describe, expect, it } from "vitest";
import { IntentInterpretationSchema, ResidentIntentRequestSchema } from "../intent.js";

describe("resident intent contracts", () => {
  it("normalizes a resident request", () => {
    expect(ResidentIntentRequestSchema.parse({ utterance: "  I'm going to sleep  " })).toEqual({
      utterance: "I'm going to sleep",
      requestedBy: "resident",
    });
  });

  it("rejects model fields outside the strict allow-list", () => {
    expect(() =>
      IntentInterpretationSchema.parse({
        kind: "sleep",
        confidence: 1,
        summary: "Sleep routine",
        sleep: { climateTargetC: 18, closeCovers: true, armAlarm: false },
        shell: "rm -rf /",
      }),
    ).toThrow();
  });

  it("requires parameters only for a supported sleep intent", () => {
    expect(() =>
      IntentInterpretationSchema.parse({
        kind: "unsupported",
        confidence: 0.4,
        summary: "Not supported",
        sleep: { climateTargetC: 18, closeCovers: true, armAlarm: false },
      }),
    ).toThrow();
  });
});
