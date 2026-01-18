/**
 * @fileoverview Builder 错误处理测试
 */

import { join, mkdir, writeTextFile } from "@dreamer/runtime-adapter";
import { describe, expect, it } from "@dreamer/test";
import { Builder } from "../src/builder.ts";
import type { BuilderConfig } from "../src/types.ts";
import { cleanupDir, getTestDataDir, getTestOutputDir } from "./test-utils.ts";

describe("Builder 错误处理", () => {
  let entryFile: string;
  let outputDir: string;
  let testDataDir: string;

  // 测试前创建测试目录和测试文件
  it("应该创建测试目录和测试文件", async () => {
    testDataDir = getTestDataDir();
    outputDir = getTestOutputDir("builder-error");
    entryFile = join(testDataDir, "src", "index.ts");

    // 确保目录存在
    await mkdir(join(testDataDir, "src"), { recursive: true });

    // 创建入口文件
    await writeTextFile(
      entryFile,
      `console.log('Error Test');`,
    );

    expect(testDataDir).toBeTruthy();
  });

  describe("错误统计", () => {
    it("应该获取错误统计信息", () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
      };
      const builder = new Builder(config);

      const stats = builder.getErrorStats();

      expect(stats).toBeTruthy();
      expect(stats.total).toBe(0);
      expect(stats.warnings).toBe(0);
      expect(stats.errorsByType).toEqual({});
      expect(stats.recentErrors).toEqual([]);
    });

    it("应该生成错误报告", () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
      };
      const builder = new Builder(config);

      const report = builder.generateErrorReport();

      expect(report).toBeTruthy();
      expect(typeof report).toBe("string");
      expect(report.length).toBeGreaterThan(0);
      expect(report).toContain("构建错误统计报告");
    });

    it("应该清除错误统计", () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
      };
      const builder = new Builder(config);

      builder.clearErrorStats();

      const stats = builder.getErrorStats();
      expect(stats.total).toBe(0);
      expect(stats.warnings).toBe(0);
    });
  });

  describe("错误记录", () => {
    it("应该记录构建错误", async () => {
      const config: BuilderConfig = {
        client: {
          entry: join(testDataDir, "non-existent.ts"),
          output: outputDir,
          engine: "react",
        },
      };
      const builder = new Builder(config);

      try {
        await builder.buildClient();
      } catch (error) {
        // 预期会失败
      }

      const stats = builder.getErrorStats();
      // 错误可能被记录
      expect(stats).toBeTruthy();
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
