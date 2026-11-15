/**
 * 聚合 deno info 只收集本次入口所在端及其实际用到的本地目录，
 * 不得把同仓 api／frontend／mobile 一并扫进去。
 */
import { describe, expect, it } from "@dreamer/test";
import {
  join,
  makeTempDir,
  mkdir,
  remove,
  writeTextFile,
} from "@dreamer/runtime-adapter";
import { collectProjectSourceFilesForTests } from "../src/plugins/resolver-deno.ts";

describe("按入口收窄源文件扫描", () => {
  it("后台入口只收集 backend 和它引用的 common，不含 api／frontend／mobile", async () => {
    const root = await makeTempDir({ prefix: "esbuild-collect-ends-" });
    try {
      await mkdir(join(root, "src/backend/routes"), { recursive: true });
      await mkdir(join(root, "src/common"), { recursive: true });
      await mkdir(join(root, "src/api"), { recursive: true });
      await mkdir(join(root, "src/frontend"), { recursive: true });
      await mkdir(join(root, "src/mobile"), { recursive: true });

      await writeTextFile(
        join(root, "deno.json"),
        JSON.stringify({
          imports: {
            "@common/": "./src/common/",
            "@api/": "./src/api/",
            "@frontend/": "./src/frontend/",
            "@mobile/": "./src/mobile/",
          },
        }),
      );
      await writeTextFile(
        join(root, "src/backend/_client.tsx"),
        `import { init } from "@common/init.ts";\nexport const boot = () => import("./routes/home.tsx");\n`,
      );
      await writeTextFile(
        join(root, "src/backend/routes/home.tsx"),
        `export const Home = () => null;\n`,
      );
      await writeTextFile(
        join(root, "src/common/init.ts"),
        `export const init = () => "ok";\n`,
      );
      await writeTextFile(
        join(root, "src/api/server.ts"),
        `export const api = true;\n`,
      );
      await writeTextFile(
        join(root, "src/frontend/app.ts"),
        `export const front = true;\n`,
      );
      await writeTextFile(
        join(root, "src/mobile/app.ts"),
        `export const mobile = true;\n`,
      );

      const files = await collectProjectSourceFilesForTests(
        root,
        join(root, "src/backend/_client.tsx"),
        join(root, "deno.json"),
      );
      const rels = files
        .map((f) => f.slice(root.length).replaceAll("\\", "/"))
        .sort();

      expect(rels).toContain("/src/backend/_client.tsx");
      expect(rels).toContain("/src/backend/routes/home.tsx");
      expect(rels).toContain("/src/common/init.ts");
      expect(rels.some((f) => f.startsWith("/src/api/"))).toBe(false);
      expect(rels.some((f) => f.startsWith("/src/frontend/"))).toBe(false);
      expect(rels.some((f) => f.startsWith("/src/mobile/"))).toBe(false);
    } finally {
      await remove(root, { recursive: true });
    }
  });

  it("若后台实际 import 了 @api，才把 api 收进来", async () => {
    const root = await makeTempDir({ prefix: "esbuild-collect-api-dep-" });
    try {
      await mkdir(join(root, "src/backend"), { recursive: true });
      await mkdir(join(root, "src/api"), { recursive: true });
      await mkdir(join(root, "src/frontend"), { recursive: true });
      await writeTextFile(
        join(root, "deno.json"),
        JSON.stringify({
          imports: {
            "@api/": "./src/api/",
            "@frontend/": "./src/frontend/",
          },
        }),
      );
      await writeTextFile(
        join(root, "src/backend/_client.tsx"),
        `import { ping } from "@api/ping.ts";\nexport { ping };\n`,
      );
      await writeTextFile(
        join(root, "src/api/ping.ts"),
        `export const ping = () => "pong";\n`,
      );
      await writeTextFile(
        join(root, "src/frontend/app.ts"),
        `export const front = true;\n`,
      );

      const files = await collectProjectSourceFilesForTests(
        root,
        join(root, "src/backend/_client.tsx"),
        join(root, "deno.json"),
      );
      const rels = files
        .map((f) => f.slice(root.length).replaceAll("\\", "/"))
        .sort();

      expect(rels).toContain("/src/backend/_client.tsx");
      expect(rels).toContain("/src/api/ping.ts");
      expect(rels.some((f) => f.startsWith("/src/frontend/"))).toBe(false);
    } finally {
      await remove(root, { recursive: true });
    }
  });
});
