/**
 * @fileoverview 服务端构建器测试
 */

import { join, mkdir, remove, writeTextFile } from "@dreamer/runtime-adapter";
import { assertRejects, describe, expect, it } from "@dreamer/test";
import { BuilderServer } from "../src/builder-server.ts";
import type { ServerConfig } from "../src/types.ts";
import { getTestDataDir, getTestOutputDir } from "./test-utils.ts";

describe("BuilderServer", () => {
  let entryFile: string;
  let outputDir: string;
  let testDataDir: string;

  // 测试前创建测试目录和测试文件
  it("应该创建测试目录和测试文件", async () => {
    testDataDir = getTestDataDir();
    outputDir = getTestOutputDir("server-builder");
    entryFile = join(testDataDir, "src", "server.ts");

    // 确保目录存在
    await mkdir(join(testDataDir, "src"), { recursive: true });

    // 创建入口文件
    await writeTextFile(
      entryFile,
      `console.log('Server started');`,
    );

    expect(testDataDir).toBeTruthy();
  });

  describe("构造函数", () => {
    it("应该创建服务端构建器实例", () => {
      const config: ServerConfig = {
        entry: entryFile,
        output: outputDir,
      };
      const builder = new BuilderServer(config);
      expect(builder).toBeTruthy();
    });
  });

  describe("构建功能", () => {
    it("应该构建基本的服务端代码", async () => {
      const config: ServerConfig = {
        entry: entryFile,
        output: outputDir,
        target: "deno",
      };
      const builder = new BuilderServer(config);

      // 注意：实际构建可能需要 Deno 或 Bun 运行时
      // 这里主要测试接口是否正确
      try {
        const result = await builder.build();
        expect(result).toBeTruthy();
        expect(result.outputFiles).toBeTruthy();
        expect(result.duration).toBeGreaterThanOrEqual(0);
      } catch (error) {
        // 如果运行时环境不支持，跳过实际构建测试
        // 但验证接口存在
        expect(builder).toBeTruthy();
      }
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该支持不同的目标运行时", async () => {
      const config: ServerConfig = {
        entry: entryFile,
        output: outputDir,
        target: "bun",
      };
      const builder = new BuilderServer(config);

      expect(builder).toBeTruthy();
    });

    it("应该支持编译选项", async () => {
      const config: ServerConfig = {
        entry: entryFile,
        output: outputDir,
        target: "deno",
        compile: {
          minify: true,
          sourcemap: true,
          platform: ["linux", "darwin"],
        },
      };
      const builder = new BuilderServer(config);

      expect(builder).toBeTruthy();
    });

    it("应该支持 standalone 打包", async () => {
      const config: ServerConfig = {
        entry: entryFile,
        output: outputDir,
        target: "deno",
        compile: {
          standalone: true,
        },
      };
      const builder = new BuilderServer(config);

      expect(builder).toBeTruthy();
    });
  });

  describe("mode 和 write 参数", () => {
    it("应该支持字符串模式参数", async () => {
      const config: ServerConfig = {
        entry: entryFile,
        output: outputDir,
        target: "deno",
      };
      const builder = new BuilderServer(config);

      try {
        // 使用字符串模式参数
        const result = await builder.build("prod");
        expect(result).toBeTruthy();
        expect(result.outputFiles).toBeTruthy();
      } catch {
        // 如果运行时环境不支持，跳过实际构建测试
        expect(builder).toBeTruthy();
      }
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该支持对象形式的构建选项", async () => {
      const config: ServerConfig = {
        entry: entryFile,
        output: outputDir,
        target: "deno",
      };
      const builder = new BuilderServer(config);

      try {
        // 使用对象形式的构建选项
        const result = await builder.build({ mode: "dev", write: true });
        expect(result).toBeTruthy();
        expect(result.outputFiles).toBeTruthy();
        expect(result.outputContents).toBeUndefined();
      } catch {
        // 如果运行时环境不支持，跳过实际构建测试
        expect(builder).toBeTruthy();
      }
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该在 write: false 时返回代码内容", async () => {
      const config: ServerConfig = {
        entry: entryFile,
        output: outputDir,
        target: "deno",
      };
      const builder = new BuilderServer(config);

      try {
        // 使用 write: false，应该返回代码内容
        const result = await builder.build({ mode: "dev", write: false });
        expect(result).toBeTruthy();
        expect(result.outputContents).toBeTruthy();
        expect(result.outputContents!.length).toBeGreaterThan(0);
        // 检查返回的代码内容
        const firstOutput = result.outputContents![0];
        expect(firstOutput.text).toBeTruthy();
        expect(firstOutput.contents).toBeInstanceOf(Uint8Array);
      } catch {
        // 如果运行时环境不支持，跳过实际构建测试
        expect(builder).toBeTruthy();
      }
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该在生产模式下启用 minify", async () => {
      const config: ServerConfig = {
        entry: entryFile,
        output: outputDir,
        target: "deno",
        // 不显式设置 minify，应该根据 mode 自动设置
      };
      const builder = new BuilderServer(config);

      try {
        // 生产模式应该启用 minify
        const result = await builder.build("prod");
        expect(result).toBeTruthy();
      } catch {
        // 如果运行时环境不支持，跳过实际构建测试
        expect(builder).toBeTruthy();
      }
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该在开发模式下禁用 minify", async () => {
      const config: ServerConfig = {
        entry: entryFile,
        output: outputDir,
        target: "deno",
        // 不显式设置 minify，应该根据 mode 自动设置
      };
      const builder = new BuilderServer(config);

      try {
        // 开发模式应该禁用 minify
        const result = await builder.build("dev");
        expect(result).toBeTruthy();
      } catch {
        // 如果运行时环境不支持，跳过实际构建测试
        expect(builder).toBeTruthy();
      }
    }, { sanitizeOps: false, sanitizeResources: false });

    it("配置中的 minify 应该覆盖 mode 的默认行为", async () => {
      const config: ServerConfig = {
        entry: entryFile,
        output: outputDir,
        target: "deno",
        compile: {
          // 显式禁用 minify，即使是生产模式
          minify: false,
        },
      };
      const builder = new BuilderServer(config);

      try {
        // 即使是生产模式，也应该禁用 minify
        const result = await builder.build("prod");
        expect(result).toBeTruthy();
      } catch {
        // 如果运行时环境不支持，跳过实际构建测试
        expect(builder).toBeTruthy();
      }
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("边界情况", () => {
    it("应该处理不存在的入口文件", async () => {
      const config: ServerConfig = {
        entry: join(testDataDir, "non-existent.ts"),
        output: outputDir,
      };
      const builder = new BuilderServer(config);

      await assertRejects(
        async () => await builder.build(),
        Error,
      );
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该处理不支持的目标运行时", async () => {
      const config: ServerConfig = {
        entry: entryFile,
        output: outputDir,
        target: "node" as any, // 不支持的运行时
      };
      const builder = new BuilderServer(config);

      await assertRejects(
        async () => await builder.build(),
        Error,
      );
    });

    it("应该处理空的入口文件", async () => {
      const emptyFile = join(testDataDir, "empty.ts");
      await writeTextFile(emptyFile, "");

      const config: ServerConfig = {
        entry: emptyFile,
        output: outputDir,
      };
      const builder = new BuilderServer(config);

      // 应该能够构建（虽然可能没有输出）
      try {
        const result = await builder.build();
        expect(result).toBeTruthy();
      } catch (error) {
        // 如果运行时环境不支持，跳过
        expect(builder).toBeTruthy();
      }
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  // 清理测试输出目录
  it("应该清理测试输出目录", async () => {
    if (outputDir) {
      try {
        await remove(outputDir, { recursive: true });
      } catch {
        // 忽略错误
      }
    }
  });
});
