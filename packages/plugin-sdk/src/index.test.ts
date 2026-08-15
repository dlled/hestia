import { describe, expect, it } from "vitest";
import { buildIsolatedPluginLaunch, validatePluginManifest } from "./index.js";

const manifest = {
  id: "example-weather",
  name: "Example weather",
  version: "1.0.0",
  apiVersion: "1",
  entrypoint: "dist/plugin.js",
  permissions: { filesystem: "none", network: [], capabilities: ["sensor.read"] },
};

describe("plugin isolation contract", () => {
  it("launches with Node permissions and no network permission", () => {
    const parsed = validatePluginManifest(manifest, "/plugins/example-weather");
    const launch = buildIsolatedPluginLaunch(parsed, "/plugins/example-weather");
    expect(launch.args).toContain("--permission");
    expect(launch.args.some((argument) => argument.startsWith("--allow-fs-read="))).toBe(true);
    expect(launch.args).not.toContain("--allow-net");
  });

  it("rejects traversal and direct network permissions", () => {
    expect(() =>
      validatePluginManifest({ ...manifest, entrypoint: "../escape.js" }, "/plugins/example"),
    ).toThrow();
    expect(() =>
      validatePluginManifest(
        {
          ...manifest,
          permissions: { ...manifest.permissions, network: ["*"] },
        },
        "/plugins/example",
      ),
    ).toThrow();
  });
});
