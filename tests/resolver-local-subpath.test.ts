/**
 * 本地依赖子路径解析：deno.json imports 的 ./／file: 映射 + package.json exports
 * （对齐已有 jsr／npm 子路径能力）
 */
import {
  IS_BUN,
  IS_DENO,
  join,
  mkdir,
  writeTextFile,
} from "@dreamer/runtime-adapter";
import { describe, expect, it } from "@dreamer/test";
import { buildBundle } from "../src/builder-bundle.ts";
import { bunResolverPlugin } from "../src/plugins/resolver-bun.ts";
import { denoResolverPlugin } from "../src/plugins/resolver-deno.ts";
import { cleanupDir, getTestOutputDir } from "./test-utils.ts";

async function scaffoldLocalPkg(root: string): Promise<void> {
  await mkdir(join(root, "vendor", "pkg", "src"), { recursive: true });
  await writeTextFile(
    join(root, "vendor", "pkg", "package.json"),
    JSON.stringify(
      {
        name: "@local/pkg",
        type: "module",
        exports: {
          ".": "./src/mod.ts",
          "./client": "./src/client.ts",
        },
      },
      null,
      2,
    ),
  );
  await writeTextFile(
    join(root, "vendor", "pkg", "src", "mod.ts"),
    'export const fromMod = "mod-ok";\n',
  );
  await writeTextFile(
    join(root, "vendor", "pkg", "src", "client.ts"),
    'export const fromClient = "client-ok";\n',
  );
  await mkdir(join(root, "src"), { recursive: true });
  await writeTextFile(
    join(root, "src", "entry.ts"),
    `import { fromClient } from "@local/pkg/client";
export const v = fromClient;
`,
  );
}

if (IS_DENO) {
  describe("Deno 本地依赖子路径", () => {
    it("deno.json 将包映射到本地目录时，应解析 @local/pkg/client（exports）", async () => {
      const root = getTestOutputDir("resolver-local-subpath-deno");
      try {
        await scaffoldLocalPkg(root);
        await writeTextFile(
          join(root, "deno.json"),
          JSON.stringify(
            {
              imports: {
                "@local/pkg": "./vendor/pkg",
              },
            },
            null,
            2,
          ),
        );
        const result = await buildBundle({
          entryPoint: join(root, "src", "entry.ts"),
          globalName: "LocalSubpathDeno",
          platform: "browser",
          format: "iife",
          plugins: [denoResolverPlugin({ projectDir: root })],
        });
        expect(result.code).toContain("client-ok");
        expect(result.code).toContain("LocalSubpathDeno");
      } finally {
        await cleanupDir(root);
      }
    }, { sanitizeOps: false, sanitizeResources: false });

    it("deno.json file: 映射本地包根时，应解析子路径", async () => {
      const root = getTestOutputDir("resolver-local-subpath-deno-file");
      try {
        await scaffoldLocalPkg(root);
        const pkgRoot = join(root, "vendor", "pkg");
        // file: URL absolute
        const fileUrl = "file://" + pkgRoot;
        await writeTextFile(
          join(root, "deno.json"),
          JSON.stringify(
            {
              imports: {
                "@local/pkg": fileUrl,
              },
            },
            null,
            2,
          ),
        );
        const result = await buildBundle({
          entryPoint: join(root, "src", "entry.ts"),
          globalName: "LocalSubpathFile",
          platform: "browser",
          format: "iife",
          plugins: [denoResolverPlugin({ projectDir: root })],
        });
        expect(result.code).toContain("client-ok");
      } finally {
        await cleanupDir(root);
      }
    }, { sanitizeOps: false, sanitizeResources: false });
  });
}

if (IS_BUN) {
  describe("Bun 本地依赖子路径", () => {
    it("package.json file: 依赖应解析 @local/pkg/client（exports）", async () => {
      const root = getTestOutputDir("resolver-local-subpath-bun");
      try {
        await scaffoldLocalPkg(root);
        await writeTextFile(
          join(root, "package.json"),
          JSON.stringify(
            {
              name: "local-subpath-bun-app",
              type: "module",
              dependencies: {
                "@local/pkg": "file:./vendor/pkg",
              },
            },
            null,
            2,
          ),
        );
        const result = await buildBundle({
          entryPoint: join(root, "src", "entry.ts"),
          globalName: "LocalSubpathBun",
          platform: "browser",
          format: "iife",
          plugins: [bunResolverPlugin()],
        });
        expect(result.code).toContain("client-ok");
      } finally {
        await cleanupDir(root);
      }
    }, { sanitizeOps: false, sanitizeResources: false });
  });
}
