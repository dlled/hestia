#!/usr/bin/env node

process.env.HESTIA_PHASE3_BLACKBOX = "true";
await import("./phase2-blackbox.mjs");
