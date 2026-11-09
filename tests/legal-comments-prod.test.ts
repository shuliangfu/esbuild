/**
 * 生产默认 legalComments:"none"：砍 /*! … *／ 等 license 注释；minify 生产仍默认开。
 */
import {
  join,
  mkdir,
  writeTextFile,
} from "@dreamer/runtime-adapter";
import { describe, expect, it } from "@dreamer/test";
import { buildBundle } from "../src/builder-bundle.ts";
import { BuilderClient } from "../src/builder-client.ts";
import { BuilderServer } from "../src/builder-server.ts";
import { denoResolverPlugin } from "../src/plugins/resolver-deno.ts";
import { cleanupDir, getTestOutputDir } from "./test-utils.ts";

const LICENSE = "/*! MIT License - keep me unless legalComments none */";

async function writeLicensedEntry(dir: string, name = "entry.ts"): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  await writeTextFile(
    path,
    `${LICENSE}
export const marker = "legal-comments-marker";
`,
  );
  return path;
}

describe("legalComments 生产默认", () => {
  it("buildBundle：minify 时默认去掉 legal 注释", async () => {
    const root = getTestOutputDir("legal-comments-bundle");
    try {
      const entry = await writeLicensedEntry(root);
      const minified = await buildBundle({
        entryPoint: entry,
        globalName: "LegalBundle",
        platform: "browser",
        format: "iife",
        minify: true,
        plugins: [denoResolverPlugin({ projectDir: root })],
      });
      expect(minified.code).toContain("legal-comments-marker");
      expect(minified.code).not.toContain("MIT License");

      const kept = await buildBundle({
        entryPoint: entry,
        globalName: "LegalBundleKeep",
        platform: "browser",
        format: "iife",
        minify: true,
        legalComments: "inline",
        plugins: [denoResolverPlugin({ projectDir: root })],
      });
      expect(kept.code).toContain("MIT License");
    } finally {
      await cleanupDir(root);
    }
  }, { sanitizeOps: false, sanitizeResources: false });

  it("BuilderClient prod：默认 minify + legalComments none", async () => {
    const root = getTestOutputDir("legal-comments-client");
    try {
      const entry = await writeLicensedEntry(root, "client-entry.ts");
      const out = join(root, "out");
      await mkdir(out, { recursive: true });
      const builder = new BuilderClient({
        entry,
        output: out,
        engine: "view",
        bundle: {
          minify: true,
          splitting: false,
          format: "esm",
        },
      });
      const result = await builder.build({ mode: "prod", write: false });
      const codes = (result.outputContents ?? [])
        .map((f) => f.text)
        .join("\n");
      expect(codes.length).toBeGreaterThan(0);
      expect(codes).toContain("legal-comments-marker");
      expect(codes).not.toContain("MIT License");
    } finally {
      await cleanupDir(root);
    }
  }, { sanitizeOps: false, sanitizeResources: false });

  it("BuilderServer prod：默认 minify 仍开，且去掉 legal 注释", async () => {
    const root = getTestOutputDir("legal-comments-server");
    try {
      const entry = await writeLicensedEntry(root, "server-entry.ts");
      await writeTextFile(
        join(root, "deno.json"),
        JSON.stringify({ imports: {} }, null, 2),
      );
      const out = join(root, "dist");
      const builder = new BuilderServer({
        entry,
        output: out,
        externalNpm: true,
      });
      const result = await builder.build({ mode: "prod", write: false });
      const codes = (result.outputContents ?? [])
        .map((f) => f.text)
        .join("\n");
      // prod 默认 minify：输出不应保留完整多行 license 头
      expect(codes.length).toBeGreaterThan(0);
      expect(codes).toContain("legal-comments-marker");
      expect(codes).not.toContain("MIT License");
    } finally {
      await cleanupDir(root);
    }
  }, { sanitizeOps: false, sanitizeResources: false });
});
