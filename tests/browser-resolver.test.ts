/**
 * @fileoverview 使用 @dreamer/test 浏览器测试集成测试 esbuild resolver 插件
 * 测试 resolver 插件在浏览器环境中能否正确解析 JSR 包的相对路径导入
 */

import { join, mkdir, RUNTIME, writeTextFile } from "@dreamer/runtime-adapter";
import { afterAll, beforeAll, describe, expect, it } from "@dreamer/test";
import { getTestDataDir, getTestOutputDir } from "./test-utils.ts";

// 测试数据目录
let testDataDir: string = "";
let clientEntryFile: string = "";

// 浏览器测试配置
const browserConfig = {
  // 禁用资源泄漏检查（浏览器测试可能有内部定时器）
  sanitizeOps: false,
  sanitizeResources: false,
  // 启用浏览器测试
  browser: {
    enabled: true,
    // 客户端代码入口（将在测试中动态创建）
    entryPoint: "",
    // 全局变量名
    globalName: "EsbuildResolverTest",
    // 无头模式
    headless: true,
    // Chrome 启动参数
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
    // 复用浏览器实例
    reuseBrowser: true,
  },
};

describe(`Esbuild Resolver - 浏览器测试 (${RUNTIME})`, () => {
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

// 导入 JSR 包（这会触发 resolver 插件解析包内的相对路径导入）
import { ClientSocket } from "@dreamer/socket-io/client";

// 导出测试函数
export function testResolver() {
  try {
    // 检查 ClientSocket 是否已加载
    if (typeof ClientSocket === "undefined") {
      return {
        success: false,
        error: "ClientSocket 未定义",
      };
    }

    // 尝试创建 ClientSocket 实例（不实际连接）
    const socket = new ClientSocket({
      url: "http://localhost:30000",
      autoConnect: false,
    });

    return {
      success: true,
      hasSocket: socket !== null && socket !== undefined,
      hasConnect: typeof socket.connect === "function",
      hasDisconnect: typeof socket.disconnect === "function",
      hasOn: typeof socket.on === "function",
      hasEmit: typeof socket.emit === "function",
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

    // 更新浏览器配置中的入口文件路径
    browserConfig.browser.entryPoint = clientEntryFile;

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

  describe("Resolver 插件浏览器环境测试", () => {
    it("应该能够正确解析 JSR 包的相对路径导入", async (t) => {
      // @ts-ignore - 浏览器测试上下文
      const result = await t.browser!.evaluate(() => {
        // 检查全局变量是否已加载
        const win = globalThis as any;
        if (typeof win.EsbuildResolverTest === "undefined") {
          return {
            success: false,
            error: "EsbuildResolverTest 未定义",
          };
        }

        try {
          // 调用测试函数
          const testResult = win.EsbuildResolverTest.testResolver();
          return testResult;
        } catch (error: any) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      });

      expect(result.success).toBe(true);
      expect(result.hasSocket).toBe(true);
      expect(result.hasConnect).toBe(true);
      expect(result.hasDisconnect).toBe(true);
      expect(result.hasOn).toBe(true);
      expect(result.hasEmit).toBe(true);
    }, browserConfig);

    it("应该能够正确解析嵌套的 JSR 包导入", async (t) => {
      // @ts-ignore - 浏览器测试上下文
      const result = await t.browser!.evaluate(() => {
        const win = globalThis as any;
        if (typeof win.EsbuildResolverTest === "undefined") {
          return {
            success: false,
            error: "EsbuildResolverTest 未定义",
          };
        }

        try {
          // 检查模块是否正确加载
          const hasTestResolver =
            typeof win.EsbuildResolverTest.testResolver ===
              "function";
          const hasTestReady = win.testReady === true;

          return {
            success: hasTestResolver && hasTestReady,
            hasTestResolver,
            hasTestReady,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      });

      expect(result.success).toBe(true);
      expect(result.hasTestResolver).toBe(true);
      expect(result.hasTestReady).toBe(true);
    }, browserConfig);
  });
});
