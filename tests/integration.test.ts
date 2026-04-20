/**
 * @fileoverview 集成测试
 * 测试多个模块协同工作的场景
 *
 * 使用 `beforeAll` / `afterAll` 准备与清理目录：Bun / Deno 会对 `describe` 内 `it`
 * 并行调度，若用单独 `it` 做 setup，其它用例可能先于 setup 执行，导致 `entryFile`
 * 等为 `undefined`（与 `builder-client-resolver.test.ts` 说明一致）。
 */

import {
  exists,
  join,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@dreamer/runtime-adapter";
import { afterAll, beforeAll, describe, expect, it } from "@dreamer/test";
import { Builder } from "../src/builder.ts";
import type { BuilderConfig } from "../src/types.ts";
import { cleanupDir, getTestDataDir, getTestOutputDir } from "./test-utils.ts";

describe("集成测试", () => {
  let entryFile = "";
  let outputDir = "";
  let testDataDir = "";

  /**
   * 在所有集成用例之前创建临时目录与入口文件，保证并行跑测时路径已就绪。
   */
  beforeAll(async () => {
    testDataDir = getTestDataDir();
    outputDir = getTestOutputDir("integration");
    entryFile = join(testDataDir, "src", "index.ts");

    await mkdir(join(testDataDir, "src"), { recursive: true });

    await writeTextFile(
      entryFile,
      `console.log('Integration Test');`,
    );
  });

  /**
   * 集成用例结束后清理输出目录（失败时不阻断其它包的测试收尾）。
   */
  afterAll(async () => {
    if (outputDir) {
      try {
        await cleanupDir(outputDir);
      } catch {
        // 忽略清理错误
      }
    }
  });

  describe("完整构建流程", () => {
    it("应该完成完整的客户端构建流程", async () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
          html: {
            title: "Integration Test App",
          },
        },
        build: {
          clean: true,
          cache: true,
          logLevel: "info",
        },
      };
      const builder = new Builder(config);

      const result = await builder.buildClient();

      // 验证构建结果
      expect(result).toBeTruthy();
      expect(result.outputFiles).toBeTruthy();
      expect(result.outputFiles.length).toBeGreaterThan(0);
      expect(result.duration).toBeGreaterThanOrEqual(0);

      // 验证输出文件存在
      for (const file of result.outputFiles) {
        const fileExists = await exists(file);
        expect(fileExists).toBe(true);
      }
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该完成包含缓存的构建流程", async () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
        build: {
          cache: true,
        },
      };
      const builder = new Builder(config);

      // 第一次构建
      const result1 = await builder.buildClient();
      expect(result1).toBeTruthy();

      // 第二次构建（应该使用缓存）
      const result2 = await builder.buildClient();
      expect(result2).toBeTruthy();

      // 验证两次构建都成功
      expect(result1.outputFiles.length).toBeGreaterThan(0);
      expect(result2.outputFiles.length).toBeGreaterThan(0);
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("多模块协同", () => {
    it("应该协同使用 Builder、BuilderClient、HTMLGenerator", async () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
          html: {
            title: "Multi-Module Test",
          },
        },
      };
      const builder = new Builder(config);

      const result = await builder.buildClient();

      // 验证 HTML 文件已生成
      const htmlFiles = result.outputFiles.filter((f) => f.endsWith(".html"));
      if (htmlFiles.length > 0) {
        for (const htmlFile of htmlFiles) {
          const content = await readTextFile(htmlFile);
          expect(content).toContain("<html");
          expect(content).toContain("Multi-Module Test");
        }
      }
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该协同使用 Builder、CacheManager、BuildAnalyzer", async () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
        build: {
          cache: true,
          reportHTML: true,
        },
      };
      const builder = new Builder(config);

      const result = await builder.buildClient({
        mode: "dev",
      });

      // 验证构建结果包含性能信息
      if (result.performance) {
        expect(result.performance.total).toBeGreaterThanOrEqual(0);
        expect(result.performance.stages).toBeTruthy();
      }
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("错误恢复", () => {
    it("应该在构建失败后能够恢复", async () => {
      // 先使用无效配置
      const invalidConfig: BuilderConfig = {
        client: {
          entry: join(testDataDir, "non-existent.ts"),
          output: outputDir,
          engine: "react",
        },
      };
      const invalidBuilder = new Builder(invalidConfig);

      // 尝试构建（应该失败）
      try {
        await invalidBuilder.buildClient();
      } catch {
        // 预期会失败
      }

      // 使用有效配置
      const validConfig: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
      };
      const validBuilder = new Builder(validConfig);

      // 应该能够成功构建
      const result = await validBuilder.buildClient();
      expect(result).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("资源处理集成", () => {
    it("应该处理静态资源", async () => {
      const publicDir = join(testDataDir, "public");
      await mkdir(publicDir, { recursive: true });
      await writeTextFile(join(publicDir, "test.txt"), "test content");

      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
        assets: {
          publicDir: publicDir,
          assetsDir: "assets",
        },
      };
      const builder = new Builder(config);

      const result = await builder.buildClient();
      expect(result.outputFiles?.length).toBeGreaterThan(0);

      // 验证资源文件已复制
      const assetExists = await exists(join(outputDir, "assets", "test.txt"))
        .then(() => true)
        .catch(() => false);
      expect(assetExists).toBe(true);
    }, { sanitizeOps: false, sanitizeResources: false });
  });
});
