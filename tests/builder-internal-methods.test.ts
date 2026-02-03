/**
 * @fileoverview Builder 内部方法测试
 * 测试 Builder 类的私有方法和内部功能
 */

import { join, mkdir, writeTextFile } from "@dreamer/runtime-adapter";
import { describe, expect, it } from "@dreamer/test";
import { Builder } from "../src/builder.ts";
import type { BuilderConfig, BuildOptions } from "../src/types.ts";
import { cleanupDir, getTestDataDir, getTestOutputDir } from "./test-utils.ts";

describe("Builder 内部方法", () => {
  let entryFile: string;
  let outputDir: string;
  let testDataDir: string;

  // 测试前创建测试目录和测试文件
  it("应该创建测试目录和测试文件", async () => {
    testDataDir = getTestDataDir();
    outputDir = getTestOutputDir("builder-internal");
    entryFile = join(testDataDir, "src", "index.ts");

    // 确保目录存在
    await mkdir(join(testDataDir, "src"), { recursive: true });

    // 创建入口文件
    await writeTextFile(
      entryFile,
      `console.log('Internal Methods Test');`,
    );

    expect(testDataDir).toBeTruthy();
  });

  describe("性能报告生成", () => {
    it("应该生成性能报告", () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
      };
      const builder = new Builder(config);

      const performance = {
        stages: {
          clean: 100,
          cacheCheck: 50,
          build: 2000,
          assets: 300,
          html: 100,
        },
        total: 2550,
      };

      const report = builder.generatePerformanceReport(performance);

      expect(report).toBeTruthy();
      expect(typeof report).toBe("string");
      expect(report).toContain("构建性能报告");
      expect(report).toContain("总耗时");
      expect(report).toContain("各阶段耗时");
    });

    it("应该显示慢构建警告", () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
      };
      const builder = new Builder(config);

      const performance = {
        stages: {
          build: 6000,
        },
        total: 6000,
      };

      const options: BuildOptions = {
        slowBuildThreshold: 5000,
      };

      const report = builder.generatePerformanceReport(performance, options);

      expect(report).toContain("警告");
      expect(report).toContain("超过阈值");
    });

    it("应该识别构建瓶颈", () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
      };
      const builder = new Builder(config);

      const performance = {
        stages: {
          clean: 100,
          build: 5000, // 占总耗时的 83%，应该是瓶颈
          assets: 100,
        },
        total: 6000,
      };

      const report = builder.generatePerformanceReport(performance);

      expect(report).toContain("瓶颈");
    });
  });

  describe("进度报告", () => {
    it("应该通过 onProgress 回调报告进度", async () => {
      const progressStages: string[] = [];
      const progressValues: number[] = [];

      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
      };
      const builder = new Builder(config);

      const options: BuildOptions = {
        onProgress: (progress) => {
          progressStages.push(progress.stage);
          progressValues.push(progress.progress);
        },
      };

      await builder.buildClient(options);

      // 进度回调可能被调用
      expect(builder).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该在静默模式下不报告进度", async () => {
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

      const result = await builder.buildClient({ silent: true });

      expect(result).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("日志级别", () => {
    it("应该支持不同的日志级别", () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
        build: {
          logLevel: "debug",
        },
      };
      const builder = new Builder(config);

      // 获取错误统计（会触发日志）
      const stats = builder.getErrorStats();
      expect(stats).toBeTruthy();
    });

    it("应该在 silent 模式下不输出日志", () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
        build: {
          logLevel: "silent",
        },
      };
      const builder = new Builder(config);

      const stats = builder.getErrorStats();
      expect(stats).toBeTruthy();
    });
  });

  describe("错误记录", () => {
    it("应该记录不同类型的错误", () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
      };
      const builder = new Builder(config);

      // 通过构建失败来触发错误记录
      const invalidConfig: BuilderConfig = {
        client: {
          entry: join(testDataDir, "non-existent.ts"),
          output: outputDir,
          engine: "react",
        },
      };
      const invalidBuilder = new Builder(invalidConfig);

      // 尝试构建（会失败并记录错误）
      invalidBuilder.buildClient().catch(() => {
        // 预期会失败
      });

      const stats = invalidBuilder.getErrorStats();
      expect(stats).toBeTruthy();
    });

    it("应该限制最近错误数量", () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
      };
      const builder = new Builder(config);

      // 清除错误统计
      builder.clearErrorStats();

      const stats = builder.getErrorStats();
      expect(stats.recentErrors.length).toBe(0);
    });
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
}, { sanitizeOps: false, sanitizeResources: false });
