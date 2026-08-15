import { resolve, sep } from "node:path";
import { z } from "zod";

export const PluginManifestSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/u),
  name: z.string().min(1).max(100),
  version: z.string().regex(/^\d+\.\d+\.\d+$/u),
  apiVersion: z.literal("1"),
  entrypoint: z.string().min(1),
  permissions: z.strictObject({
    filesystem: z.literal("none").default("none"),
    network: z.array(z.never()).default([]),
    capabilities: z.array(z.string().min(1)).default([]),
  }),
});

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export function validatePluginManifest(input: unknown, pluginDirectory: string): PluginManifest {
  const manifest = PluginManifestSchema.parse(input);
  const root = resolve(pluginDirectory);
  const entrypoint = resolve(root, manifest.entrypoint);
  if (!entrypoint.startsWith(`${root}${sep}`))
    throw new Error("Plugin entrypoint must stay inside its package");
  return manifest;
}

export function buildIsolatedPluginLaunch(
  manifest: PluginManifest,
  pluginDirectory: string,
): {
  executable: string;
  args: string[];
  env: Record<string, string>;
} {
  const root = resolve(pluginDirectory);
  const entrypoint = resolve(root, manifest.entrypoint);
  return {
    executable: process.execPath,
    args: ["--permission", `--allow-fs-read=${root}`, entrypoint],
    env: {
      NODE_ENV: "production",
      HESTIA_PLUGIN_ID: manifest.id,
      HESTIA_PLUGIN_CAPABILITIES: manifest.permissions.capabilities.join(","),
    },
  };
}
