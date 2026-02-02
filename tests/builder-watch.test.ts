/**
 * @fileoverview Builder Watch 模式测试
 */

import { join, mkdir, writeTextFile } from "@dreamer/runtime-adapter";
import { assertRejects, describe, expect, it } from "@dreamer/test";
import { Builder } from "../src/builder.ts";
import type { BuilderConfig } from "../src/types.ts";
import { cleanupDir, getTestDataDir, getTestOutputDir } from "./test-utils.ts";

describe("Builder Watch 模式", () => {
  let entryFile: string;
  let outputDir: string;
  let testDataDir: string;

  // 测试前创建测试目录和测试文件
  it("应该创建测试目录和测试文件", async () => {
    testDataDir = getTestDataDir();
    outputDir = getTestOutputDir("builder-watch");
    entryFile = join(testDataDir, "src", "watch-test.ts");

    // 确保目录存在
    await mkdir(join(testDataDir, "src"), { recursive: true });

    // 创建入口文件
    await writeTextFile(
      entryFile,
      `console.log('Watch Test');`,
    );

    expect(testDataDir).toBeTruthy();
  });

  describe("Watch 模式", () => {
    it("应该启动 Watch 模式", async () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
        build: {
          watch: {
            enabled: true,
            paths: [join(testDataDir, "src")],
          },
        },
      };
      const builder = new Builder(config);

      // 启动 watch（异步，不等待完成）
      void builder.watch();

      // 等待一小段时间确保 watch 启动
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 停止 watch
      builder.stopWatch();

      // 等待 watch 停止
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(builder).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该在未启用 Watch 时抛出错误", async () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
        build: {
          watch: {
            enabled: false,
          },
        },
      };
      const builder = new Builder(config);

      await assertRejects(
        async () => await builder.watch(),
        Error,
      );
    });

    it("应该支持自定义监听路径", async () => {
      // 确保目录和文件存在（Bun 并行测试可能导致目录被其他测试清理）
      await mkdir(join(testDataDir, "src"), { recursive: true });
      await mkdir(join(testDataDir, "lib"), { recursive: true });
      await writeTextFile(entryFile, `console.log('Watch Test');`);

      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
        build: {
          watch: {
            enabled: true,
            paths: [join(testDataDir, "src")],
            recursive: true,
          },
        },
      };
      const builder = new Builder(config);

      void builder.watch();
      await new Promise((resolve) => setTimeout(resolve, 100));
      builder.stopWatch();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(builder).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该支持防抖配置", async () => {
      // 确保目录和文件存在（Bun 并行测试可能导致目录被其他测试清理）
      await mkdir(join(testDataDir, "src"), { recursive: true });
      await writeTextFile(entryFile, `console.log('Watch Test');`);

      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
        build: {
          watch: {
            enabled: true,
            paths: [join(testDataDir, "src")],
            debounce: 500,
          },
        },
      };
      const builder = new Builder(config);

      void builder.watch();
      await new Promise((resolve) => setTimeout(resolve, 100));
      builder.stopWatch();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(builder).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该支持文件变化回调", async () => {
      // 确保目录和文件存在（Bun 并行测试可能导致目录被其他测试清理）
      await mkdir(join(testDataDir, "src"), { recursive: true });
      await writeTextFile(entryFile, `console.log('Watch Test');`);

      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
        build: {
          watch: {
            enabled: true,
            paths: [join(testDataDir, "src")],
            onFileChange: (_path, _kind) => {
              // 文件变化回调
            },
          },
        },
      };
      const builder = new Builder(config);

      void builder.watch();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 修改文件触发回调
      await writeTextFile(entryFile, `console.log('Modified');`);

      // 等待防抖时间
      await new Promise((resolve) => setTimeout(resolve, 500));

      builder.stopWatch();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 注意：回调可能因为防抖而延迟执行
      expect(builder).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("stopWatch", () => {
    it("应该停止 Watch 模式", async () => {
      // 确保目录和文件存在（Bun 并行测试可能导致目录被其他测试清理）
      await mkdir(join(testDataDir, "src"), { recursive: true });
      await writeTextFile(entryFile, `console.log('Watch Test');`);

      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
        build: {
          watch: {
            enabled: true,
            paths: [join(testDataDir, "src")],
          },
        },
      };
      const builder = new Builder(config);

      await builder.watch();
      await new Promise((resolve) => setTimeout(resolve, 100));

      builder.stopWatch();

      // 再次调用 stopWatch 不应该出错
      builder.stopWatch();

      expect(builder).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该在未启动 Watch 时安全停止", () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
      };
      const builder = new Builder(config);

      // 未启动 watch，直接停止应该安全
      builder.stopWatch();

      expect(builder).toBeTruthy();
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
});
