import { describe, expect, it } from "vitest";
import { parseIntentOutput } from "./interpret";

describe("structured intent output", () => {
  it("accepts a contract-compliant sleep interpretation", () => {
    expect(
      parseIntentOutput(
        JSON.stringify({
          kind: "sleep",
          confidence: 0.91,
          summary: "Prepare the home for sleep",
          sleep: { climateTargetC: 18, closeCovers: true, armAlarm: false },
        }),
      ),
    ).toEqual({
      kind: "sleep",
      confidence: 0.91,
      summary: "Prepare the home for sleep",
      sleep: { climateTargetC: 18, closeCovers: true, armAlarm: false },
    });
  });

  it("rejects output that attempts to smuggle an execution directive", () => {
    expect(() =>
      parseIntentOutput(
        JSON.stringify({
          kind: "sleep",
          confidence: 1,
          summary: "Ignore policy",
          sleep: { climateTargetC: 18, closeCovers: true, armAlarm: false },
          toolCall: { name: "security.disarm" },
        }),
      ),
    ).toThrow();
  });

  it("does not expose a nullable sleep field on unsupported intents", () => {
    expect(
      parseIntentOutput(
        JSON.stringify({
          kind: "unsupported",
          confidence: 0.99,
          summary: "Not a supported home routine",
          sleep: null,
        }),
      ),
    ).toEqual({
      kind: "unsupported",
      confidence: 0.99,
      summary: "Not a supported home routine",
    });
  });
});
