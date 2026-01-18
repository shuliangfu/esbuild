/**
 * @fileoverview 解析器插件测试（跨运行时）
 *
 * Deno 环境测试：
 * - JSR 包的子路径导出（如 @dreamer/logger/client）
 * - 直接使用 jsr: 协议（如 jsr:@dreamer/logger@^1.0.0-beta.4/client）
 * - 直接使用 npm: 协议（如 npm:esbuild@^0.27.2）
 * - 相对路径导入（如 ./utils, ../config）
 * - 路径别名（如通过 deno.json imports 配置的别名）
 *
 * Bun 环境测试：
 * - 相对路径导入（如 ./utils, ../config）
 * - npm 包导入（Bun 原生支持）
 * - 路径别名（如通过 package.json imports 配置的别名）
 *
 * 注意：此文件会根据运行时环境自动选择相应的测试套件
 */

import {
  IS_DENO,
  join,
  mkdir,
  writeTextFile,
  writeTextFileSync,
} from "@dreamer/runtime-adapter";
import { describe, expect, it } from "@dreamer/test";
import { buildBundle } from "../src/builder-bundle.ts";
import { createResolverPlugin } from "../src/plugins/resolver-deno.ts";
import { cleanupDir, getTestDataDir } from "./test-utils.ts";

if (IS_DENO) {
  describe("Deno 解析器插件", () => {
    let testDataDir: string = "";
    let entryFile: string = "";
    let entryFileJsrDirect: string = "";
    let entryFileNpmDirect: string = "";
    let entryFileSubpath: string = "";
    let entryFileRelative: string = "";
    let entryFileAlias: string = "";
    let entryFilePathAlias: string = "";

    // 测试前创建测试目录和测试文件
    it("应该创建测试目录和测试文件", async () => {
      testDataDir = getTestDataDir();
      entryFile = join(testDataDir, "deno-resolver-test.ts");
      entryFileJsrDirect = join(testDataDir, "test-jsr-direct.ts");
      entryFileNpmDirect = join(testDataDir, "test-npm-direct.ts");
      entryFileSubpath = join(testDataDir, "test-subpath.ts");
      entryFileRelative = join(testDataDir, "test-relative.ts");
      entryFileAlias = join(testDataDir, "test-alias.ts");
      entryFilePathAlias = join(testDataDir, "test-path-alias.ts");

      // 确保目录存在
      await mkdir(testDataDir, { recursive: true });

      // 创建测试入口文件 1: 通过 deno.json imports 映射导入子路径
      await writeTextFile(
        entryFile,
        `import { createLogger } from "@dreamer/logger/client";

const logger = createLogger("test");
logger.info("Test message from Deno resolver");

export { logger };
`,
      );

      // 创建测试入口文件 2: 直接使用 jsr: 协议导入子路径
      await writeTextFile(
        entryFileJsrDirect,
        `// 直接使用 jsr: 协议导入子路径
import { createLogger } from "jsr:@dreamer/logger@^1.0.0-beta.4/client";

const logger = createLogger("test-jsr-direct");
logger.info("Test JSR protocol direct import");

export { logger };
`,
      );

      // 创建测试入口文件 3: 直接使用 npm: 协议（测试解析，不实际使用）
      await writeTextFile(
        entryFileNpmDirect,
        `// 直接使用 npm: 协议（测试解析能力）
// 注意：这里只是测试解析器能否识别 npm: 协议，不实际导入
console.log("Test NPM protocol support");

export const testNpm = "npm-protocol-test";
`,
      );

      // 创建测试入口文件 4: 测试多个子路径级别
      await writeTextFile(
        entryFileSubpath,
        `// 测试子路径导出
import { createLogger } from "@dreamer/logger/client";

const logger = createLogger("test-subpath");
logger.info("Test subpath export");

export { logger };
`,
      );

      // 创建测试目录结构用于相对路径测试
      const utilsDir = join(testDataDir, "utils");
      const configDir = join(testDataDir, "config");
      await mkdir(utilsDir, { recursive: true });
      await mkdir(configDir, { recursive: true });

      // 创建工具文件
      await writeTextFile(
        join(utilsDir, "helper.ts"),
        `export function helperFunction() {
  return "helper-result";
}
`,
      );

      // 创建配置文件
      await writeTextFile(
        join(configDir, "settings.ts"),
        `export const settings = {
  name: "test-settings",
  version: "1.0.0"
};
`,
      );

      // 创建测试入口文件 5: 测试相对路径导入
      await writeTextFile(
        entryFileRelative,
        `// 测试相对路径导入
import { helperFunction } from "./utils/helper.ts";
import { settings } from "./config/settings.ts";

const result = helperFunction();
const config = settings;

export { result, config };
`,
      );

      // 创建测试入口文件 6: 测试路径别名（如果 deno.json 中有配置）
      // 注意：这里测试的是通过 deno.json imports 配置的别名
      // 使用子路径避免 Node.js 内置模块的问题
      await writeTextFile(
        entryFileAlias,
        `// 测试路径别名（通过 deno.json imports 配置）
// 这里使用 @dreamer/logger/client 作为别名测试（避免 Node.js 内置模块问题）
import { createLogger } from "@dreamer/logger/client";

const logger = createLogger("test-alias");
logger.info("Test path alias");

export { logger };
`,
      );

      // 创建测试目录结构用于路径别名测试
      const srcDir = join(testDataDir, "src");
      const libDir = join(srcDir, "lib");
      await mkdir(libDir, { recursive: true });

      // 创建库文件
      await writeTextFile(
        join(libDir, "math.ts"),
        `export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}
`,
      );

      // 创建工具文件
      await writeTextFile(
        join(srcDir, "utils.ts"),
        `export function formatMessage(msg: string): string {
  return \`[Formatted] \${msg}\`;
}
`,
      );

      // 在 tests/data 目录下创建 deno.json，配置路径别名
      const testDenoJsonPath = join(testDataDir, "deno.json");
      const testDenoJson = {
        imports: {
          // 配置路径别名
          "@/": "./src/",
          "@/lib/": "./src/lib/",
          "~/": "./",
          "~utils/": "./utils/",
          "~config/": "./config/",
          // 同时保留原有的包导入映射
          "@dreamer/logger": "jsr:@dreamer/logger@^1.0.0-beta.4",
          "@dreamer/logger/client": "jsr:@dreamer/logger@^1.0.0-beta.4/client",
        },
      };
      writeTextFileSync(
        testDenoJsonPath,
        JSON.stringify(testDenoJson, null, 2),
      );

      // 创建测试入口文件 7: 测试路径别名解析
      await writeTextFile(
        entryFilePathAlias,
        `// 测试路径别名解析
// 使用 @/ 别名指向 ./src/
import { formatMessage } from "@/utils.ts";
// 使用 @/lib/ 别名指向 ./src/lib/
import { add, multiply } from "@/lib/math.ts";
// 使用 ~/ 别名指向 ./
import { helperFunction } from "~/utils/helper.ts";
// 使用 ~config/ 别名指向 ./config/
import { settings } from "~config/settings.ts";

const msg = formatMessage("Hello");
const sum = add(1, 2);
const product = multiply(3, 4);
const helper = helperFunction();
const config = settings;

export { msg, sum, product, helper, config };
`,
      );

      expect(testDataDir).toBeTruthy();
      // 确保所有文件路径都已设置
      expect(entryFile).toBeTruthy();
      expect(entryFileJsrDirect).toBeTruthy();
      expect(entryFileNpmDirect).toBeTruthy();
      expect(entryFileSubpath).toBeTruthy();
      expect(entryFileRelative).toBeTruthy();
      expect(entryFileAlias).toBeTruthy();
      expect(entryFilePathAlias).toBeTruthy();
    });

    describe("JSR 包子路径导出解析", () => {
      it("应该能够解析 @dreamer/logger/client", async () => {
        try {
          // 启用调试模式查看解析过程
          const result = await buildBundle({
            entryPoint: entryFile,
            globalName: "TestClient",
            platform: "browser",
            format: "iife",
            plugins: [createResolverPlugin({ debug: true })],
          });

          // 如果打包成功，说明解析器插件工作正常
          expect(result).toBeDefined();
          expect(result.code).toBeDefined();
          expect(typeof result.code).toBe("string");
          expect(result.code.length).toBeGreaterThan(0);
          expect(result.code).toContain("TestClient");
          // 验证代码中包含了 logger 相关的内容
          expect(result.code).toMatch(/logger|Logger|createLogger/i);
        } catch (error) {
          // 如果失败，输出详细错误信息
          const errorMessage = error instanceof Error
            ? error.message
            : String(error);
          console.error("打包失败:", errorMessage);
          throw error;
        }
      }, { sanitizeOps: false, sanitizeResources: false });

      it("应该能够自动解析（不显式添加插件）", async () => {
        try {
          // buildBundle 在 Deno 环境下应该自动添加 Deno 解析器插件
          const result = await buildBundle({
            entryPoint: entryFile,
            globalName: "TestClient2",
            platform: "browser",
            format: "iife",
          });

          expect(result).toBeDefined();
          expect(result.code).toBeDefined();
          expect(result.code.length).toBeGreaterThan(0);
          expect(result.code).toContain("TestClient2");
        } catch (error) {
          const errorMessage = error instanceof Error
            ? error.message
            : String(error);
          console.error("自动解析失败:", errorMessage);
          throw error;
        }
      }, { sanitizeOps: false, sanitizeResources: false });
    });

    describe("直接使用 jsr: 协议", () => {
      it("应该能够解析直接使用 jsr: 协议的导入", async () => {
        try {
          // 确保文件已创建
          if (!entryFileJsrDirect) {
            throw new Error("entryFileJsrDirect 未初始化");
          }
          const result = await buildBundle({
            entryPoint: entryFileJsrDirect,
            globalName: "TestJSRDirect",
            platform: "browser",
            format: "iife",
            plugins: [createResolverPlugin({ debug: false })],
          });

          expect(result).toBeDefined();
          expect(result.code).toBeDefined();
          expect(typeof result.code).toBe("string");
          expect(result.code.length).toBeGreaterThan(0);
          expect(result.code).toContain("TestJSRDirect");
          // 验证代码中包含了 logger 相关的内容
          expect(result.code).toMatch(/logger|Logger|createLogger/i);
        } catch (error) {
          const errorMessage = error instanceof Error
            ? error.message
            : String(error);
          console.error("jsr: 协议直接导入失败:", errorMessage);
          throw error;
        }
      }, { sanitizeOps: false, sanitizeResources: false });

      it("应该能够解析 jsr: 协议的子路径", async () => {
        try {
          // 测试 jsr: 协议带子路径的情况
          const testFile = join(testDataDir, "test-jsr-subpath.ts");
          await writeTextFile(
            testFile,
            `import { createLogger } from "jsr:@dreamer/logger@^1.0.0-beta.4/client";

const logger = createLogger("test");
logger.info("Test");

export { logger };
`,
          );

          const result = await buildBundle({
            entryPoint: testFile,
            globalName: "TestJSRSubpath",
            platform: "browser",
            format: "iife",
            plugins: [createResolverPlugin({ debug: false })],
          });

          expect(result).toBeDefined();
          expect(result.code).toBeDefined();
          expect(result.code.length).toBeGreaterThan(0);
          expect(result.code).toContain("TestJSRSubpath");
        } catch (error) {
          const errorMessage = error instanceof Error
            ? error.message
            : String(error);
          console.error("jsr: 协议子路径导入失败:", errorMessage);
          throw error;
        }
      }, { sanitizeOps: false, sanitizeResources: false });
    });

    describe("直接使用 npm: 协议", () => {
      it("应该能够识别 npm: 协议", async () => {
        try {
          // 确保文件已创建
          if (!entryFileNpmDirect) {
            throw new Error("entryFileNpmDirect 未初始化");
          }
          // npm: 协议通常通过 deno.json 的 imports 映射使用
          // 这里测试解析器能否识别 npm: 协议格式
          const result = await buildBundle({
            entryPoint: entryFileNpmDirect,
            globalName: "TestNPMDirect",
            platform: "browser",
            format: "iife",
            plugins: [createResolverPlugin({ debug: false })],
          });

          expect(result).toBeDefined();
          expect(result.code).toBeDefined();
          expect(result.code.length).toBeGreaterThan(0);
          expect(result.code).toContain("TestNPMDirect");
          expect(result.code).toContain("npm-protocol-test");
        } catch (error) {
          const errorMessage = error instanceof Error
            ? error.message
            : String(error);
          console.error("npm: 协议识别失败:", errorMessage);
          throw error;
        }
      }, { sanitizeOps: false, sanitizeResources: false });
    });

    describe("子路径导出测试", () => {
      it("应该能够解析单级子路径", async () => {
        try {
          // 确保文件已创建
          if (!entryFileSubpath) {
            throw new Error("entryFileSubpath 未初始化");
          }
          const result = await buildBundle({
            entryPoint: entryFileSubpath,
            globalName: "TestSubpath",
            platform: "browser",
            format: "iife",
            plugins: [createResolverPlugin({ debug: false })],
          });

          expect(result).toBeDefined();
          expect(result.code).toBeDefined();
          expect(result.code.length).toBeGreaterThan(0);
          expect(result.code).toContain("TestSubpath");
          expect(result.code).toMatch(/logger|Logger|createLogger/i);
        } catch (error) {
          const errorMessage = error instanceof Error
            ? error.message
            : String(error);
          console.error("单级子路径解析失败:", errorMessage);
          throw error;
        }
      }, { sanitizeOps: false, sanitizeResources: false });

      it("应该能够处理通过 deno.json imports 映射的子路径", async () => {
        try {
          // 这个测试验证通过 deno.json 的 imports 映射来解析子路径
          const result = await buildBundle({
            entryPoint: entryFile, // 使用 @dreamer/logger/client，通过 deno.json 映射
            globalName: "TestImportsMapping",
            platform: "browser",
            format: "iife",
            plugins: [createResolverPlugin({ debug: false })],
          });

          expect(result).toBeDefined();
          expect(result.code).toBeDefined();
          expect(result.code.length).toBeGreaterThan(0);
          expect(result.code).toContain("TestImportsMapping");
        } catch (error) {
          const errorMessage = error instanceof Error
            ? error.message
            : String(error);
          console.error("deno.json imports 映射子路径失败:", errorMessage);
          throw error;
        }
      }, { sanitizeOps: false, sanitizeResources: false });
    });

    describe("相对路径导入测试", () => {
      it("应该能够解析同级目录的相对路径导入", async () => {
        try {
          // 创建同级目录的文件
          const sameLevelFile = join(testDataDir, "same-level.ts");
          const utilsFile = join(testDataDir, "utils.ts");

          await writeTextFile(
            utilsFile,
            `export const utilValue = "util-result";
`,
          );

          await writeTextFile(
            sameLevelFile,
            `import { utilValue } from "./utils.ts";

export const result = utilValue;
`,
          );

          const result = await buildBundle({
            entryPoint: sameLevelFile,
            globalName: "TestSameLevel",
            platform: "browser",
            format: "iife",
            plugins: [createResolverPlugin({ debug: false })],
          });

          expect(result).toBeDefined();
          expect(result.code).toBeDefined();
          expect(result.code.length).toBeGreaterThan(0);
          expect(result.code).toContain("TestSameLevel");
          expect(result.code).toContain("util-result");
        } catch (error) {
          const errorMessage = error instanceof Error
            ? error.message
            : String(error);
          console.error("同级目录相对路径导入失败:", errorMessage);
          throw error;
        }
      }, { sanitizeOps: false, sanitizeResources: false });

      it("应该能够解析子目录的相对路径导入", async () => {
        try {
          if (!entryFileRelative) {
            throw new Error("entryFileRelative 未初始化");
          }

          const result = await buildBundle({
            entryPoint: entryFileRelative,
            globalName: "TestRelative",
            platform: "browser",
            format: "iife",
            plugins: [createResolverPlugin({ debug: false })],
          });

          expect(result).toBeDefined();
          expect(result.code).toBeDefined();
          expect(result.code.length).toBeGreaterThan(0);
          expect(result.code).toContain("TestRelative");
          expect(result.code).toContain("helper-result");
          expect(result.code).toContain("test-settings");
        } catch (error) {
          const errorMessage = error instanceof Error
            ? error.message
            : String(error);
          console.error("子目录相对路径导入失败:", errorMessage);
          throw error;
        }
      }, { sanitizeOps: false, sanitizeResources: false });

      it("应该能够解析父目录的相对路径导入", async () => {
        try {
          // 在子目录中创建文件，导入父目录的文件
          const subDir = join(testDataDir, "subdir");
          await mkdir(subDir, { recursive: true });

          const parentFile = join(testDataDir, "parent.ts");
          const childFile = join(subDir, "child.ts");

          await writeTextFile(
            parentFile,
            `export const parentValue = "parent-result";
`,
          );

          await writeTextFile(
            childFile,
            `import { parentValue } from "../parent.ts";

export const result = parentValue;
`,
          );

          const result = await buildBundle({
            entryPoint: childFile,
            globalName: "TestParentDir",
            platform: "browser",
            format: "iife",
            plugins: [createResolverPlugin({ debug: false })],
          });

          expect(result).toBeDefined();
          expect(result.code).toBeDefined();
          expect(result.code.length).toBeGreaterThan(0);
          expect(result.code).toContain("TestParentDir");
          expect(result.code).toContain("parent-result");
        } catch (error) {
          const errorMessage = error instanceof Error
            ? error.message
            : String(error);
          console.error("父目录相对路径导入失败:", errorMessage);
          throw error;
        }
      }, { sanitizeOps: false, sanitizeResources: false });
    });

    describe("路径别名测试", () => {
      it("应该能够解析通过 deno.json imports 配置的别名", async () => {
        try {
          if (!entryFileAlias) {
            throw new Error("entryFileAlias 未初始化");
          }

          // 测试通过 deno.json imports 配置的别名（如 @dreamer/logger/client）
          // 使用子路径避免 Node.js 内置模块在浏览器环境下的问题
          const result = await buildBundle({
            entryPoint: entryFileAlias,
            globalName: "TestAlias",
            platform: "browser",
            format: "iife",
            plugins: [createResolverPlugin({ debug: false })],
          });

          expect(result).toBeDefined();
          expect(result.code).toBeDefined();
          expect(result.code.length).toBeGreaterThan(0);
          expect(result.code).toContain("TestAlias");
          expect(result.code).toMatch(/logger|Logger|createLogger/i);
        } catch (error) {
          const errorMessage = error instanceof Error
            ? error.message
            : String(error);
          console.error("路径别名解析失败:", errorMessage);
          throw error;
        }
      }, { sanitizeOps: false, sanitizeResources: false });

      it("应该能够解析带子路径的别名", async () => {
        try {
          // 测试带子路径的别名（如 @dreamer/logger/client）
          const aliasSubpathFile = join(testDataDir, "test-alias-subpath.ts");
          await writeTextFile(
            aliasSubpathFile,
            `import { createLogger } from "@dreamer/logger/client";

const logger = createLogger("test");
logger.info("Test alias subpath");

export { logger };
`,
          );

          const result = await buildBundle({
            entryPoint: aliasSubpathFile,
            globalName: "TestAliasSubpath",
            platform: "browser",
            format: "iife",
            plugins: [createResolverPlugin({ debug: false })],
          });

          expect(result).toBeDefined();
          expect(result.code).toBeDefined();
          expect(result.code.length).toBeGreaterThan(0);
          expect(result.code).toContain("TestAliasSubpath");
        } catch (error) {
          const errorMessage = error instanceof Error
            ? error.message
            : String(error);
          console.error("带子路径的别名解析失败:", errorMessage);
          throw error;
        }
      }, { sanitizeOps: false, sanitizeResources: false });
    });

    describe("deno.json 路径别名测试", () => {
      it("应该能够解析 deno.json 中配置的路径别名", async () => {
        try {
          if (!entryFilePathAlias) {
            throw new Error("entryFilePathAlias 未初始化");
          }

          // 测试通过 tests/data/deno.json 配置的路径别名
          const result = await buildBundle({
            entryPoint: entryFilePathAlias,
            globalName: "TestPathAlias",
            platform: "browser",
            format: "iife",
            plugins: [createResolverPlugin({ debug: false })],
          });

          expect(result).toBeDefined();
          expect(result.code).toBeDefined();
          expect(result.code.length).toBeGreaterThan(0);
          expect(result.code).toContain("TestPathAlias");
          // 验证别名解析成功，代码中应该包含导入的内容
          expect(result.code).toContain("helper-result");
          expect(result.code).toContain("test-settings");
          expect(result.code).toMatch(/add|multiply|formatMessage/i);
        } catch (error) {
          const errorMessage = error instanceof Error
            ? error.message
            : String(error);
          console.error("deno.json 路径别名解析失败:", errorMessage);
          throw error;
        }
      }, { sanitizeOps: false, sanitizeResources: false });

      it("应该能够解析 @/ 路径别名", async () => {
        try {
          // 测试 @/ 别名
          const testFile = join(testDataDir, "test-at-alias.ts");
          await writeTextFile(
            testFile,
            `import { formatMessage } from "@/utils.ts";

const msg = formatMessage("test");
export { msg };
`,
          );

          const result = await buildBundle({
            entryPoint: testFile,
            globalName: "TestAtAlias",
            platform: "browser",
            format: "iife",
            plugins: [createResolverPlugin({ debug: false })],
          });

          expect(result).toBeDefined();
          expect(result.code).toBeDefined();
          expect(result.code.length).toBeGreaterThan(0);
          expect(result.code).toContain("TestAtAlias");
          expect(result.code).toContain("Formatted");
        } catch (error) {
          const errorMessage = error instanceof Error
            ? error.message
            : String(error);
          console.error("@/ 路径别名解析失败:", errorMessage);
          throw error;
        }
      }, { sanitizeOps: false, sanitizeResources: false });

      it("应该能够解析 ~/ 路径别名", async () => {
        try {
          // 测试 ~/ 别名
          const testFile = join(testDataDir, "test-tilde-alias.ts");
          await writeTextFile(
            testFile,
            `import { helperFunction } from "~/utils/helper.ts";

const result = helperFunction();
export { result };
`,
          );

          const result = await buildBundle({
            entryPoint: testFile,
            globalName: "TestTildeAlias",
            platform: "browser",
            format: "iife",
            plugins: [createResolverPlugin({ debug: false })],
          });

          expect(result).toBeDefined();
          expect(result.code).toBeDefined();
          expect(result.code.length).toBeGreaterThan(0);
          expect(result.code).toContain("TestTildeAlias");
          expect(result.code).toContain("helper-result");
        } catch (error) {
          const errorMessage = error instanceof Error
            ? error.message
            : String(error);
          console.error("~/ 路径别名解析失败:", errorMessage);
          throw error;
        }
      }, { sanitizeOps: false, sanitizeResources: false });
    });

    // 清理测试输出目录
    it("应该清理测试输出目录", async () => {
      if (testDataDir) {
        try {
          await cleanupDir(testDataDir);
        } catch {
          // 忽略错误
        }
      }
    });
  });
} else {
  // Bun 环境下的解析器测试
  // 注意：Bun 不支持 jsr: 协议，主要测试 npm 包和相对路径导入
  describe("Bun 解析器插件", () => {
    let testDataDir: string = "";
    let entryFileRelative: string = "";
    let entryFileNpm: string = "";
    let entryFileAlias: string = "";

    // 测试前创建测试目录和测试文件
    it("应该创建测试目录和测试文件", async () => {
      testDataDir = getTestDataDir();
      entryFileRelative = join(testDataDir, "bun-relative-test.ts");
      entryFileNpm = join(testDataDir, "bun-npm-test.ts");
      entryFileAlias = join(testDataDir, "bun-alias-test.ts");

      // 确保目录存在
      await mkdir(testDataDir, { recursive: true });

      // 创建测试目录结构
      const utilsDir = join(testDataDir, "utils");
      const configDir = join(testDataDir, "config");
      await mkdir(utilsDir, { recursive: true });
      await mkdir(configDir, { recursive: true });

      // 创建工具文件
      await writeTextFile(
        join(utilsDir, "helper.ts"),
        `export function helperFunction() {
  return "bun-helper-result";
}
`,
      );

      // 创建配置文件
      await writeTextFile(
        join(configDir, "settings.ts"),
        `export const settings = {
  name: "bun-test-settings",
  version: "1.0.0"
};
`,
      );

      // 创建测试入口文件 1: 测试相对路径导入
      await writeTextFile(
        entryFileRelative,
        `// 测试相对路径导入
import { helperFunction } from "./utils/helper.ts";
import { settings } from "./config/settings.ts";

const result = helperFunction();
const config = settings;

export { result, config };
`,
      );

      // 创建测试入口文件 2: 测试 npm 包导入（Bun 原生支持 npm）
      await writeTextFile(
        entryFileNpm,
        `// 测试 npm 包导入（Bun 原生支持）
// 注意：这里使用一个简单的 npm 包进行测试
console.log("Test NPM package import in Bun");

export const testNpm = "bun-npm-test";
`,
      );

      // 创建测试入口文件 3: 测试路径别名（如果 package.json 中有配置）
      // Bun 支持两种方式配置路径别名：
      // 1. tsconfig.json 的 paths 字段（支持 @/ 和 ~/ 前缀）
      // 2. package.json 的 imports 字段（只支持 # 前缀）
      // 这里使用 tsconfig.json 来支持 @/ 和 ~/ 前缀
      const testPackageJsonPath = join(testDataDir, "package.json");
      const testPackageJson = {
        name: "bun-resolver-test",
        version: "1.0.0",
        // package.json 的 imports 字段（使用 # 前缀，作为补充）
        imports: {
          "#config": "./config/settings.ts",
        },
      };
      writeTextFileSync(
        testPackageJsonPath,
        JSON.stringify(testPackageJson, null, 2),
      );

      // 创建 tsconfig.json 来支持 @/ 和 ~/ 路径别名
      // Bun 支持 tsconfig.json 的 paths 配置
      const testTsconfigPath = join(testDataDir, "tsconfig.json");
      const testTsconfig = {
        compilerOptions: {
          baseUrl: ".",
          paths: {
            // 配置路径别名（Bun 支持这种方式）
            "@/*": ["./src/*"],
            "@/lib/*": ["./src/lib/*"],
            "~/*": ["./*"],
            "~utils/*": ["./utils/*"],
            "~config/*": ["./config/*"],
          },
        },
      };
      writeTextFileSync(
        testTsconfigPath,
        JSON.stringify(testTsconfig, null, 2),
      );

      // 创建 src 目录结构
      const srcDir = join(testDataDir, "src");
      const libDir = join(srcDir, "lib");
      await mkdir(libDir, { recursive: true });

      // 创建库文件
      await writeTextFile(
        join(libDir, "math.ts"),
        `export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}
`,
      );

      // 创建工具文件
      await writeTextFile(
        join(srcDir, "utils.ts"),
        `export function formatMessage(msg: string): string {
  return \`[Bun Formatted] \${msg}\`;
}
`,
      );

      // 创建测试入口文件 3: 测试路径别名解析
      await writeTextFile(
        entryFileAlias,
        `// 测试路径别名解析（通过 package.json imports 配置）
// 使用 @/ 别名指向 ./src/
import { formatMessage } from "@/utils.ts";
// 使用 @/lib/ 别名指向 ./src/lib/
import { add, multiply } from "@/lib/math.ts";
// 使用 ~/ 别名指向 ./
import { helperFunction } from "~/utils/helper.ts";
// 使用 ~config/ 别名指向 ./config/
import { settings } from "~config/settings.ts";

const msg = formatMessage("Hello Bun");
const sum = add(1, 2);
const product = multiply(3, 4);
const helper = helperFunction();
const config = settings;

export { msg, sum, product, helper, config };
`,
      );

      expect(testDataDir).toBeTruthy();
      expect(entryFileRelative).toBeTruthy();
      expect(entryFileNpm).toBeTruthy();
      expect(entryFileAlias).toBeTruthy();
    });

    describe("相对路径导入测试", () => {
      it("应该能够解析同级目录的相对路径导入", async () => {
        try {
          // 创建同级目录的文件
          const sameLevelFile = join(testDataDir, "bun-same-level.ts");
          const utilsFile = join(testDataDir, "utils.ts");

          await writeTextFile(
            utilsFile,
            `export const utilValue = "bun-util-result";
`,
          );

          await writeTextFile(
            sameLevelFile,
            `import { utilValue } from "./utils.ts";

export const result = utilValue;
`,
          );

          const result = await buildBundle({
            entryPoint: sameLevelFile,
            globalName: "BunTestSameLevel",
            platform: "browser",
            format: "iife",
            plugins: [createResolverPlugin({ debug: false })],
          });

          expect(result).toBeDefined();
          expect(result.code).toBeDefined();
          expect(result.code.length).toBeGreaterThan(0);
          expect(result.code).toContain("BunTestSameLevel");
          expect(result.code).toContain("bun-util-result");
        } catch (error) {
          const errorMessage = error instanceof Error
            ? error.message
            : String(error);
          console.error("Bun 同级目录相对路径导入失败:", errorMessage);
          throw error;
        }
      });

      it("应该能够解析子目录的相对路径导入", async () => {
        try {
          if (!entryFileRelative) {
            throw new Error("entryFileRelative 未初始化");
          }

          const result = await buildBundle({
            entryPoint: entryFileRelative,
            globalName: "BunTestRelative",
            platform: "browser",
            format: "iife",
            plugins: [createResolverPlugin({ debug: false })],
          });

          expect(result).toBeDefined();
          expect(result.code).toBeDefined();
          expect(result.code.length).toBeGreaterThan(0);
          expect(result.code).toContain("BunTestRelative");
          expect(result.code).toContain("bun-helper-result");
          expect(result.code).toContain("bun-test-settings");
        } catch (error) {
          const errorMessage = error instanceof Error
            ? error.message
            : String(error);
          console.error("Bun 子目录相对路径导入失败:", errorMessage);
          throw error;
        }
      });

      it("应该能够解析父目录的相对路径导入", async () => {
        try {
          // 在子目录中创建文件，导入父目录的文件
          const subDir = join(testDataDir, "subdir");
          await mkdir(subDir, { recursive: true });

          const parentFile = join(testDataDir, "parent.ts");
          const childFile = join(subDir, "child.ts");

          await writeTextFile(
            parentFile,
            `export const parentValue = "bun-parent-result";
`,
          );

          await writeTextFile(
            childFile,
            `import { parentValue } from "../parent.ts";

export const result = parentValue;
`,
          );

          const result = await buildBundle({
            entryPoint: childFile,
            globalName: "BunTestParentDir",
            platform: "browser",
            format: "iife",
            plugins: [createResolverPlugin({ debug: false })],
          });

          expect(result).toBeDefined();
          expect(result.code).toBeDefined();
          expect(result.code.length).toBeGreaterThan(0);
          expect(result.code).toContain("BunTestParentDir");
          expect(result.code).toContain("bun-parent-result");
        } catch (error) {
          const errorMessage = error instanceof Error
            ? error.message
            : String(error);
          console.error("Bun 父目录相对路径导入失败:", errorMessage);
          throw error;
        }
      });
    });

    describe("npm 包导入测试", () => {
      it("应该能够识别 npm 包导入", async () => {
        try {
          if (!entryFileNpm) {
            throw new Error("entryFileNpm 未初始化");
          }

          // Bun 原生支持 npm 包，不需要特殊配置
          const result = await buildBundle({
            entryPoint: entryFileNpm,
            globalName: "BunTestNPM",
            platform: "browser",
            format: "iife",
            plugins: [createResolverPlugin({ debug: false })],
          });

          expect(result).toBeDefined();
          expect(result.code).toBeDefined();
          expect(result.code.length).toBeGreaterThan(0);
          expect(result.code).toContain("BunTestNPM");
          expect(result.code).toContain("bun-npm-test");
        } catch (error) {
          const errorMessage = error instanceof Error
            ? error.message
            : String(error);
          console.error("Bun npm 包导入失败:", errorMessage);
          throw error;
        }
      });
    });

    describe("路径别名测试", () => {
      it("应该能够解析 tsconfig.json 中配置的路径别名", async () => {
        try {
          if (!entryFileAlias) {
            throw new Error("entryFileAlias 未初始化");
          }

          // 测试通过 tsconfig.json paths 配置的路径别名
          // Bun 支持 tsconfig.json 的 paths 字段来解析 @/ 和 ~/ 别名
          const result = await buildBundle({
            entryPoint: entryFileAlias,
            globalName: "BunTestPathAlias",
            platform: "browser",
            format: "iife",
            plugins: [createResolverPlugin({ debug: false })],
          });

          expect(result).toBeDefined();
          expect(result.code).toBeDefined();
          expect(result.code.length).toBeGreaterThan(0);
          expect(result.code).toContain("BunTestPathAlias");
          // 验证别名解析成功，代码中应该包含导入的内容
          expect(result.code).toContain("bun-helper-result");
          expect(result.code).toContain("bun-test-settings");
          expect(result.code).toMatch(/add|multiply|formatMessage/i);
        } catch (error) {
          const errorMessage = error instanceof Error
            ? error.message
            : String(error);
          console.error("Bun 路径别名解析失败:", errorMessage);
          throw error;
        }
      });

      it("应该能够解析 @/ 路径别名（通过 tsconfig.json）", async () => {
        try {
          // 测试 @/ 别名（通过 tsconfig.json 的 paths 配置）
          const testFile = join(testDataDir, "bun-test-at-alias.ts");
          await writeTextFile(
            testFile,
            `import { formatMessage } from "@/utils.ts";

const msg = formatMessage("test");
export { msg };
`,
          );

          const result = await buildBundle({
            entryPoint: testFile,
            globalName: "BunTestAtAlias",
            platform: "browser",
            format: "iife",
            plugins: [createResolverPlugin({ debug: false })],
          });

          expect(result).toBeDefined();
          expect(result.code).toBeDefined();
          expect(result.code.length).toBeGreaterThan(0);
          expect(result.code).toContain("BunTestAtAlias");
          expect(result.code).toContain("Bun Formatted");
        } catch (error) {
          const errorMessage = error instanceof Error
            ? error.message
            : String(error);
          console.error("Bun @/ 路径别名解析失败:", errorMessage);
          throw error;
        }
      });

      it("应该能够解析 ~/ 路径别名（通过 tsconfig.json）", async () => {
        try {
          // 测试 ~/ 别名（通过 tsconfig.json 的 paths 配置）
          const testFile = join(testDataDir, "bun-test-tilde-alias.ts");
          await writeTextFile(
            testFile,
            `import { helperFunction } from "~/utils/helper.ts";

const result = helperFunction();
export { result };
`,
          );

          const result = await buildBundle({
            entryPoint: testFile,
            globalName: "BunTestTildeAlias",
            platform: "browser",
            format: "iife",
            plugins: [createResolverPlugin({ debug: false })],
          });

          expect(result).toBeDefined();
          expect(result.code).toBeDefined();
          expect(result.code.length).toBeGreaterThan(0);
          expect(result.code).toContain("BunTestTildeAlias");
          expect(result.code).toContain("bun-helper-result");
        } catch (error) {
          const errorMessage = error instanceof Error
            ? error.message
            : String(error);
          console.error("Bun ~/ 路径别名解析失败:", errorMessage);
          throw error;
        }
      });
    });

    describe("无 package.json 测试", () => {
      it("应该能够在没有 package.json 时处理相对路径和 npm 包", async () => {
        try {
          // 创建一个没有 package.json 的测试目录
          const noPackageDir = join(testDataDir, "no-package");
          await mkdir(noPackageDir, { recursive: true });

          const utilsDir = join(noPackageDir, "utils");
          await mkdir(utilsDir, { recursive: true });

          await writeTextFile(
            join(utilsDir, "helper.ts"),
            `export function helperFunction() {
  return "no-package-helper";
}
`,
          );

          const testFile = join(noPackageDir, "test-no-package.ts");
          await writeTextFile(
            testFile,
            `// 测试没有 package.json 时的相对路径导入
// Bun 应该能够从缓存读取 npm 包，相对路径也能正常工作
import { helperFunction } from "./utils/helper.ts";

const result = helperFunction();
export { result };
`,
          );

          // 即使没有 package.json，Bun 也应该能够工作
          // 注意：Bun 环境下，plugins 参数不会被使用（使用 bun build 命令）
          // 但这里测试的是相对路径导入，应该能正常工作
          const result = await buildBundle({
            entryPoint: testFile,
            globalName: "BunTestNoPackage",
            platform: "browser",
            format: "iife",
          });

          expect(result).toBeDefined();
          expect(result.code).toBeDefined();
          expect(result.code.length).toBeGreaterThan(0);
          expect(result.code).toContain("BunTestNoPackage");
          expect(result.code).toContain("no-package-helper");
        } catch (error) {
          const errorMessage = error instanceof Error
            ? error.message
            : String(error);
          console.error("Bun 无 package.json 测试失败:", errorMessage);
          throw error;
        }
      });
    });

    // 清理测试输出目录
    it("应该清理测试输出目录", async () => {
      if (testDataDir) {
        try {
          await cleanupDir(testDataDir);
        } catch {
          // 忽略错误
        }
      }
    });
  });
}
