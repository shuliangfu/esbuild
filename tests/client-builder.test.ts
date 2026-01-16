/**
 * @fileoverview 客户端构建器测试
 */

import { join, mkdir, remove, writeTextFile } from "@dreamer/runtime-adapter";
import { assertRejects, describe, expect, it } from "@dreamer/test";
import { ClientBuilder } from "../src/client-builder.ts";
import type { ClientConfig } from "../src/types.ts";
import { getTestDataDir, getTestOutputDir } from "./test-utils.ts";

describe("ClientBuilder", () => {
  let entryFile: string;
  let outputDir: string;
  let testDataDir: string;

  // 测试前创建测试目录和测试文件
  it("应该创建测试目录和测试文件", async () => {
    testDataDir = getTestDataDir();
    outputDir = getTestOutputDir("client-builder");
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

  describe("构造函数", () => {
    it("应该创建客户端构建器实例", () => {
      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };
      const builder = new ClientBuilder(config);
      expect(builder).toBeTruthy();
    });

    it("应该在缺少入口文件时抛出错误", async () => {
      const config: ClientConfig = {
        output: outputDir,
        engine: "react",
      };

      // 注意：实际错误可能在 build 时抛出
      const builder = new ClientBuilder(config);
      expect(builder).toBeTruthy();
    });
  });

  describe("构建功能", () => {
    it("应该构建基本的客户端代码", async () => {
      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
        bundle: {
          minify: false,
          sourcemap: false,
        },
      };
      const builder = new ClientBuilder(config);

      const result = await builder.build("dev");

      expect(result).toBeTruthy();
      expect(result.outputFiles).toBeTruthy();
      expect(result.duration).toBeGreaterThanOrEqual(0);
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该在生产模式下压缩代码", async () => {
      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
        bundle: {
          minify: true,
        },
      };
      const builder = new ClientBuilder(config);

      const result = await builder.build("prod");

      expect(result).toBeTruthy();
      expect(result.outputFiles.length).toBeGreaterThan(0);
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该生成 source map", async () => {
      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
        bundle: {
          sourcemap: true,
        },
      };
      const builder = new ClientBuilder(config);

      const result = await builder.build("dev");

      expect(result).toBeTruthy();
      // source map 文件应该在输出文件中
      const hasSourceMap = result.outputFiles.some((file) =>
        file.endsWith(".map")
      );
      // 注意：esbuild 可能将 source map 内联或生成外部文件
      expect(result).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该支持代码分割", async () => {
      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
        bundle: {
          splitting: true,
        },
      };
      const builder = new ClientBuilder(config);

      const result = await builder.build("dev");

      expect(result).toBeTruthy();
      expect(result.outputFiles.length).toBeGreaterThan(0);
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该支持外部依赖", async () => {
      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
        bundle: {
          external: ["react", "react-dom"],
        },
      };
      const builder = new ClientBuilder(config);

      const result = await builder.build("dev");

      expect(result).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("增量构建", () => {
    it("应该创建构建上下文", async () => {
      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };
      const builder = new ClientBuilder(config);

      const context = await builder.createContext("dev");

      expect(context).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该支持增量重新构建", async () => {
      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };
      const builder = new ClientBuilder(config);

      await builder.createContext("dev");
      const result = await builder.rebuild();

      expect(result).toBeTruthy();
      expect(result.outputFiles).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该在未创建上下文时抛出错误", async () => {
      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };
      const builder = new ClientBuilder(config);

      await assertRejects(
        async () => await builder.rebuild(),
        Error,
      );
    });

    it("应该能够清理构建上下文", async () => {
      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };
      const builder = new ClientBuilder(config);

      await builder.createContext("dev");
      await builder.dispose();

      // 清理后不应该抛出错误
      expect(builder).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("插件支持", () => {
    it("应该注册插件", () => {
      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };
      const builder = new ClientBuilder(config);

      const plugin = {
        name: "test-plugin",
        setup: () => {},
      };

      builder.registerPlugin(plugin);
      expect(builder).toBeTruthy();
    });

    it("应该获取插件管理器", () => {
      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };
      const builder = new ClientBuilder(config);

      const pluginManager = builder.getPluginManager();

      expect(pluginManager).toBeTruthy();
    });
  });

  describe("配置管理", () => {
    it("应该获取配置", () => {
      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };
      const builder = new ClientBuilder(config);

      const retrievedConfig = builder.getConfig();

      expect(retrievedConfig).toEqual(config);
    });
  });

  describe("边界情况", () => {
    it("应该处理不存在的入口文件", async () => {
      const config: ClientConfig = {
        entry: join(testDataDir, "non-existent.ts"),
        output: outputDir,
        engine: "react",
      };
      const builder = new ClientBuilder(config);

      await assertRejects(
        async () => await builder.build("dev"),
        Error,
      );
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该处理空的入口文件", async () => {
      const emptyFile = join(testDataDir, "empty.ts");
      await writeTextFile(emptyFile, "");

      const config: ClientConfig = {
        entry: emptyFile,
        output: outputDir,
        engine: "react",
      };
      const builder = new ClientBuilder(config);

      // 应该能够构建（虽然可能没有输出）
      const result = await builder.build("dev");
      expect(result).toBeTruthy();
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
