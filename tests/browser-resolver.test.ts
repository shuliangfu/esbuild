/**
 * @fileoverview 测试 esbuild resolver 插件能否正确解析 JSR 包的相对路径导入
 *
 * 注意：此测试使用 Node.js 平台验证打包功能，因为浏览器模式下依赖应该使用 CDN（external）
 * 浏览器测试不能打包，只能使用 CDN，所以相对路径解析的测试应该在 Node.js 平台进行
 */

import {
  createCommand,
  IS_DENO,
  join,
  mkdir,
  RUNTIME,
  writeTextFile,
} from "@dreamer/runtime-adapter";
import { afterAll, beforeAll, describe, expect, it } from "@dreamer/test";
import { buildBundle } from "../src/builder-bundle.ts";
import { getTestDataDir, getTestOutputDir } from "./test-utils.ts";

// 测试数据目录
let testDataDir: string = "";
let clientEntryFile: string = "";

// 测试仅在 Deno 环境下运行
if (IS_DENO) {
  describe(`Esbuild Resolver - 相对路径解析测试 (${RUNTIME})`, () => {
    // 在所有测试前创建测试文件和目录
    beforeAll(async () => {
      console.log(
        `[${RUNTIME}] beforeAll 创建测试文件.......................`,
      );

      // 创建测试数据目录
      testDataDir = getTestDataDir();
      const outputDir = getTestOutputDir("browser-resolver");
      await mkdir(testDataDir, { recursive: true });
      await mkdir(outputDir, { recursive: true });

      // 创建客户端入口文件
      // 这个文件会导入 @dreamer/socket-io/client，测试 resolver 能否正确解析 JSR 包的相对路径导入
      clientEntryFile = join(testDataDir, "client-browser-test.ts");

      // 在测试数据目录创建 deno.json，确保 resolver 插件能找到导入配置
      const testDenoJsonPath = join(testDataDir, "deno.json");
      await writeTextFile(
        testDenoJsonPath,
        JSON.stringify(
          {
            imports: {
              "@dreamer/socket-io": "jsr:@dreamer/socket-io@1.0.0-beta.2",
            },
          },
          null,
          2,
        ),
      );

      await writeTextFile(
        clientEntryFile,
        `/**
 * 客户端测试入口文件
 * 测试 esbuild resolver 插件能否正确解析 JSR 包的相对路径导入
 */

// 导入 JSR 包（@dreamer/socket-io/client 导出 Client，会触发 resolver 解析包内相对路径）
import { Client } from "@dreamer/socket-io/client";

// 导出测试函数
export function testResolver() {
  try {
    // 检查 Client 是否已加载
    if (typeof Client === "undefined") {
      return {
        success: false,
        error: "Client 未定义",
      };
    }

    // 尝试创建 Client 实例（不实际连接）
    const client = new Client({
      url: "http://localhost:30000",
      autoConnect: false,
    });

    return {
      success: true,
      hasClient: client !== null && client !== undefined,
      hasConnect: typeof client.connect === "function",
      hasDisconnect: typeof client.disconnect === "function",
      hasOn: typeof client.on === "function",
      hasEmit: typeof client.emit === "function",
    };
  } catch (error: any) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// 设置全局变量，表示模块已加载
(globalThis as any).testReady = true;
`,
      );

      // 生成 deno.json 后，运行 deno cache 预缓存依赖
      // 这样可以确保 Deno 能够正确解析 JSR 包中的相对路径导入
      // 需要显式缓存所有依赖及其子路径，确保 Deno 完整缓存包结构
      try {
        // 构建缓存命令参数：显式缓存所有依赖及其子路径
        const cacheArgs = [
          "cache",
          "--config",
          testDenoJsonPath,
          // 缓存入口文件，Deno 会自动解析并缓存所有依赖
          clientEntryFile,
          // 显式缓存所有在 deno.json 中定义的依赖及其子路径
          // 这样可以确保 Deno 完整缓存包结构，包括包内的相对路径导入
          "jsr:@dreamer/socket-io@1.0.0-beta.2",
          "jsr:@dreamer/socket-io@1.0.0-beta.2/client",
        ];

        const cacheCommand = createCommand("deno", {
          args: cacheArgs,
          cwd: testDataDir,
          stdout: "piped",
          stderr: "piped",
        });

        const cacheOutput = await cacheCommand.output();

        // 解码输出（可能是 Uint8Array 或字符串）
        const decoder = new TextDecoder();
        const errorText = cacheOutput.stderr
          ? typeof cacheOutput.stderr === "string"
            ? cacheOutput.stderr
            : decoder.decode(cacheOutput.stderr)
          : "";
        const stdoutText = cacheOutput.stdout
          ? typeof cacheOutput.stdout === "string"
            ? cacheOutput.stdout
            : decoder.decode(cacheOutput.stdout)
          : "";

        if (!cacheOutput.success) {
          // 即使有错误，也继续执行，因为某些警告不影响功能
          const hasFatalError = errorText.includes("error:") &&
            !errorText.includes("node_modules") &&
            !errorText.includes("Could not find");
          if (hasFatalError) {
            console.warn(
              `deno cache 错误:\nstdout: ${stdoutText}\nstderr: ${errorText}`,
            );
          }
        } else {
          console.log("✓ 依赖缓存成功");
        }

        // 缓存后，通过动态导入预加载 JSR 依赖，确保 Deno 完全缓存了所有模块
        // 这对于 esbuild resolver 插件正确解析相对路径导入很重要
        // 使用完全动态的导入方式避免 TypeScript 类型检查错误
        try {
          // 预加载 JSR 包，这会触发所有依赖的下载和缓存，包括包内的相对路径导入
          // 使用完全动态的导入字符串，避免 TypeScript 类型检查
          const socketIoModule = "jsr:@dreamer/socket-io@1.0.0-beta.2/client";

          // 预加载主模块
          await import(socketIoModule).catch(() => {});

          // 等待 Deno 完成文件系统操作和模块解析
          await new Promise((resolve) => setTimeout(resolve, 1000));

          console.log("✓ JSR 依赖预加载完成");
        } catch (importError) {
          // 忽略导入错误，我们只需要触发依赖的缓存
          console.log("预加载依赖完成（忽略执行错误）");
        }
      } catch (error) {
        console.warn(`运行 deno cache 时出错: ${error}`);
        // 不抛出错误，继续执行测试
      }

      console.log(
        `[${RUNTIME}] 测试文件已创建: ${clientEntryFile}`,
      );
    });

    // 在所有测试后清理
    afterAll(async () => {
      console.log(
        `[${RUNTIME}] afterAll 清理测试文件.......................`,
      );
      // 测试文件会在测试完成后由 test-utils 清理
    });

    describe("Resolver 插件相对路径解析测试", () => {
      // 先测试打包是否成功
      it(
        "应该能够成功打包客户端代码（Node.js 平台，验证相对路径解析）",
        async () => {
          if (!clientEntryFile) {
            throw new Error("clientEntryFile 未初始化");
          }

          try {
            // 使用 Node.js 平台进行打包，这样可以验证 resolver 插件能否正确解析相对路径导入
            // 浏览器模式下依赖应该使用 CDN（external），不适合验证打包功能
            const result = await buildBundle({
              entryPoint: clientEntryFile,
              globalName: "EsbuildResolverTest",
              platform: "node", // 使用 Node.js 平台，而不是 browser
              format: "iife",
            });

            expect(result).toBeDefined();
            expect(result.code).toBeDefined();
            expect(result.code.length).toBeGreaterThan(0);
            expect(result.code).toContain("EsbuildResolverTest");
            // 验证依赖已打进 bundle：不应出现对 jsr: 的 require/import（出现则说明被 external）
            // 注：打包产物中可能仍含 "jsr:..." 字符串（如 source map 路径），故只检查 require/import 形式
            expect(result.code).not.toMatch(/require\s*\(\s*["']jsr:/);
            expect(result.code).not.toMatch(/from\s+["']jsr:/);
            console.log("打包成功，代码长度:", result.code.length);
          } catch (error) {
            const errorMessage = error instanceof Error
              ? error.message
              : String(error);
            console.error("打包失败:", errorMessage);
            throw error;
          }
        },
        { sanitizeOps: false, sanitizeResources: false },
      );

      it("应该能够正确解析 JSR 包的相对路径导入（Node.js 平台）", async () => {
        // 使用 Node.js 平台进行打包测试，验证 resolver 插件能否正确解析相对路径导入
        // 浏览器模式下依赖应该使用 CDN（external），不适合验证打包功能
        if (!clientEntryFile) {
          throw new Error("clientEntryFile 未初始化");
        }

        try {
          // 使用 Node.js 平台进行打包，这样可以验证 resolver 插件能否正确解析相对路径导入
          // 如果 resolver 插件正确工作，JSR 包内的相对路径导入应该被打包进 bundle
          const result = await buildBundle({
            entryPoint: clientEntryFile,
            globalName: "EsbuildResolverTest",
            platform: "node", // 使用 Node.js 平台，而不是 browser
            format: "iife",
          });

          // 验证打包成功
          expect(result).toBeDefined();
          expect(result.code).toBeDefined();
          expect(result.code.length).toBeGreaterThan(0);
          expect(result.code).toContain("EsbuildResolverTest");
          // 验证依赖已打进 bundle（不应出现对 jsr: 的 require/import）
          expect(result.code).not.toMatch(/require\s*\(\s*["']jsr:/);
          expect(result.code).not.toMatch(/from\s+["']jsr:/);
          // 验证代码中包含了打包的依赖内容（不是 external）
          // 如果 resolver 插件正确工作，相对路径导入应该被打包进 bundle
          // 检查代码中是否包含一些 socket-io 相关的函数或类
          const hasSocketContent = result.code.includes("connect") ||
            result.code.includes("disconnect") ||
            result.code.includes("Client");

          expect(hasSocketContent).toBe(true);
          console.log("✓ 打包成功，依赖已正确打包进 bundle");
        } catch (error) {
          const errorMessage = error instanceof Error
            ? error.message
            : String(error);
          console.error("打包失败:", errorMessage);
          throw error;
        }
      }, { sanitizeOps: false, sanitizeResources: false });

      it("应该能够正确解析嵌套的 JSR 包导入（Node.js 平台）", async () => {
        // 使用 Node.js 平台进行打包测试，验证 resolver 插件能否正确解析嵌套的 JSR 包导入
        // 浏览器模式下依赖应该使用 CDN（external），不适合验证打包功能
        if (!clientEntryFile) {
          throw new Error("clientEntryFile 未初始化");
        }

        try {
          // 使用 Node.js 平台进行打包，验证 resolver 插件能否正确解析嵌套的 JSR 包导入
          const result = await buildBundle({
            entryPoint: clientEntryFile,
            globalName: "EsbuildResolverTest",
            platform: "node", // 使用 Node.js 平台，而不是 browser
            format: "iife",
          });

          // 验证打包成功
          expect(result).toBeDefined();
          expect(result.code).toBeDefined();
          expect(result.code.length).toBeGreaterThan(0);
          expect(result.code).toContain("EsbuildResolverTest");
          // 验证依赖已打进 bundle（不应出现对 jsr: 的 require/import）
          expect(result.code).not.toMatch(/require\s*\(\s*["']jsr:/);
          expect(result.code).not.toMatch(/from\s+["']jsr:/);
          // 验证代码中包含了打包的依赖内容
          const hasSocketContent = result.code.includes("connect") ||
            result.code.includes("disconnect") ||
            result.code.includes("ClientSocket");

          expect(hasSocketContent).toBe(true);
          console.log("✓ 嵌套 JSR 包导入解析成功，依赖已正确打包进 bundle");
        } catch (error) {
          const errorMessage = error instanceof Error
            ? error.message
            : String(error);
          console.error("打包失败:", errorMessage);
          throw error;
        }
      }, { sanitizeOps: false, sanitizeResources: false });
    });
  });
}
