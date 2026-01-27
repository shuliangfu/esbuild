/**
 * @fileoverview 浏览器编译测试 - Socket.IO Client
 * 测试 resolver 插件在浏览器编译时能否正确处理 socket-io client 依赖
 */

import {
  createCommand,
  IS_DENO,
  join,
  mkdir,
  RUNTIME,
  writeTextFile,
} from "@dreamer/runtime-adapter";
import { describe, expect, it } from "@dreamer/test";
import { buildBundle } from "../src/builder-bundle.ts";
import { getTestDataDir, getTestOutputDir } from "./test-utils.ts";

// 测试数据目录
let testDataDir: string = "";
let clientEntryFile: string = "";
let outputDir: string = "";

if (IS_DENO) {
  describe(`浏览器编译测试 - Socket.IO Client (${RUNTIME})`, () => {
    // 在所有测试前创建测试文件和目录
    it("应该创建测试文件和目录", async () => {
      // 创建测试数据目录
      testDataDir = getTestDataDir();
      outputDir = getTestOutputDir("browser-compile-socket-io");
      await mkdir(testDataDir, { recursive: true });
      await mkdir(outputDir, { recursive: true });

      // 创建客户端入口文件
      // 这个文件会导入 @dreamer/socket-io/client 和 @dreamer/logger/client，测试 resolver 能否正确解析
      clientEntryFile = join(testDataDir, "client-socket-io.ts");
      await writeTextFile(
        clientEntryFile,
        `/**
 * 客户端测试入口文件
 * 测试 esbuild resolver 插件在浏览器编译时能否正确处理 socket-io client 和 logger client 依赖
 */

// 导入 JSR 包
import { ClientSocket } from "@dreamer/socket-io/client";
import { createLogger, type Logger } from "@dreamer/logger/client";

// 创建 logger 实例
const logger: Logger = createLogger({
  level: "info",
  prefix: "[Test]",
  debug: true,
});

// 导出测试函数
export function createSocketClient(url: string) {
  try {
    logger.info("创建 Socket 客户端", { url });

    // 创建 ClientSocket 实例
    const socket = new ClientSocket({
      url: url,
      autoConnect: false,
    });

    logger.debug("Socket 客户端创建成功");

    return {
      success: true,
      hasSocket: socket !== null && socket !== undefined,
      hasConnect: typeof socket.connect === "function",
      hasDisconnect: typeof socket.disconnect === "function",
      hasOn: typeof socket.on === "function",
      hasEmit: typeof socket.emit === "function",
      hasLogger: logger !== null && logger !== undefined,
      hasLoggerInfo: typeof logger.info === "function",
      hasLoggerError: typeof logger.error === "function",
    };
  } catch (error: any) {
    logger.error("创建 Socket 客户端失败", { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// 导出 logger 测试函数
export function testLogger() {
  logger.debug("调试信息");
  logger.info("信息日志");
  logger.warn("警告日志");
  logger.error("错误日志");

  return {
    success: true,
    hasLogger: logger !== null && logger !== undefined,
  };
}

// 设置全局变量，表示模块已加载
(globalThis as any).testReady = true;
`,
      );

      // 在测试数据目录创建 deno.json，确保 resolver 插件能找到导入配置
      const testDenoJsonPath = join(testDataDir, "deno.json");
      await writeTextFile(
        testDenoJsonPath,
        JSON.stringify(
          {
            imports: {
              "@dreamer/socket-io": "jsr:@dreamer/socket-io@1.0.0-beta.2",
              "@dreamer/logger": "jsr:@dreamer/logger@1.0.0-beta.4",
            },
          },
          null,
          2,
        ),
      );

      // 生成 deno.json 后，运行 deno cache 预缓存依赖
      // 这样可以确保 Deno 能够正确解析 JSR 包中的相对路径导入
      // 需要显式缓存所有依赖及其子路径，确保 Deno 完整缓存包结构
      // 注意：只在 Deno 环境下执行，Bun 不需要缓存步骤
      if (IS_DENO) {
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
            "jsr:@dreamer/logger@1.0.0-beta.4",
            "jsr:@dreamer/logger@1.0.0-beta.4/client",
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
            // 例如 node_modules 相关的警告不影响 JSR 包的解析
            const hasFatalError = errorText.includes("error:") && 
              !errorText.includes("node_modules") &&
              !errorText.includes("Could not find");
            if (hasFatalError) {
              console.warn(`deno cache 错误:\nstdout: ${stdoutText}\nstderr: ${errorText}`);
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
            const loggerModule = "jsr:@dreamer/logger@1.0.0-beta.4/client";
            
            // 预加载主模块
            await Promise.all([
              import(socketIoModule).catch(() => {}),
              import(loggerModule).catch(() => {}),
            ]);
            
            // 等待 Deno 完成文件系统操作和模块解析
            await new Promise((resolve) => setTimeout(resolve, 1000));
            
            // 显式解析一些可能被引用的相对路径，确保 Deno 完全缓存了它们
            // 这有助于 esbuild resolver 插件正确解析相对路径导入
            try {
              // 尝试解析 socket-io 包内可能存在的相对路径导入
              // 这些路径可能在实际的包中被使用
              const possiblePaths = [
                "jsr:@dreamer/socket-io@1.0.0-beta.2/encryption/encryption-manager",
                "jsr:@dreamer/socket-io@1.0.0-beta.2/client/message-queue",
                "jsr:@dreamer/socket-io@1.0.0-beta.2/client/polling-transport",
              ];
              
              // 尝试解析这些路径（可能不存在，但不影响）
              // import.meta.resolve() 返回字符串，不是 Promise，需要使用 try-catch
              for (const path of possiblePaths) {
                try {
                  import.meta.resolve(path);
                } catch {
                  // 忽略解析错误
                }
              }
            } catch {
              // 忽略解析错误
            }
            
            console.log("✓ JSR 依赖预加载完成");
          } catch (importError) {
            // 忽略导入错误，我们只需要触发依赖的缓存
            console.log("预加载依赖完成（忽略执行错误）");
          }
        } catch (error) {
          console.warn(`运行 deno cache 时出错: ${error}`);
          // 不抛出错误，继续执行测试
        }
      }

      // 在测试数据目录创建 package.json，确保 Bun 的 bun build 能找到导入配置
      // Bun 的 bun build 命令会读取 package.json 的 imports 字段
      // 注意：Bun 需要明确指定子路径映射，不能只映射包名
      const testPackageJsonPath = join(testDataDir, "package.json");
      await writeTextFile(
        testPackageJsonPath,
        JSON.stringify(
          {
            name: "browser-compile-test",
            version: "1.0.0",
            type: "module",
            imports: {
              "@dreamer/socket-io": "jsr:@dreamer/socket-io@1.0.0-beta.2",
              "@dreamer/socket-io/client":
                "jsr:@dreamer/socket-io@1.0.0-beta.2/client",
              "@dreamer/logger": "jsr:@dreamer/logger@1.0.0-beta.4",
              "@dreamer/logger/client":
                "jsr:@dreamer/logger@1.0.0-beta.4/client",
            },
          },
          null,
          2,
        ),
      );
    });

    describe("浏览器编译测试", () => {
      it(
        "应该能够成功编译包含 socket-io client 和 logger client 的代码",
        async () => {
          // 使用 buildBundle 进行浏览器编译
          // 浏览器模式会自动将 jsr: 依赖转换为 CDN URL 并标记为 external
          const result = await buildBundle({
            entryPoint: clientEntryFile,
            globalName: "SocketIOTest",
            platform: "browser",
            target: "es2020",
            format: "iife",
            minify: false,
            sourcemap: false,
          });

          // 验证编译结果
          expect(result.code).toBeTruthy();
          expect(result.code.length).toBeGreaterThan(0);

          // 验证代码中不包含 jsr: 协议（应该被转换为 CDN URL 或标记为 external）
          expect(result.code).not.toContain("jsr:@dreamer/socket-io");

          // 验证代码中包含全局变量名
          expect(result.code).toContain("SocketIOTest");

          // 验证代码中包含测试函数
          expect(result.code).toContain("createSocketClient");
          expect(result.code).toContain("testLogger");

          // 验证代码中不包含 jsr: 协议（logger 和 socket-io 都应该被转换）
          expect(result.code).not.toContain("jsr:@dreamer/logger");
          expect(result.code).not.toContain("jsr:@dreamer/socket-io");

          // 在浏览器模式下，依赖应该被转换为 CDN URL（esm.sh）并标记为 external
          // 在 IIFE 格式中，external 依赖不会被打包进 bundle，而是保留为 import 语句
          // 检查代码中是否包含 esm.sh URL（浏览器模式会将 jsr: 转换为 esm.sh）
          const hasEsmShUrl = result.code.includes("esm.sh");

          // 如果依赖被标记为 external，代码中应该包含 import 语句指向 CDN URL
          // 或者，如果使用了 IIFE 格式，external 依赖可能不会出现在代码中
          // 但至少不应该包含 jsr: 协议
          if (hasEsmShUrl) {
            console.log(`✓ Socket.IO 和 Logger 依赖已转换为 CDN URL (esm.sh)`);
          } else {
            console.log(
              `✓ Socket.IO 和 Logger 依赖已标记为 external（未出现在 bundle 中）`,
            );
          }

          // 将编译后的代码写入文件，方便查看
          const outputFile = join(outputDir, "socket-io-logger-bundle.js");
          await writeTextFile(outputFile, result.code);
          if (result.map) {
            const mapFile = join(outputDir, "socket-io-logger-bundle.js.map");
            await writeTextFile(mapFile, result.map);
          }
          console.log(`编译输出已保存到: ${outputFile}`);
        },
        {
          // 禁用资源泄漏检查（esbuild 会创建子进程）
          sanitizeOps: false,
          sanitizeResources: false,
        },
      );

      it("应该能够正确处理 external 依赖", async () => {
        // 使用 buildBundle 进行浏览器编译
        const result = await buildBundle({
          entryPoint: clientEntryFile,
          globalName: "SocketIOTest",
          platform: "browser",
          target: "es2020",
          format: "iife",
          minify: false,
          sourcemap: false,
        });

        // 验证编译结果
        expect(result.code).toBeTruthy();

        // 在浏览器模式下，socket-io 依赖应该被标记为 external
        // 在 IIFE 格式中，external 依赖不会被打包进 bundle
        // 浏览器会在运行时从 CDN 加载这些依赖

        // 验证编译成功
        expect(result.code.length).toBeGreaterThan(0);

        // 验证代码中不包含 jsr: 协议（socket-io 和 logger 都应该被转换）
        expect(result.code).not.toContain("jsr:@dreamer/socket-io");
        expect(result.code).not.toContain("jsr:@dreamer/logger");

        // 验证代码中包含全局变量名
        expect(result.code).toContain("SocketIOTest");

        // 将编译后的代码写入文件，方便查看
        const outputFile = join(outputDir, "socket-io-external-bundle.js");
        await writeTextFile(outputFile, result.code);
        if (result.map) {
          const mapFile = join(outputDir, "socket-io-external-bundle.js.map");
          await writeTextFile(mapFile, result.map);
        }
        console.log(`编译输出已保存到: ${outputFile}`);
        console.log(`编译后的代码长度: ${result.code.length} 字符`);
      }, {
        // 禁用资源泄漏检查（esbuild 会创建子进程）
        sanitizeOps: false,
        sanitizeResources: false,
      });

      it("应该能够编译包含相对路径导入的代码", async () => {
        // 创建一个使用相对路径导入的测试文件
        const relativeImportFile = join(testDataDir, "client-relative.ts");
        await writeTextFile(
          relativeImportFile,
          `/**
 * 测试相对路径导入
 */

import { createSocketClient } from "./client-socket-io.ts";

export function testRelativeImport() {
  const result = createSocketClient("http://localhost:30000");
  return result.success;
}

(globalThis as any).testReady = true;
`,
        );

        // 使用 buildBundle 进行浏览器编译
        const result = await buildBundle({
          entryPoint: relativeImportFile,
          globalName: "RelativeImportTest",
          platform: "browser",
          target: "es2020",
          format: "iife",
          minify: false,
          sourcemap: false,
        });

        // 验证编译结果
        expect(result.code).toBeTruthy();
        expect(result.code.length).toBeGreaterThan(0);
        expect(result.code).toContain("RelativeImportTest");

        // 将编译后的代码写入文件，方便查看
        const outputFile = join(outputDir, "relative-import-bundle.js");
        await writeTextFile(outputFile, result.code);
        if (result.map) {
          const mapFile = join(outputDir, "relative-import-bundle.js.map");
          await writeTextFile(mapFile, result.map);
        }
        console.log(`编译输出已保存到: ${outputFile}`);
      }, {
        // 禁用资源泄漏检查（esbuild 会创建子进程）
        sanitizeOps: false,
        sanitizeResources: false,
      });

      it("应该能够成功编译包含 logger client 的代码", async () => {
        // 创建一个只导入 logger client 的测试文件
        const loggerEntryFile = join(testDataDir, "client-logger.ts");
        await writeTextFile(
          loggerEntryFile,
          `/**
 * 测试 logger client 编译
 */

import { createLogger, type Logger } from "@dreamer/logger/client";

// 创建 logger 实例
const logger: Logger = createLogger({
  level: "info",
  prefix: "[LoggerTest]",
  debug: true,
});

// 导出测试函数
export function testLoggerFunctions() {
  logger.debug("调试信息");
  logger.info("信息日志");
  logger.warn("警告日志");
  logger.error("错误日志");

  return {
    success: true,
    hasLogger: logger !== null && logger !== undefined,
    hasDebug: typeof logger.debug === "function",
    hasInfo: typeof logger.info === "function",
    hasWarn: typeof logger.warn === "function",
    hasError: typeof logger.error === "function",
  };
}

// 设置全局变量，表示模块已加载
(globalThis as any).loggerTestReady = true;
`,
        );

        // 使用 buildBundle 进行浏览器编译
        const result = await buildBundle({
          entryPoint: loggerEntryFile,
          globalName: "LoggerTest",
          platform: "browser",
          target: "es2020",
          format: "iife",
          minify: false,
          sourcemap: false,
        });

        // 验证编译结果
        expect(result.code).toBeTruthy();
        expect(result.code.length).toBeGreaterThan(0);

        // 验证代码中不包含 jsr: 协议（应该被转换为 CDN URL 或标记为 external）
        expect(result.code).not.toContain("jsr:@dreamer/logger");

        // 验证代码中包含全局变量名
        expect(result.code).toContain("LoggerTest");

        // 验证代码中包含测试函数
        expect(result.code).toContain("testLoggerFunctions");

        // 检查代码中是否包含 esm.sh URL
        const hasEsmShUrl = result.code.includes("esm.sh");
        if (hasEsmShUrl) {
          console.log(`✓ Logger 依赖已转换为 CDN URL (esm.sh)`);
        } else {
          console.log(`✓ Logger 依赖已标记为 external（未出现在 bundle 中）`);
        }

        // 将编译后的代码写入文件，方便查看
        const outputFile = join(outputDir, "logger-bundle.js");
        await writeTextFile(outputFile, result.code);
        if (result.map) {
          const mapFile = join(outputDir, "logger-bundle.js.map");
          await writeTextFile(mapFile, result.map);
        }
        console.log(`编译输出已保存到: ${outputFile}`);
      }, {
        // 禁用资源泄漏检查（esbuild 会创建子进程）
        sanitizeOps: false,
        sanitizeResources: false,
      });
    });
  }, { sanitizeOps: false, sanitizeResources: false });
} else {
  // Bun 环境下的测试
  // 在浏览器模式下，Bun 使用 esbuild + bunResolverPlugin（类似 Deno）
  // 这样可以正确解析 JSR 包的子路径导入（如 @dreamer/socket-io/client）
  describe(`浏览器编译测试 - Socket.IO Client (${RUNTIME})`, () => {
    // 在所有测试前创建测试文件和目录
    it("应该创建测试文件和目录", async () => {
      // 创建测试数据目录
      testDataDir = getTestDataDir();
      outputDir = getTestOutputDir("browser-compile-socket-io");
      await mkdir(testDataDir, { recursive: true });
      await mkdir(outputDir, { recursive: true });

      // 创建客户端入口文件
      // 这个文件会导入 @dreamer/socket-io/client 和 @dreamer/logger/client，测试 resolver 能否正确解析
      clientEntryFile = join(testDataDir, "client-socket-io.ts");
      await writeTextFile(
        clientEntryFile,
        `/**
 * 客户端测试入口文件
 * 测试 esbuild resolver 插件在浏览器编译时能否正确处理 socket-io client 和 logger client 依赖
 */

// 导入 JSR 包
import { ClientSocket } from "@dreamer/socket-io/client";
import { createLogger, type Logger } from "@dreamer/logger/client";

// 创建 logger 实例
const logger: Logger = createLogger({
  level: "info",
  prefix: "[Test]",
  debug: true,
});

// 导出测试函数
export function createSocketClient(url: string) {
  try {
    logger.info("创建 Socket 客户端", { url });

    // 创建 ClientSocket 实例
    const socket = new ClientSocket({
      url: url,
      autoConnect: false,
    });

    logger.debug("Socket 客户端创建成功");

    return {
      success: true,
      hasSocket: socket !== null && socket !== undefined,
      hasConnect: typeof socket.connect === "function",
      hasDisconnect: typeof socket.disconnect === "function",
      hasOn: typeof socket.on === "function",
      hasEmit: typeof socket.emit === "function",
      hasLogger: logger !== null && logger !== undefined,
      hasLoggerInfo: typeof logger.info === "function",
      hasLoggerError: typeof logger.error === "function",
    };
  } catch (error: any) {
    logger.error("创建 Socket 客户端失败", { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// 导出 logger 测试函数
export function testLogger() {
  logger.debug("调试信息");
  logger.info("信息日志");
  logger.warn("警告日志");
  logger.error("错误日志");

  return {
    success: true,
    hasLogger: logger !== null && logger !== undefined,
  };
}

// 设置全局变量，表示模块已加载
(globalThis as any).testReady = true;
`,
      );

      // 在测试数据目录创建 package.json，确保 resolver 插件能找到导入配置
      const testPackageJsonPath = join(testDataDir, "package.json");
      await writeTextFile(
        testPackageJsonPath,
        JSON.stringify(
          {
            name: "browser-compile-test",
            version: "1.0.0",
            type: "module",
            imports: {
              "@dreamer/socket-io": "jsr:@dreamer/socket-io@1.0.0-beta.2",
              "@dreamer/logger": "jsr:@dreamer/logger@1.0.0-beta.4",
            },
          },
          null,
          2,
        ),
      );
    });

    describe("浏览器编译测试", () => {
      it(
        "应该能够成功编译包含 socket-io client 和 logger client 的代码",
        async () => {
          // 使用 buildBundle 进行浏览器编译
          // 浏览器模式会自动将 jsr: 依赖转换为 CDN URL 并标记为 external
          const result = await buildBundle({
            entryPoint: clientEntryFile,
            globalName: "SocketIOTest",
            platform: "browser",
            target: "es2020",
            format: "iife",
            minify: false,
            sourcemap: false,
          });

          // 验证编译结果
          expect(result.code).toBeTruthy();
          expect(result.code.length).toBeGreaterThan(0);

          // 验证代码中不包含 jsr: 协议（应该被转换为 CDN URL 或标记为 external）
          expect(result.code).not.toContain("jsr:@dreamer/socket-io");
          expect(result.code).not.toContain("jsr:@dreamer/logger");

          // 验证代码中包含全局变量名
          expect(result.code).toContain("SocketIOTest");

          // 验证代码中包含测试函数
          expect(result.code).toContain("createSocketClient");
          expect(result.code).toContain("testLogger");

          // 检查代码中是否包含 esm.sh URL（浏览器模式会将 jsr: 转换为 esm.sh）
          const hasEsmShUrl = result.code.includes("esm.sh");
          if (hasEsmShUrl) {
            console.log(`✓ Socket.IO 和 Logger 依赖已转换为 CDN URL (esm.sh)`);
          } else {
            console.log(
              `✓ Socket.IO 和 Logger 依赖已标记为 external（未出现在 bundle 中）`,
            );
          }

          // 将编译后的代码写入文件，方便查看
          const outputFile = join(outputDir, "socket-io-logger-bundle.js");
          await writeTextFile(outputFile, result.code);
          if (result.map) {
            const mapFile = join(outputDir, "socket-io-logger-bundle.js.map");
            await writeTextFile(mapFile, result.map);
          }
          console.log(`编译输出已保存到: ${outputFile}`);
        },
        {
          // 禁用资源泄漏检查（esbuild 会创建子进程）
          sanitizeOps: false,
          sanitizeResources: false,
        },
      );

      it("应该能够成功编译包含 logger client 的代码", async () => {
        // 创建一个只导入 logger client 的测试文件
        const loggerEntryFile = join(testDataDir, "client-logger.ts");
        await writeTextFile(
          loggerEntryFile,
          `/**
 * 测试 logger client 编译
 */

import { createLogger, type Logger } from "@dreamer/logger/client";

// 创建 logger 实例
const logger: Logger = createLogger({
  level: "info",
  prefix: "[LoggerTest]",
  debug: true,
});

// 导出测试函数
export function testLoggerFunctions() {
  logger.debug("调试信息");
  logger.info("信息日志");
  logger.warn("警告日志");
  logger.error("错误日志");

  return {
    success: true,
    hasLogger: logger !== null && logger !== undefined,
    hasDebug: typeof logger.debug === "function",
    hasInfo: typeof logger.info === "function",
    hasWarn: typeof logger.warn === "function",
    hasError: typeof logger.error === "function",
  };
}

// 设置全局变量，表示模块已加载
(globalThis as any).loggerTestReady = true;
`,
        );

        // 使用 buildBundle 进行浏览器编译
        const result = await buildBundle({
          entryPoint: loggerEntryFile,
          globalName: "LoggerTest",
          platform: "browser",
          target: "es2020",
          format: "iife",
          minify: false,
          sourcemap: false,
        });

        // 验证编译结果
        expect(result.code).toBeTruthy();
        expect(result.code.length).toBeGreaterThan(0);

        // 验证代码中不包含 jsr: 协议（应该被转换为 CDN URL 或标记为 external）
        expect(result.code).not.toContain("jsr:@dreamer/logger");

        // 验证代码中包含全局变量名
        expect(result.code).toContain("LoggerTest");

        // 验证代码中包含测试函数
        expect(result.code).toContain("testLoggerFunctions");

        // 检查代码中是否包含 esm.sh URL
        const hasEsmShUrl = result.code.includes("esm.sh");
        if (hasEsmShUrl) {
          console.log(`✓ Logger 依赖已转换为 CDN URL (esm.sh)`);
        } else {
          console.log(`✓ Logger 依赖已标记为 external（未出现在 bundle 中）`);
        }

        // 将编译后的代码写入文件，方便查看
        const outputFile = join(outputDir, "logger-bundle.js");
        await writeTextFile(outputFile, result.code);
        if (result.map) {
          const mapFile = join(outputDir, "logger-bundle.js.map");
          await writeTextFile(mapFile, result.map);
        }
        console.log(`编译输出已保存到: ${outputFile}`);
      }, {
        // 禁用资源泄漏检查（esbuild 会创建子进程）
        sanitizeOps: false,
        sanitizeResources: false,
      });
    });
  });
}
