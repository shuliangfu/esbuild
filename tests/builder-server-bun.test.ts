/**
 * @fileoverview BuilderServer Bun 环境专用测试
 *
 * 测试 buildWithBun 使用 --outdir 输出多文件（server.js + 原生 .node 等）的场景。
 * 仅当 IS_BUN 为 true 时执行。
 */

import {
  exists,
  IS_BUN,
  join,
  mkdir,
  readdir,
  writeTextFile,
} from "@dreamer/runtime-adapter";
import { afterAll, beforeAll, describe, expect, it } from "@dreamer/test";
import { BuilderServer } from "../src/builder-server.ts";
import type { ServerConfig } from "../src/types.ts";
import { cleanupDir, getTestDataDir, getTestOutputDir } from "./test-utils.ts";

if (IS_BUN) {
  describe("BuilderServer Bun 环境 (buildWithBun)", () => {
  let entryDir: string;
  let entryFile: string;
  let outputDir: string;
  let testDataDir: string;

  beforeAll(async () => {
    testDataDir = getTestDataDir();
      const bunTestDir = join(testDataDir, "bun-server-test");
      entryDir = join(bunTestDir, "src");
      entryFile = join(entryDir, "main.ts");
      outputDir = getTestOutputDir("bun-server-out");

      await mkdir(entryDir, { recursive: true });
      await mkdir(outputDir, { recursive: true });

      // package.json 需在 entryDir（src/）内，buildWithBun 据此确定 workDir
      await writeTextFile(
        join(entryDir, "package.json"),
        JSON.stringify({ name: "bun-server-test", type: "module" }, null, 2),
      );

      // 创建简单入口（不导入 tailwind/lightningcss，避免依赖问题）
      await writeTextFile(
        entryFile,
        `console.log("Bun server build test");\nexport default {};`,
      );
    });

    afterAll(async () => {
      try {
        await cleanupDir(join(testDataDir, "bun-server-test"));
        await cleanupDir(outputDir);
      } catch {
        // 忽略
      }
    });

  it("应使用 buildWithBun 成功构建并输出 server.js", async () => {
    const config: ServerConfig = {
      entry: entryFile,
      output: outputDir,
      external: ["tailwindcss", "lightningcss"],
    };

    const builder = new BuilderServer(config);
    const result = await builder.build("prod");

    expect(result).toBeTruthy();
    expect(result.outputFiles).toBeTruthy();
    expect(result.outputFiles!.length).toBeGreaterThan(0);

    const serverJs = join(outputDir, "server.js");
    expect(await exists(serverJs)).toBe(true);

    const entries = await readdir(outputDir);
    const serverEntry = entries.find((e) => e.name === "server.js");
    expect(serverEntry).toBeDefined();
  }, { sanitizeOps: false, sanitizeResources: false, timeout: 15000 });

  it("应在 write:false 时返回 outputContents", async () => {
    const config: ServerConfig = {
      entry: entryFile,
      output: outputDir,
      external: ["tailwindcss", "lightningcss"],
    };

    const builder = new BuilderServer(config);
    const result = await builder.build({ mode: "prod", write: false });

    expect(result).toBeTruthy();
    expect(result.outputContents).toBeTruthy();
    expect(result.outputContents!.length).toBeGreaterThan(0);
    expect(result.outputContents![0].text).toContain("Bun server build test");
  }, { sanitizeOps: false, sanitizeResources: false, timeout: 15000 });
  });
}
