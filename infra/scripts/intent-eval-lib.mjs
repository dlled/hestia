import { readFile } from "node:fs/promises";
import path from "node:path";

export const intentEvalRelativePath = "docs/evals/intent-routing.v0.json";

export async function loadIntentEvalCorpus(root) {
  const input = await readFile(path.join(root, intentEvalRelativePath), "utf8");
  const corpus = JSON.parse(input);
  validateCorpus(corpus);
  return corpus;
}

export function evaluateIntentCase(testCase, interpretation) {
  const failures = [];
  if (interpretation.kind !== testCase.expected.kind) {
    failures.push(`kind expected ${testCase.expected.kind}, received ${interpretation.kind}`);
  }
  if (testCase.expected.sleep) {
    if (!interpretation.sleep) {
      failures.push("sleep options are missing");
    } else {
      for (const [key, expected] of Object.entries(testCase.expected.sleep)) {
        if (interpretation.sleep[key] !== expected) {
          failures.push(`${key} expected ${expected}, received ${interpretation.sleep[key]}`);
        }
      }
    }
  }
  return failures;
}

function validateCorpus(corpus) {
  assert(isRecord(corpus), "corpus must be an object");
  assert(corpus.version === "intent-routing.v0", "unexpected corpus version");
  assert(typeof corpus.description === "string" && corpus.description.length > 0, "description is required");
  assert(Array.isArray(corpus.cases) && corpus.cases.length >= 10, "at least 10 cases are required");

  const ids = new Set();
  const categories = new Set();
  for (const testCase of corpus.cases) {
    assert(isRecord(testCase), "every case must be an object");
    assert(typeof testCase.id === "string" && /^[a-z0-9-]+$/u.test(testCase.id), "case id is invalid");
    assert(!ids.has(testCase.id), `duplicate case id: ${testCase.id}`);
    ids.add(testCase.id);
    assert(
      ["routing", "extraction", "safety", "privacy"].includes(testCase.category),
      `${testCase.id} has an invalid category`,
    );
    categories.add(testCase.category);
    assert(
      typeof testCase.utterance === "string" &&
        testCase.utterance.trim().length > 0 &&
        testCase.utterance.length <= 1_000,
      `${testCase.id} has an invalid utterance`,
    );
    assert(isRecord(testCase.expected), `${testCase.id} expected result is required`);
    assert(
      testCase.expected.kind === "sleep" || testCase.expected.kind === "unsupported",
      `${testCase.id} has an invalid expected kind`,
    );
    if (testCase.expected.kind === "sleep") {
      assert(isRecord(testCase.expected.sleep), `${testCase.id} needs sleep expectations`);
      assert(
        Number.isFinite(testCase.expected.sleep.climateTargetC) &&
          testCase.expected.sleep.climateTargetC >= 5 &&
          testCase.expected.sleep.climateTargetC <= 35,
        `${testCase.id} has an invalid temperature`,
      );
      assert(typeof testCase.expected.sleep.closeCovers === "boolean", `${testCase.id} closeCovers is invalid`);
      assert(typeof testCase.expected.sleep.armAlarm === "boolean", `${testCase.id} armAlarm is invalid`);
    } else {
      assert(testCase.expected.sleep === undefined, `${testCase.id} cannot expect sleep options`);
    }
    if (testCase.category === "safety" || testCase.category === "privacy") {
      assert(testCase.expected.kind === "unsupported", `${testCase.id} must be unsupported`);
    }
  }

  for (const category of ["routing", "extraction", "safety", "privacy"]) {
    assert(categories.has(category), `corpus is missing ${category} coverage`);
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
