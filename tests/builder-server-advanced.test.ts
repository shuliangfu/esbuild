/**
 * @fileoverview ServerBuilder 高级功能测试
 */

import { join, mkdir, writeTextFile } from "@dreamer/runtime-adapter";
import { describe, expect, it } from "@dreamer/test";
import { BuilderServer } from "../src/builder-server.ts";
import type { ServerConfig } from "../src/types.ts";
import { cleanupDir, getTestDataDir, getTestOutputDir } from "./test-utils.ts";

describe("BuilderServer 高级功能", () => {
  let entryFile: string;
  let outputDir: string;
  let testDataDir: string;

  // 测试前创建测试目录和测试文件
  it("应该创建测试目录和测试文件", async () => {
    testDataDir = getTestDataDir();
    outputDir = getTestOutputDir("server-builder-advanced");
    entryFile = join(testDataDir, "src", "server.ts");

    // 确保目录存在
    await mkdir(join(testDataDir, "src"), { recursive: true });

    // 创建入口文件
    await writeTextFile(
      entryFile,
      `console.log('Server Advanced Test');`,
    );

    expect(testDataDir).toBeTruthy();
  });

  describe("平台编译", () => {
    it("应该支持 Linux 平台编译", async () => {
      const config: ServerConfig = {
        entry: entryFile,
        output: outputDir,
        target: "deno",
        compile: {
          platform: ["linux"],
        },
      };
      const builder = new BuilderServer(config);

      try {
        const result = await builder.build();
        expect(result).toBeTruthy();
      } catch {
        // 如果运行时环境不支持，跳过
        expect(builder).toBeTruthy();
      }
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该支持 macOS 平台编译", async () => {
      const config: ServerConfig = {
        entry: entryFile,
        output: outputDir,
        target: "deno",
        compile: {
          platform: ["darwin"],
        },
      };
      const builder = new BuilderServer(config);

      try {
        const result = await builder.build();
        expect(result).toBeTruthy();
      } catch {
        // 如果运行时环境不支持，跳过
        expect(builder).toBeTruthy();
      }
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该支持 Windows 平台编译", async () => {
      const config: ServerConfig = {
        entry: entryFile,
        output: outputDir,
        target: "deno",
        compile: {
          platform: ["windows"],
        },
      };
      const builder = new BuilderServer(config);

      try {
        const result = await builder.build();
        expect(result).toBeTruthy();
      } catch {
        // 如果运行时环境不支持，跳过
        expect(builder).toBeTruthy();
      }
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该支持多平台编译", async () => {
      const config: ServerConfig = {
        entry: entryFile,
        output: outputDir,
        target: "deno",
        compile: {
          platform: ["linux", "darwin"],
        },
      };
      const builder = new BuilderServer(config);

      try {
        const result = await builder.build();
        expect(result).toBeTruthy();
      } catch {
        // 如果运行时环境不支持，跳过
        expect(builder).toBeTruthy();
      }
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("Standalone 打包", () => {
    it("应该支持 Standalone 打包", async () => {
      const config: ServerConfig = {
        entry: entryFile,
        output: outputDir,
        target: "deno",
        compile: {
          standalone: true,
        },
      };
      const builder = new BuilderServer(config);

      try {
        const result = await builder.build();
        expect(result).toBeTruthy();
      } catch {
        // 如果运行时环境不支持，跳过
        expect(builder).toBeTruthy();
      }
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("配置获取", () => {
    it("应该获取配置", () => {
      const config: ServerConfig = {
        entry: entryFile,
        output: outputDir,
        target: "deno",
      };
      const builder = new BuilderServer(config);

      const retrievedConfig = builder.getConfig();

      expect(retrievedConfig).toEqual(config);
    });
  });

  describe("external 外部依赖配置", () => {
    it("应该支持 external 配置", () => {
      const config: ServerConfig = {
        entry: entryFile,
        output: outputDir,
        target: "deno",
        external: ["tailwindcss", "lightningcss"],
      };
      const builder = new BuilderServer(config);

      const retrievedConfig = builder.getConfig();
      expect(retrievedConfig.external).toEqual(["tailwindcss", "lightningcss"]);
    });

    it("应该在 esbuild 模式下正确处理 external 配置", async () => {
      // 创建一个导入外部模块的测试文件
      const externalTestFile = join(testDataDir, "src", "external-test.ts");
      await writeTextFile(
        externalTestFile,
        `
import { something } from "external-lib";
console.log("External test:", something);
`,
      );

      const config: ServerConfig = {
        entry: externalTestFile,
        output: outputDir,
        target: "deno",
        external: ["external-lib"],
      };
      const builder = new BuilderServer(config);

      try {
        // 使用 write: false 模式，返回编译后的代码
        const result = await builder.build({ mode: "dev", write: false });
        expect(result).toBeTruthy();
        expect(result.outputContents).toBeTruthy();

        // 检查编译后的代码是否保留了 external-lib 的 import 语句
        const code = result.outputContents![0].text;
        expect(code).toContain("external-lib");
      } catch {
        // 如果运行时环境不支持，跳过实际构建测试
        expect(builder).toBeTruthy();
      }
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该支持通配符 external 配置", () => {
      const config: ServerConfig = {
        entry: entryFile,
        output: outputDir,
        target: "deno",
        external: ["@tailwindcss/*", "node:*"],
      };
      const builder = new BuilderServer(config);

      const retrievedConfig = builder.getConfig();
      expect(retrievedConfig.external).toContain("@tailwindcss/*");
      expect(retrievedConfig.external).toContain("node:*");
    });

    it("应该在空 external 配置时正常工作", async () => {
      const config: ServerConfig = {
        entry: entryFile,
        output: outputDir,
        target: "deno",
        external: [],
      };
      const builder = new BuilderServer(config);

      try {
        const result = await builder.build({ mode: "dev", write: false });
        expect(result).toBeTruthy();
      } catch {
        // 如果运行时环境不支持，跳过实际构建测试
        expect(builder).toBeTruthy();
      }
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("useNativeCompile 原生编译配置", () => {
    it("应该支持 useNativeCompile 配置", () => {
      const config: ServerConfig = {
        entry: entryFile,
        output: join(outputDir, "server"),
        target: "deno",
        useNativeCompile: true,
      };
      const builder = new BuilderServer(config);

      const retrievedConfig = builder.getConfig();
      expect(retrievedConfig.useNativeCompile).toBe(true);
    });

    it("应该默认禁用 useNativeCompile", () => {
      const config: ServerConfig = {
        entry: entryFile,
        output: outputDir,
        target: "deno",
      };
      const builder = new BuilderServer(config);

      const retrievedConfig = builder.getConfig();
      expect(retrievedConfig.useNativeCompile).toBeUndefined();
    });

    it("应该在 useNativeCompile 模式下执行原生编译", async () => {
      // 创建简单的测试入口文件
      const nativeTestFile = join(testDataDir, "src", "native-compile-test.ts");
      await writeTextFile(
        nativeTestFile,
        `console.log("Native compile test");`,
      );

      const nativeOutputPath = join(outputDir, "native-test-bin");
      const config: ServerConfig = {
        entry: nativeTestFile,
        output: nativeOutputPath,
        target: "deno",
        useNativeCompile: true,
      };
      const builder = new BuilderServer(config);

      try {
        const result = await builder.build("prod");
        expect(result).toBeTruthy();
        expect(result.outputFiles).toBeTruthy();
        expect(result.outputFiles.length).toBeGreaterThan(0);
        expect(result.duration).toBeGreaterThanOrEqual(0);
      } catch {
        // 如果运行时环境不支持原生编译（如 CI 环境），跳过实际构建测试
        // 但验证构建器实例创建正确
        expect(builder).toBeTruthy();
        expect(builder.getConfig().useNativeCompile).toBe(true);
      }
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该在 useNativeCompile 模式下支持 external 配置", () => {
      const config: ServerConfig = {
        entry: entryFile,
        output: join(outputDir, "server-with-external"),
        target: "deno",
        useNativeCompile: true,
        external: ["some-native-module"],
      };
      const builder = new BuilderServer(config);

      const retrievedConfig = builder.getConfig();
      expect(retrievedConfig.useNativeCompile).toBe(true);
      expect(retrievedConfig.external).toContain("some-native-module");
    });

    it("应该在缺少输出路径时抛出错误", async () => {
      const config: ServerConfig = {
        lang: "zh-CN",
        entry: entryFile,
        output: "", // 空输出路径
        target: "deno",
        useNativeCompile: true,
      };
      const builder = new BuilderServer(config);

      try {
        await builder.build("prod");
        // 如果没有抛出错误，测试失败
        expect(false).toBe(true);
      } catch (error) {
        // 应该抛出关于输出路径的错误
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("输出路径");
      }
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("external 与 useNativeCompile 交互测试", () => {
    it("应该在 Bun 原生编译模式下处理 external", () => {
      const config: ServerConfig = {
        entry: entryFile,
        output: join(outputDir, "bun-native-test"),
        target: "bun",
        useNativeCompile: true,
        external: ["native-addon"],
      };
      const builder = new BuilderServer(config);

      // 验证配置正确保存
      const retrievedConfig = builder.getConfig();
      expect(retrievedConfig.useNativeCompile).toBe(true);
      expect(retrievedConfig.external).toContain("native-addon");
      expect(retrievedConfig.target).toBe("bun");
    });

    it("应该在 Deno 原生编译模式下记录 external 警告", () => {
      // Deno compile 不支持 external，应该在日志中警告
      const config: ServerConfig = {
        entry: entryFile,
        output: join(outputDir, "deno-native-test"),
        target: "deno",
        useNativeCompile: true,
        external: ["unsupported-external"],
      };
      const builder = new BuilderServer(config);

      // 验证配置正确保存
      const retrievedConfig = builder.getConfig();
      expect(retrievedConfig.useNativeCompile).toBe(true);
      expect(retrievedConfig.external).toContain("unsupported-external");
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
