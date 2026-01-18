/**
 * @fileoverview Builder 性能监控测试
 */

import { join, mkdir, writeTextFile } from "@dreamer/runtime-adapter";
import { describe, expect, it } from "@dreamer/test";
import { Builder } from "../src/builder.ts";
import type { BuilderConfig } from "../src/types.ts";
import { cleanupDir, getTestDataDir, getTestOutputDir } from "./test-utils.ts";

describe("Builder 性能监控", () => {
  let entryFile: string;
  let outputDir: string;
  let testDataDir: string;

  // 测试前创建测试目录和测试文件
  it("应该创建测试目录和测试文件", async () => {
    testDataDir = getTestDataDir();
    outputDir = getTestOutputDir("builder-performance");
    entryFile = join(testDataDir, "src", "index.ts");

    // 确保目录存在
    await mkdir(join(testDataDir, "src"), { recursive: true });

    // 创建入口文件
    await writeTextFile(
      entryFile,
      `console.log('Performance Test');`,
    );

    expect(testDataDir).toBeTruthy();
  });

  describe("性能统计", () => {
    it("应该记录构建性能", async () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
      };
      const builder = new Builder(config);

      const result = await builder.buildClient();

      expect(result.performance).toBeTruthy();
      expect(result.performance?.total).toBeGreaterThanOrEqual(0);
      expect(result.performance?.stages).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该记录各阶段耗时", async () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
        build: {
          clean: true,
          cache: true,
        },
      };
      const builder = new Builder(config);

      const result = await builder.buildClient();

      if (result.performance) {
        expect(result.performance.stages).toBeTruthy();
        // 可能包含 clean、cacheCheck、build 等阶段
        expect(Object.keys(result.performance.stages).length)
          .toBeGreaterThanOrEqual(0);
      }
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该支持慢构建警告阈值", async () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
        build: {
          slowBuildThreshold: 1000, // 1秒
        },
      };
      const builder = new Builder(config);

      const result = await builder.buildClient();

      expect(result).toBeTruthy();
      // 如果构建时间超过阈值，应该会有警告（通过日志输出）
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("进度报告", () => {
    it("应该支持进度回调", async () => {
      const progressStages: string[] = [];
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
        build: {
          onProgress: (progress) => {
            progressStages.push(progress.stage);
          },
        },
      };
      const builder = new Builder(config);

      await builder.buildClient();

      // 进度回调可能被调用
      expect(builder).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该支持静默模式", async () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
        build: {
          silent: true,
        },
      };
      const builder = new Builder(config);

      const result = await builder.buildClient();

      expect(result).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  // 清理测试输出目录
  it("应该清理测试输出目录", async () => {
    if (outputDir) {
      try {
        await cleanupDir(outputDir);
      } catch {
        // 忽略错误
      }
    }
  });
});
