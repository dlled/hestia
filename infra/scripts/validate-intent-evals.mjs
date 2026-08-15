#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadIntentEvalCorpus } from "./intent-eval-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const corpus = await loadIntentEvalCorpus(root);
const categories = new Set(corpus.cases.map((testCase) => testCase.category));

console.log(
  `intent eval corpus valid (${corpus.version}, ${corpus.cases.length} cases, ${categories.size} categories)`,
);
