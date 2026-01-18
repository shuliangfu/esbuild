/**
 * @fileoverview ClientBuilder 高级功能测试
 */

import { join, mkdir, writeTextFile } from "@dreamer/runtime-adapter";
import { describe, expect, it } from "@dreamer/test";
import { BuilderClient } from "../src/builder-client.ts";
import type { ClientConfig } from "../src/types.ts";
import { cleanupDir, getTestDataDir, getTestOutputDir } from "./test-utils.ts";

describe("BuilderClient 高级功能", () => {
  let entryFile: string;
  let outputDir: string;
  let testDataDir: string;

  // 测试前创建测试目录和测试文件
  it("应该创建测试目录和测试文件", async () => {
    testDataDir = getTestDataDir();
    outputDir = getTestOutputDir("client-builder-advanced");
    entryFile = join(testDataDir, "src", "index.ts");

    // 确保目录存在
    await mkdir(join(testDataDir, "src"), { recursive: true });

    // 创建入口文件
    await writeTextFile(
      entryFile,
      `console.log('Advanced Test');`,
    );

    expect(testDataDir).toBeTruthy();
  });

  describe("代码分割策略", () => {
    it("应该支持按路由分割", async () => {
      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
        bundle: {
          splitting: {
            enabled: true,
            byRoute: true,
          },
        },
      };
      const builder = new BuilderClient(config);

      const result = await builder.build("dev");

      expect(result).toBeTruthy();
      expect(result.outputFiles.length).toBeGreaterThan(0);
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该支持按组件分割", async () => {
      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
        bundle: {
          splitting: {
            enabled: true,
            byComponent: true,
          },
        },
      };
      const builder = new BuilderClient(config);

      const result = await builder.build("dev");

      expect(result).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该支持按大小分割", async () => {
      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
        bundle: {
          splitting: {
            enabled: true,
            bySize: 100000, // 100KB
          },
        },
      };
      const builder = new BuilderClient(config);

      const result = await builder.build("dev");

      expect(result).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该支持自定义分割规则", async () => {
      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
        bundle: {
          splitting: {
            enabled: true,
            custom: (path: string) => path.includes("vendor"),
          },
        },
      };
      const builder = new BuilderClient(config);

      const result = await builder.build("dev");

      expect(result).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("Source Map 配置", () => {
    it("应该支持 inline Source Map", async () => {
      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
        sourcemap: {
          enabled: true,
          mode: "inline",
        },
      };
      const builder = new BuilderClient(config);

      const result = await builder.build("dev");

      expect(result).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该支持 external Source Map", async () => {
      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
        sourcemap: {
          enabled: true,
          mode: "external",
        },
      };
      const builder = new BuilderClient(config);

      const result = await builder.build("dev");

      expect(result).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该支持 both Source Map 模式", async () => {
      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
        sourcemap: {
          enabled: true,
          mode: "both",
        },
      };
      const builder = new BuilderClient(config);

      const result = await builder.build("dev");

      expect(result).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("多入口构建", () => {
    it("应该支持单入口构建（多入口需要通过 Builder）", async () => {
      // 注意：BuilderClient 只支持单入口，多入口需要通过 Builder 处理
      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };
      const builder = new BuilderClient(config);

      const result = await builder.build("dev");

      expect(result).toBeTruthy();
      expect(result.outputFiles.length).toBeGreaterThan(0);
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("外部依赖", () => {
    it("应该支持外部依赖配置", async () => {
      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
        bundle: {
          external: ["react", "react-dom", "react-router"],
        },
      };
      const builder = new BuilderClient(config);

      const result = await builder.build("dev");

      expect(result).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("输出格式", () => {
    it("应该支持 ESM 格式", async () => {
      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
        bundle: {
          format: "esm",
        },
      };
      const builder = new BuilderClient(config);

      const result = await builder.build("dev");

      expect(result).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该支持 CJS 格式", async () => {
      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
        bundle: {
          format: "cjs",
          splitting: false, // CJS 格式不支持代码分割
        },
      };
      const builder = new BuilderClient(config);

      const result = await builder.build("dev");

      expect(result).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该支持 IIFE 格式", async () => {
      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
        bundle: {
          format: "iife",
          splitting: false, // IIFE 格式不支持代码分割
        },
      };
      const builder = new BuilderClient(config);

      const result = await builder.build("dev");

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
