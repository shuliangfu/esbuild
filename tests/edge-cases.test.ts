/**
 * @fileoverview 边界情况和异常场景测试
 */

import { join, mkdir, writeTextFile } from "@dreamer/runtime-adapter";
import { assertRejects, describe, expect, it } from "@dreamer/test";
import { Builder } from "../src/builder.ts";
import type { BuilderConfig } from "../src/types.ts";
import { cleanupDir, getTestDataDir, getTestOutputDir } from "./test-utils.ts";

describe("边界情况和异常场景", () => {
  let entryFile: string;
  let outputDir: string;
  let testDataDir: string;

  // 测试前创建测试目录和测试文件
  it("应该创建测试目录和测试文件", async () => {
    testDataDir = getTestDataDir();
    outputDir = getTestOutputDir("edge-cases");
    entryFile = join(testDataDir, "src", "index.ts");

    // 确保目录存在
    await mkdir(join(testDataDir, "src"), { recursive: true });

    // 创建入口文件
    await writeTextFile(
      entryFile,
      `console.log('Edge Cases Test');`,
    );

    expect(testDataDir).toBeTruthy();
  });

  describe("空配置", () => {
    it("应该处理完全空的配置", () => {
      const config: BuilderConfig = {};
      const builder = new Builder(config);

      expect(builder).toBeTruthy();
    });

    it("应该在空配置时构建失败", async () => {
      const config: BuilderConfig = {};
      const builder = new Builder(config);

      await assertRejects(
        async () => await builder.buildClient(),
        Error,
      );
      await assertRejects(
        async () => await builder.buildServer(),
        Error,
      );
    });
  });

  describe("无效路径", () => {
    it("应该处理不存在的入口文件", async () => {
      const config: BuilderConfig = {
        client: {
          entry: join(testDataDir, "non-existent.ts"),
          output: outputDir,
          engine: "react",
        },
      };
      const builder = new Builder(config);

      await assertRejects(
        async () => await builder.buildClient(),
        Error,
      );
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该处理无效的输出目录", async () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: "",
          engine: "react",
        },
      };
      const builder = new Builder(config);

      await assertRejects(
        async () => await builder.buildClient(),
        Error,
      );
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("并发构建", () => {
    it("应该处理并发构建请求", async () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
      };
      const builder = new Builder(config);

      // 并发执行多个构建
      const promises = [
        builder.buildClient(),
        builder.buildClient(),
        builder.buildClient(),
      ];

      const results = await Promise.all(promises);

      // 所有构建都应该成功
      for (const result of results) {
        expect(result).toBeTruthy();
        expect(result.outputFiles.length).toBeGreaterThan(0);
      }
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("大量文件", () => {
    it("应该处理大量入口文件", async () => {
      // 创建多个入口文件
      const entries: Record<string, { entry: string }> = {};
      for (let i = 0; i < 5; i++) {
        const file = join(testDataDir, "src", `entry${i}.ts`);
        await writeTextFile(file, `console.log('Entry ${i}');`);
        entries[`entry${i}`] = { entry: file };
      }

      const config: BuilderConfig = {
        client: {
          entries: entries,
          output: outputDir,
          engine: "react",
        },
      };
      const builder = new Builder(config);

      // 多入口构建应该成功
      const result = await builder.buildClient();

      expect(result).toBeTruthy();
      expect(result.outputFiles.length).toBeGreaterThan(0);
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("特殊字符", () => {
    it("应该处理包含特殊字符的文件名", async () => {
      const specialFile = join(testDataDir, "src", "test-file@123.ts");
      await writeTextFile(specialFile, "console.log('Special');");

      const config: BuilderConfig = {
        client: {
          entry: specialFile,
          output: outputDir,
          engine: "react",
        },
      };
      const builder = new Builder(config);

      const result = await builder.buildClient();

      expect(result).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("长路径", () => {
    it("应该处理很长的文件路径", async () => {
      const longPath = join(
        testDataDir,
        "src",
        "a".repeat(100),
        "index.ts",
      );
      await mkdir(join(testDataDir, "src", "a".repeat(100)), {
        recursive: true,
      });
      await writeTextFile(longPath, "console.log('Long Path');");

      const config: BuilderConfig = {
        client: {
          entry: longPath,
          output: outputDir,
          engine: "react",
        },
      };
      const builder = new Builder(config);

      const result = await builder.buildClient();

      expect(result).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("资源限制", () => {
    it("应该处理大文件构建", async () => {
      // 创建一个大文件（模拟）
      const largeFile = join(testDataDir, "src", "large.ts");
      const largeContent = "console.log('Large');\n".repeat(1000);
      await writeTextFile(largeFile, largeContent);

      const config: BuilderConfig = {
        client: {
          entry: largeFile,
          output: outputDir,
          engine: "react",
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
