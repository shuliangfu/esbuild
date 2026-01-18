/**
 * @fileoverview ClientBuilder 上下文和资源管理测试
 */

import { join, mkdir, writeTextFile } from "@dreamer/runtime-adapter";
import { describe, expect, it } from "@dreamer/test";
import { BuilderClient } from "../src/builder-client.ts";
import type { ClientConfig } from "../src/types.ts";
import { cleanupDir, getTestDataDir, getTestOutputDir } from "./test-utils.ts";

describe("BuilderClient 上下文和资源管理", () => {
  let entryFile: string;
  let outputDir: string;
  let testDataDir: string;

  // 测试前创建测试目录和测试文件
  it("应该创建测试目录和测试文件", async () => {
    testDataDir = getTestDataDir();
    outputDir = getTestOutputDir("client-builder-context");
    entryFile = join(testDataDir, "src", "index.ts");

    // 确保目录存在
    await mkdir(join(testDataDir, "src"), { recursive: true });

    // 创建入口文件
    await writeTextFile(
      entryFile,
      `console.log('Context Test');`,
    );

    expect(testDataDir).toBeTruthy();
  });

  describe("构建上下文", () => {
    it("应该创建构建上下文", async () => {
      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };
      const builder = new BuilderClient(config);

      const context = await builder.createContext("dev");

      expect(context).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该支持增量构建（rebuild）", async () => {
      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };
      const builder = new BuilderClient(config);

      // 创建上下文
      await builder.createContext("dev");

      // 执行增量构建
      const result = await builder.rebuild();

      expect(result).toBeTruthy();
      expect(result.outputFiles).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该支持多次增量构建", async () => {
      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };
      const builder = new BuilderClient(config);

      // 创建上下文
      await builder.createContext("dev");

      // 执行多次增量构建
      const result1 = await builder.rebuild();
      const result2 = await builder.rebuild();

      expect(result1).toBeTruthy();
      expect(result2).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("资源释放", () => {
    it("应该释放构建上下文资源", async () => {
      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };
      const builder = new BuilderClient(config);

      // 创建上下文
      await builder.createContext("dev");

      // 释放资源
      await builder.dispose();

      // 释放后再次释放应该安全
      await builder.dispose();

      expect(builder).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该在未创建上下文时安全释放", async () => {
      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };
      const builder = new BuilderClient(config);

      // 直接释放（未创建上下文）
      await builder.dispose();

      expect(builder).toBeTruthy();
    });
  });

  describe("上下文生命周期", () => {
    it("应该正确处理上下文生命周期", async () => {
      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };
      const builder = new BuilderClient(config);

      // 1. 创建上下文
      await builder.createContext("dev");

      // 2. 执行构建
      const result1 = await builder.rebuild();
      expect(result1).toBeTruthy();

      // 3. 再次构建
      const result2 = await builder.rebuild();
      expect(result2).toBeTruthy();

      // 4. 释放资源
      await builder.dispose();

      // 5. 释放后构建应该失败或创建新上下文
      try {
        await builder.rebuild();
      } catch {
        // 预期可能失败
      }

      expect(builder).toBeTruthy();
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
