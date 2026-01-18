/**
 * @fileoverview BuilderBundle 简单打包器测试
 */

import { join, mkdir, writeTextFile } from "@dreamer/runtime-adapter";
import { describe, expect, it } from "@dreamer/test";
import { buildBundle, BuilderBundle } from "../src/builder-bundle.ts";
import { cleanupDir, getTestDataDir } from "./test-utils.ts";

describe("BuilderBundle", () => {
  let entryFile: string;
  let testDataDir: string;

  // 测试前创建测试目录和测试文件
  it("应该创建测试目录和测试文件", async () => {
    testDataDir = getTestDataDir();
    entryFile = join(testDataDir, "src", "bundle-test.ts");

    // 确保目录存在
    await mkdir(join(testDataDir, "src"), { recursive: true });

    // 创建入口文件
    await writeTextFile(
      entryFile,
      `export const message = 'Hello, Bundle!';
console.log(message);`,
    );

    expect(true).toBe(true);
  });

  describe("BuilderBundle 类", () => {
    it("应该能够实例化 BuilderBundle", () => {
      const bundler = new BuilderBundle();
      expect(bundler).toBeDefined();
    });

    it("应该能够打包简单的 TypeScript 文件", async () => {
      const bundler = new BuilderBundle();
      const result = await bundler.build({
        entryPoint: entryFile,
      });

      expect(result).toBeDefined();
      expect(result.code).toBeDefined();
      expect(typeof result.code).toBe("string");
      expect(result.code.length).toBeGreaterThan(0);
    });

    it("应该默认使用 IIFE 格式", async () => {
      const bundler = new BuilderBundle();
      const result = await bundler.build({
        entryPoint: entryFile,
      });

      // IIFE 格式通常以 (() => { 或 (function() 开头
      expect(
        result.code.includes("(() => {") ||
          result.code.includes("(function()"),
      ).toBe(true);
    });

    it("应该支持设置 globalName", async () => {
      const bundler = new BuilderBundle();
      const result = await bundler.build({
        entryPoint: entryFile,
        globalName: "MyBundle",
      });

      expect(result.code).toBeDefined();
      // globalName 会被添加到 IIFE 中
      expect(result.code.includes("MyBundle")).toBe(true);
    });

    it("应该支持 platform: browser", async () => {
      const bundler = new BuilderBundle();
      const result = await bundler.build({
        entryPoint: entryFile,
        platform: "browser",
      });

      expect(result.code).toBeDefined();
      expect(result.code.length).toBeGreaterThan(0);
    });

    it("应该支持 platform: node", async () => {
      const bundler = new BuilderBundle();
      const result = await bundler.build({
        entryPoint: entryFile,
        platform: "node",
      });

      expect(result.code).toBeDefined();
      expect(result.code.length).toBeGreaterThan(0);
    });

    it("应该支持 platform: neutral", async () => {
      const bundler = new BuilderBundle();
      const result = await bundler.build({
        entryPoint: entryFile,
        platform: "neutral",
      });

      expect(result.code).toBeDefined();
      expect(result.code.length).toBeGreaterThan(0);
    });

    it("应该支持 format: esm", async () => {
      const bundler = new BuilderBundle();
      const result = await bundler.build({
        entryPoint: entryFile,
        format: "esm",
      });

      expect(result.code).toBeDefined();
      // ESM 格式通常包含 export
      expect(result.code.includes("export")).toBe(true);
    });

    it("应该支持 format: cjs", async () => {
      const bundler = new BuilderBundle();
      const result = await bundler.build({
        entryPoint: entryFile,
        format: "cjs",
      });

      expect(result.code).toBeDefined();
      // CJS 格式通常包含 module.exports 或 exports
      expect(
        result.code.includes("module.exports") ||
          result.code.includes("exports."),
      ).toBe(true);
    });

    it("应该支持 minify 压缩", async () => {
      const bundler = new BuilderBundle();

      const normalResult = await bundler.build({
        entryPoint: entryFile,
        minify: false,
      });

      const minifiedResult = await bundler.build({
        entryPoint: entryFile,
        minify: true,
      });

      // 压缩后的代码应该更短
      expect(minifiedResult.code.length).toBeLessThan(normalResult.code.length);
    });

    it("应该支持 target 设置", async () => {
      const bundler = new BuilderBundle();
      const result = await bundler.build({
        entryPoint: entryFile,
        target: "es2022",
      });

      expect(result.code).toBeDefined();
      expect(result.code.length).toBeGreaterThan(0);
    });

    it("应该支持 target 数组", async () => {
      const bundler = new BuilderBundle();
      const result = await bundler.build({
        entryPoint: entryFile,
        target: ["es2020", "chrome80", "firefox78"],
      });

      expect(result.code).toBeDefined();
      expect(result.code.length).toBeGreaterThan(0);
    });

    it("应该支持 external 排除依赖", async () => {
      // 创建带有导入的入口文件
      const entryWithImport = join(testDataDir, "src", "with-import.ts");
      await writeTextFile(
        entryWithImport,
        `import * as fs from "fs";
console.log(fs);`,
      );

      const bundler = new BuilderBundle();
      const result = await bundler.build({
        entryPoint: entryWithImport,
        platform: "node",
        external: ["fs"],
      });

      expect(result.code).toBeDefined();
      // 外部依赖应该保留 require 或 import
      expect(
        result.code.includes('require("fs")') ||
          result.code.includes('from "fs"'),
      ).toBe(true);
    });

    it("应该支持 define 替换", async () => {
      // 创建使用 define 的入口文件
      const entryWithDefine = join(testDataDir, "src", "with-define.ts");
      await writeTextFile(
        entryWithDefine,
        `declare const __VERSION__: string;
console.log(__VERSION__);`,
      );

      const bundler = new BuilderBundle();
      const result = await bundler.build({
        entryPoint: entryWithDefine,
        define: {
          __VERSION__: '"1.0.0"',
        },
      });

      expect(result.code).toBeDefined();
      expect(result.code.includes("1.0.0")).toBe(true);
    });

    it("应该支持 bundle: false 不打包依赖", async () => {
      const bundler = new BuilderBundle();
      const result = await bundler.build({
        entryPoint: entryFile,
        bundle: false,
        format: "esm",
      });

      expect(result.code).toBeDefined();
    });
  });

  describe("buildBundle 函数", () => {
    it("应该能够打包简单的 TypeScript 文件", async () => {
      const result = await buildBundle({
        entryPoint: entryFile,
      });

      expect(result).toBeDefined();
      expect(result.code).toBeDefined();
      expect(typeof result.code).toBe("string");
      expect(result.code.length).toBeGreaterThan(0);
    });

    it("应该支持所有选项", async () => {
      const result = await buildBundle({
        entryPoint: entryFile,
        globalName: "TestBundle",
        platform: "browser",
        target: "es2020",
        minify: true,
        format: "iife",
      });

      expect(result).toBeDefined();
      expect(result.code).toBeDefined();
      expect(result.code.includes("TestBundle")).toBe(true);
    });

    it("应该与 BuilderBundle 类返回相同结果", async () => {
      const bundler = new BuilderBundle();
      const classResult = await bundler.build({
        entryPoint: entryFile,
        minify: true,
      });

      const funcResult = await buildBundle({
        entryPoint: entryFile,
        minify: true,
      });

      expect(classResult.code).toBe(funcResult.code);
    });
  });

  describe("错误处理", () => {
    it("应该在入口文件不存在时抛出错误", async () => {
      const bundler = new BuilderBundle();

      try {
        await bundler.build({
          entryPoint: "/non/existent/file.ts",
        });
        expect(false).toBe(true); // 不应该到达这里
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it("应该在语法错误时抛出错误", async () => {
      // 创建有语法错误的文件
      const badFile = join(testDataDir, "src", "bad-syntax.ts");
      await writeTextFile(
        badFile,
        `const x = {
  invalid syntax here
};`,
      );

      const bundler = new BuilderBundle();

      try {
        await bundler.build({
          entryPoint: badFile,
        });
        expect(false).toBe(true); // 不应该到达这里
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe("浏览器和 Node 平台差异", () => {
    it("browser 平台应该正确处理浏览器 API", async () => {
      // 创建使用浏览器 API 的文件
      const browserFile = join(testDataDir, "src", "browser-api.ts");
      await writeTextFile(
        browserFile,
        `const url = new URL("https://example.com");
console.log(url.href);`,
      );

      const bundler = new BuilderBundle();
      const result = await bundler.build({
        entryPoint: browserFile,
        platform: "browser",
      });

      expect(result.code).toBeDefined();
      expect(result.code.length).toBeGreaterThan(0);
    });

    it("node 平台应该正确处理 Node API", async () => {
      // 创建使用 Node API 的文件
      const nodeFile = join(testDataDir, "src", "node-api.ts");
      await writeTextFile(
        nodeFile,
        `const path = process.cwd();
console.log(path);`,
      );

      const bundler = new BuilderBundle();
      const result = await bundler.build({
        entryPoint: nodeFile,
        platform: "node",
      });

      expect(result.code).toBeDefined();
      expect(result.code.length).toBeGreaterThan(0);
    });
  });

  // 测试后清理
  it("应该清理测试目录", async () => {
    try {
      await cleanupDir(testDataDir);
    } catch {
      // 忽略清理错误
    }
    expect(true).toBe(true);
  });
}, {
  // esbuild 会启动子进程，禁用资源泄漏检查
  sanitizeOps: false,
  sanitizeResources: false,
});
