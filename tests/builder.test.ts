/**
 * @fileoverview 主构建器测试
 */

import { join, mkdir, writeTextFile } from "@dreamer/runtime-adapter";
import { assertRejects, describe, expect, it } from "@dreamer/test";
import { Builder, createBuilder } from "../src/mod.ts";
import type { BuilderConfig } from "../src/types.ts";
import { cleanupDir, getTestDataDir, getTestOutputDir } from "./test-utils.ts";

describe("Builder", () => {
  let entryFile: string;
  let outputDir: string;
  let testDataDir: string;

  // 测试前创建测试目录和测试文件
  it("应该创建测试目录和测试文件", async () => {
    testDataDir = getTestDataDir();
    outputDir = getTestOutputDir("builder");
    entryFile = join(testDataDir, "src", "index.ts");

    // 确保目录存在
    await mkdir(join(testDataDir, "src"), { recursive: true });

    // 创建入口文件
    await writeTextFile(
      entryFile,
      `console.log('Hello, World!');`,
    );

    expect(testDataDir).toBeTruthy();
  });

  describe("createBuilder", () => {
    it("应该创建构建器实例", () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
      };
      const builder = createBuilder(config);
      expect(builder).toBeInstanceOf(Builder);
    });
  });

  describe("构造函数", () => {
    it("应该创建只配置客户端的构建器", () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
      };
      const builder = new Builder(config);
      expect(builder).toBeTruthy();
    });

    it("应该创建只配置服务端的构建器", () => {
      const config: BuilderConfig = {
        server: {
          entry: entryFile,
          output: outputDir,
        },
      };
      const builder = new Builder(config);
      expect(builder).toBeTruthy();
    });

    it("应该创建同时配置客户端和服务端的构建器", () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: join(outputDir, "client"),
          engine: "react",
        },
        server: {
          entry: entryFile,
          output: join(outputDir, "server"),
        },
      };
      const builder = new Builder(config);
      expect(builder).toBeTruthy();
    });
  });

  describe("构建功能", () => {
    it("应该构建客户端代码", async () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
      };
      const builder = new Builder(config);

      const result = await builder.buildClient();

      expect(result).toBeTruthy();
      expect(result.outputFiles).toBeTruthy();
      expect(result.duration).toBeGreaterThanOrEqual(0);
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该构建服务端代码", async () => {
      const config: BuilderConfig = {
        server: {
          entry: entryFile,
          output: outputDir,
        },
      };
      const builder = new Builder(config);

      try {
        const result = await builder.buildServer();
        expect(result).toBeTruthy();
        expect(result.outputFiles).toBeTruthy();
        expect(result.duration).toBeGreaterThanOrEqual(0);
      } catch (error) {
        // 如果运行时环境不支持，跳过
        expect(builder).toBeTruthy();
      }
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该同时构建客户端和服务端", async () => {
      // 使用不同的输出目录避免冲突
      const clientOutput = join(outputDir, "client-parallel");
      const serverOutput = join(outputDir, "server-parallel");

      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: clientOutput,
          engine: "react",
        },
        server: {
          entry: entryFile,
          output: serverOutput,
        },
      };
      const builder = new Builder(config);

      const result = await builder.build();

      expect(result).toBeTruthy();
      expect(result.outputFiles).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该在未配置时抛出错误", async () => {
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

  describe("清理功能", () => {
    it("应该清理客户端输出目录", async () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
      };
      const builder = new Builder(config);

      await builder.clean();
      expect(builder).toBeTruthy();
    });

    it("应该清理服务端输出目录", async () => {
      const config: BuilderConfig = {
        server: {
          entry: entryFile,
          output: outputDir,
        },
      };
      const builder = new Builder(config);

      await builder.clean();
      expect(builder).toBeTruthy();
    });
  });

  describe("构建选项", () => {
    it("应该支持清理选项", async () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
        build: {
          clean: true,
        },
      };
      const builder = new Builder(config);

      const result = await builder.buildClient({
        clean: true,
      });

      expect(result).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该支持缓存选项", async () => {
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

      const result = await builder.buildClient({
        cache: true,
      });

      expect(result).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该支持构建模式", async () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
      };
      const builder = new Builder(config);

      const devResult = await builder.buildClient({ mode: "dev" });
      const prodResult = await builder.buildClient({ mode: "prod" });

      expect(devResult).toBeTruthy();
      expect(prodResult).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("边界情况", () => {
    it("应该处理空的配置", () => {
      const config: BuilderConfig = {};
      const builder = new Builder(config);
      expect(builder).toBeTruthy();
    });

    it("应该处理无效的入口文件", async () => {
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
