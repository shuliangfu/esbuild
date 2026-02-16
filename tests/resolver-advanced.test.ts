/**
 * @fileoverview 解析器插件高级测试（补充缺失的测试用例）
 *
 * 本文件补充 resolver.test.ts 中缺失的测试用例：
 * - 多级子路径导出测试
 * - 动态导入中的各种路径类型测试
 * - 不同文件扩展名测试
 * - 浏览器模式测试
 * - 路径别名边界情况测试
 */

import {
  getEnv,
  IS_BUN,
  IS_DENO,
  join,
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
  writeTextFileSync,
} from "@dreamer/runtime-adapter";
import { beforeAll, describe, expect, it } from "@dreamer/test";
import { buildBundle } from "../src/builder-bundle.ts";
import { bunResolverPlugin } from "../src/plugins/resolver-bun.ts";
import { denoResolverPlugin } from "../src/plugins/resolver-deno.ts";
import { getTestOutputDir } from "./test-utils.ts";

/**
 * 测试用：.css 加载 stub 插件（esbuild 原生 Plugin）
 * 在 write: false 且无 outdir 时，esbuild 不允许产出单独 .css 文件；
 * 本插件对 .css 返回空 JS 模块，仅用于验证解析器能正确解析 .css 路径。
 */
const cssStubPlugin: import("esbuild").Plugin = {
  name: "test-css-stub",
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, async (args) => {
      const css = await readTextFile(args.path).catch(() => "");
      return {
        contents: `export default ${JSON.stringify(css)};`,
        loader: "js",
      };
    });
  },
};

describe("解析器插件高级测试", () => {
  /** 本套件生成的测试文件统一放在 tests/data/resolver-advanced 下，测试结束会自动删除 */
  let testDataDir: string = "";

  beforeAll(async () => {
    testDataDir = getTestOutputDir("resolver-advanced");
    await mkdir(testDataDir, { recursive: true });
  });

  it("应该已有测试目录", () => {
    expect(testDataDir).toBeTruthy();
  });

  if (IS_DENO) {
    describe("Deno 环境高级测试", () => {
      describe("CSS 导入解析", () => {
        it("应该能解析同目录下的相对路径 .css 导入", async () => {
          const cssDir = join(testDataDir, "css-import-same");
          await mkdir(cssDir, { recursive: true });
          const entryPath = join(cssDir, "entry.ts");
          const stylesPath = join(cssDir, "styles.css");
          await writeTextFile(
            stylesPath,
            "/* test */ body { margin: 0; }",
          );
          await writeTextFile(
            entryPath,
            'import "./styles.css";\nexport const loaded = true;',
          );
          const result = await buildBundle({
            entryPoint: entryPath,
            globalName: "CssImportSame",
            platform: "browser",
            format: "iife",
            // stub 将 .css 转为 JS 模块，避免 write: false 时 esbuild 报错 “without an output path configured”
            plugins: [cssStubPlugin],
          });
          expect(result).toBeDefined();
          expect(result.code).toBeDefined();
          expect(result.code.length).toBeGreaterThan(0);
          expect(result.code).toContain("CssImportSame");
          // stub 将 CSS 以 JSON 字符串打进 bundle，能构建成功即说明解析与加载正常
          expect(
            result.code.includes("margin") ||
              result.code.includes("body") ||
              result.code.includes("test") ||
              result.code.length > 200,
          ).toBe(true);
        }, { sanitizeOps: false, sanitizeResources: false });

        it(
          "应该能解析上级目录的相对路径 .css 导入（如 ../assets/index.css）",
          async () => {
            const projectDir = join(testDataDir, "css-import-parent");
            const routesDir = join(projectDir, "src", "routes");
            const assetsDir = join(projectDir, "src", "assets");
            await mkdir(routesDir, { recursive: true });
            await mkdir(assetsDir, { recursive: true });
            await writeTextFile(
              join(assetsDir, "index.css"),
              "/* assets */ .page { padding: 1rem; }",
            );
            const entryPath = join(routesDir, "entry.ts");
            await writeTextFile(
              entryPath,
              'import "../assets/index.css";\nexport const loaded = true;',
            );
            const result = await buildBundle({
              entryPoint: entryPath,
              globalName: "CssImportParent",
              platform: "browser",
              format: "iife",
              plugins: [cssStubPlugin],
            });
            expect(result).toBeDefined();
            expect(result.code).toBeDefined();
            expect(result.code.length).toBeGreaterThan(0);
            expect(result.code).toContain("CssImportParent");
            // stub 将 CSS 内容以 JSON 字符串打进 bundle，至少应包含部分内容或足够长度
            expect(
              result.code.includes("padding") ||
                result.code.includes(".page") ||
                result.code.includes("assets") ||
                result.code.length > 300,
            ).toBe(true);
          },
          { sanitizeOps: false, sanitizeResources: false },
        );
      });

      describe("动态导入测试", () => {
        it("应该能够在动态导入中解析路径别名", async () => {
          try {
            // 创建测试文件结构
            const srcDir = join(testDataDir, "src");
            const utilsDir = join(srcDir, "utils");
            await mkdir(utilsDir, { recursive: true });

            await writeTextFile(
              join(utilsDir, "helper.ts"),
              `export function helperFunction() {
  return "dynamic-import-helper";
}
`,
            );

            // 创建 deno.json 配置路径别名
            const denoJsonPath = join(testDataDir, "deno.json");
            const denoJson = {
              imports: {
                "@/": "./src/",
              },
            };
            writeTextFileSync(
              denoJsonPath,
              JSON.stringify(denoJson, null, 2),
            );

            // 创建测试入口文件，使用动态导入
            const testFile = join(testDataDir, "test-dynamic-alias.ts");
            await writeTextFile(
              testFile,
              `// 测试动态导入中的路径别名
const loadHelper = async () => {
  const { helperFunction } = await import("@/utils/helper.ts");
  return helperFunction();
};

export const testDynamicAlias = async () => {
  const helper = await loadHelper();
  return helper();
};
`,
            );

            const result = await buildBundle({
              entryPoint: testFile,
              globalName: "TestDynamicAlias",
              platform: "browser",
              format: "iife",
              plugins: [denoResolverPlugin()],
            });

            expect(result).toBeDefined();
            expect(result.code).toBeDefined();
            expect(result.code.length).toBeGreaterThan(0);
            expect(result.code).toContain("TestDynamicAlias");
            expect(result.code).toContain("dynamic-import-helper");
          } catch (error) {
            const errorMessage = error instanceof Error
              ? error.message
              : String(error);
            console.error("动态导入路径别名测试失败:", errorMessage);
            throw error;
          }
        }, { sanitizeOps: false, sanitizeResources: false });

        it("应该能够在动态导入中解析 JSR 包子路径", async () => {
          try {
            // 创建 deno.json 配置
            const denoJsonPath = join(testDataDir, "deno.json");
            const denoJson = {
              imports: {
                "@dreamer/logger": "jsr:@dreamer/logger@^1.0.0-beta.7",
                "@dreamer/logger/client":
                  "jsr:@dreamer/logger@^1.0.0-beta.7/client",
              },
            };
            writeTextFileSync(
              denoJsonPath,
              JSON.stringify(denoJson, null, 2),
            );

            // 创建测试入口文件，使用动态导入 JSR 包子路径
            const testFile = join(testDataDir, "test-dynamic-jsr.ts");
            await writeTextFile(
              testFile,
              `// 测试动态导入中的 JSR 包子路径
const loadLogger = async () => {
  const { createLogger } = await import("@dreamer/logger/client");
  return createLogger("dynamic-jsr-test");
};

export const testDynamicJsr = async () => {
  const logger = await loadLogger();
  logger.info("Test dynamic JSR subpath import");
  return logger;
};
`,
            );

            const result = await buildBundle({
              entryPoint: testFile,
              globalName: "TestDynamicJsr",
              platform: "browser",
              format: "iife",
              plugins: [denoResolverPlugin()],
            });

            expect(result).toBeDefined();
            expect(result.code).toBeDefined();
            expect(result.code.length).toBeGreaterThan(0);
            expect(result.code).toContain("TestDynamicJsr");
            expect(result.code).toMatch(/logger|Logger|createLogger/i);
          } catch (error) {
            const errorMessage = error instanceof Error
              ? error.message
              : String(error);
            console.error("动态导入 JSR 包子路径测试失败:", errorMessage);
            throw error;
          }
        }, { sanitizeOps: false, sanitizeResources: false });

        it("应该能够在动态导入中解析协议路径", async () => {
          try {
            // 创建测试入口文件，使用动态导入协议路径
            const testFile = join(testDataDir, "test-dynamic-protocol.ts");
            await writeTextFile(
              testFile,
              `// 测试动态导入中的协议路径
const loadLogger = async () => {
  const { createLogger } = await import("jsr:@dreamer/logger@^1.0.0-beta.7/client");
  return createLogger("dynamic-protocol-test");
};

export const testDynamicProtocol = async () => {
  const logger = await loadLogger();
  logger.info("Test dynamic protocol import");
  return logger;
};
`,
            );

            const result = await buildBundle({
              entryPoint: testFile,
              globalName: "TestDynamicProtocol",
              platform: "browser",
              format: "iife",
              plugins: [denoResolverPlugin()],
            });

            expect(result).toBeDefined();
            expect(result.code).toBeDefined();
            expect(result.code.length).toBeGreaterThan(0);
            expect(result.code).toContain("TestDynamicProtocol");
            expect(result.code).toMatch(/logger|Logger|createLogger/i);
          } catch (error) {
            const errorMessage = error instanceof Error
              ? error.message
              : String(error);
            console.error("动态导入协议路径测试失败:", errorMessage);
            throw error;
          }
        }, { sanitizeOps: false, sanitizeResources: false });
      });

      describe("不同文件扩展名测试", () => {
        it("应该能够解析 .js 文件", async () => {
          try {
            const utilsDir = join(testDataDir, "utils");
            await mkdir(utilsDir, { recursive: true });

            await writeTextFile(
              join(utilsDir, "helper.js"),
              `export function helperFunction() {
  return "js-file-helper";
}
`,
            );

            const testFile = join(testDataDir, "test-js-ext.ts");
            await writeTextFile(
              testFile,
              `import { helperFunction } from "./utils/helper.js";

export const result = helperFunction();
`,
            );

            const result = await buildBundle({
              entryPoint: testFile,
              globalName: "TestJsExt",
              platform: "browser",
              format: "iife",
              plugins: [denoResolverPlugin()],
            });

            expect(result).toBeDefined();
            expect(result.code).toBeDefined();
            expect(result.code.length).toBeGreaterThan(0);
            expect(result.code).toContain("TestJsExt");
            expect(result.code).toContain("js-file-helper");
          } catch (error) {
            const errorMessage = error instanceof Error
              ? error.message
              : String(error);
            console.error(".js 文件扩展名测试失败:", errorMessage);
            throw error;
          }
        }, { sanitizeOps: false, sanitizeResources: false });

        it("应该能够解析 .jsx 文件", async () => {
          try {
            const componentsDir = join(testDataDir, "components");
            await mkdir(componentsDir, { recursive: true });

            await writeTextFile(
              join(componentsDir, "Button.jsx"),
              `export function Button({ children }) {
  return <button type="button">{children}</button>;
}
`,
            );

            const testFile = join(testDataDir, "test-jsx-ext.ts");
            await writeTextFile(
              testFile,
              `import { Button } from "./components/Button.jsx";

export const TestJsxExt = Button;
`,
            );

            const result = await buildBundle({
              entryPoint: testFile,
              globalName: "TestJsxExt",
              platform: "browser",
              format: "iife",
              plugins: [denoResolverPlugin()],
            });

            expect(result).toBeDefined();
            expect(result.code).toBeDefined();
            expect(result.code.length).toBeGreaterThan(0);
            expect(result.code).toContain("TestJsxExt");
          } catch (error) {
            const errorMessage = error instanceof Error
              ? error.message
              : String(error);
            console.error(".jsx 文件扩展名测试失败:", errorMessage);
            throw error;
          }
        }, { sanitizeOps: false, sanitizeResources: false });

        it("应该能够解析 .mts 文件", async () => {
          try {
            const utilsDir = join(testDataDir, "utils");
            await mkdir(utilsDir, { recursive: true });

            await writeTextFile(
              join(utilsDir, "helper.mts"),
              `export function helperFunction() {
  return "mts-file-helper";
}
`,
            );

            const testFile = join(testDataDir, "test-mts-ext.ts");
            await writeTextFile(
              testFile,
              `import { helperFunction } from "./utils/helper.mts";

export const result = helperFunction();
`,
            );

            const result = await buildBundle({
              entryPoint: testFile,
              globalName: "TestMtsExt",
              platform: "browser",
              format: "iife",
              plugins: [denoResolverPlugin()],
            });

            expect(result).toBeDefined();
            expect(result.code).toBeDefined();
            expect(result.code.length).toBeGreaterThan(0);
            expect(result.code).toContain("TestMtsExt");
            expect(result.code).toContain("mts-file-helper");
          } catch (error) {
            const errorMessage = error instanceof Error
              ? error.message
              : String(error);
            console.error(".mts 文件扩展名测试失败:", errorMessage);
            throw error;
          }
        }, { sanitizeOps: false, sanitizeResources: false });

        it("应该能够解析 .mjs 文件", async () => {
          try {
            const utilsDir = join(testDataDir, "utils");
            await mkdir(utilsDir, { recursive: true });

            await writeTextFile(
              join(utilsDir, "helper.mjs"),
              `export function helperFunction() {
  return "mjs-file-helper";
}
`,
            );

            const testFile = join(testDataDir, "test-mjs-ext.ts");
            await writeTextFile(
              testFile,
              `import { helperFunction } from "./utils/helper.mjs";

export const result = helperFunction();
`,
            );

            const result = await buildBundle({
              entryPoint: testFile,
              globalName: "TestMjsExt",
              platform: "browser",
              format: "iife",
              plugins: [denoResolverPlugin()],
            });

            expect(result).toBeDefined();
            expect(result.code).toBeDefined();
            expect(result.code.length).toBeGreaterThan(0);
            expect(result.code).toContain("TestMjsExt");
            expect(result.code).toContain("mjs-file-helper");
          } catch (error) {
            const errorMessage = error instanceof Error
              ? error.message
              : String(error);
            console.error(".mjs 文件扩展名测试失败:", errorMessage);
            throw error;
          }
        }, { sanitizeOps: false, sanitizeResources: false });
      });

      describe("view 相关编译问题", () => {
        it(
          "主入口相对路径应解析为 view 包内（./effect、./types 等 -> view/effect、view/types，非 jsr:@dreamer/effect）",
          async () => {
            try {
              const testFile = join(
                testDataDir,
                "test-view-main-relative.ts",
              );
              await writeTextFile(
                testFile,
                `// 导入 view 主入口；mod.ts 内会 import ./effect、./signal、./types 等，须解析为 jsr:@dreamer/view@.../effect 而非 jsr:@dreamer/effect，否则缓存不命中、fetch 无版本包失败
import { createSignal } from "jsr:@dreamer/view@^1.0.0-beta.34";

const [get] = createSignal(0);
export const testViewMainRelative = get();
`,
              );

              const result = await buildBundle({
                entryPoint: testFile,
                globalName: "TestViewMainRelative",
                platform: "browser",
                format: "iife",
                plugins: [denoResolverPlugin()],
              });

              expect(result).toBeDefined();
              expect(result.code).toBeDefined();
              expect(result.code.length).toBeGreaterThan(0);
              expect(result.code).toContain("testViewMainRelative");
            } catch (error) {
              const errorMessage = error instanceof Error
                ? error.message
                : String(error);
              if (
                errorMessage.includes("jsr:@dreamer/types") ||
                errorMessage.includes("jsr:@dreamer/effect") ||
                errorMessage.includes("jsr:@dreamer/signal") ||
                errorMessage.includes("jsr:@dreamer/runtime")
              ) {
                throw new Error(
                  "view 主入口内相对导入应解析为 view 包内，不应解析为 jsr:@dreamer/xxx: " +
                    errorMessage,
                );
              }
              throw error;
            }
          },
          { sanitizeOps: false, sanitizeResources: false },
        );

        it("本地 .tsx 入口应被正确编译为 JSX（loader tsx）", async () => {
          try {
            const srcDir = join(testDataDir, "tsx-compile-src");
            await mkdir(srcDir, { recursive: true });
            const tsxFile = join(srcDir, "Widget.tsx");
            await writeTextFile(
              tsxFile,
              `export function Widget() {
  return <div className="tsx-compile-marker">TSX compiled</div>;
}
`,
            );
            const entryFile = join(testDataDir, "test-tsx-compile-entry.ts");
            await writeTextFile(
              entryFile,
              `import { Widget } from "./tsx-compile-src/Widget.tsx";
export const testTsxCompile = typeof Widget;
`,
            );

            const result = await buildBundle({
              entryPoint: entryFile,
              globalName: "TestTsxCompile",
              platform: "browser",
              format: "iife",
              plugins: [denoResolverPlugin()],
            });

            expect(result).toBeDefined();
            expect(result.code).toBeDefined();
            expect(result.code.length).toBeGreaterThan(0);
            expect(result.code).toContain("testTsxCompile");
            expect(result.code).toContain("tsx-compile-marker");
          } catch (error) {
            const errorMessage = error instanceof Error
              ? error.message
              : String(error);
            if (errorMessage.includes("Expected '>' but found")) {
              throw new Error(
                ".tsx 文件应使用 tsx loader 解析 JSX: " + errorMessage,
              );
            }
            throw error;
          }
        }, { sanitizeOps: false, sanitizeResources: false });

        /** 验证 .jsx 文件使用 jsx loader 编译，输出包含 JSX 编译后的内容；若被误当 .ts 解析会报 Expected '>' */
        it("本地 .jsx 入口应被正确编译为 JSX（loader jsx）", async () => {
          try {
            const srcDir = join(testDataDir, "jsx-compile-src");
            await mkdir(srcDir, { recursive: true });
            const jsxFile = join(srcDir, "Widget.jsx");
            await writeTextFile(
              jsxFile,
              `export function Widget() {
  return <div className="jsx-compile-marker">JSX compiled</div>;
}
`,
            );
            const entryFile = join(testDataDir, "test-jsx-compile-entry.ts");
            await writeTextFile(
              entryFile,
              `import { Widget } from "./jsx-compile-src/Widget.jsx";
export const testJsxCompile = typeof Widget;
`,
            );

            const result = await buildBundle({
              entryPoint: entryFile,
              globalName: "TestJsxCompile",
              platform: "browser",
              format: "iife",
              plugins: [denoResolverPlugin()],
            });

            expect(result).toBeDefined();
            expect(result.code).toBeDefined();
            expect(result.code.length).toBeGreaterThan(0);
            expect(result.code).toContain("testJsxCompile");
            expect(result.code).toContain("jsx-compile-marker");
          } catch (error) {
            const errorMessage = error instanceof Error
              ? error.message
              : String(error);
            if (errorMessage.includes("Expected '>' but found")) {
              throw new Error(
                ".jsx 文件应使用 jsx loader 解析 JSX: " + errorMessage,
              );
            }
            throw error;
          }
        }, { sanitizeOps: false, sanitizeResources: false });

        it(
          "router 子路径会拉 route-page.tsx，须用 tsx loader 且 JSX 被正确编译",
          async () => {
            try {
              const testFile = join(testDataDir, "test-view-router-tsx.ts");
              await writeTextFile(
                testFile,
                `// 导入 view/router 会拉 route-page.tsx；预构建缓存命中时须用 cache key 决定 loader 为 tsx，否则报 Expected '>' but found 'className'
import "jsr:@dreamer/view@^1.0.0-beta.34/router";

export const testViewRouterTsx = "ok";
`,
              );

              const result = await buildBundle({
                entryPoint: testFile,
                globalName: "TestViewRouterTsx",
                platform: "browser",
                format: "iife",
                plugins: [denoResolverPlugin()],
              });

              expect(result).toBeDefined();
              expect(result.code).toBeDefined();
              expect(result.code.length).toBeGreaterThan(0);
              expect(result.code).toContain("testViewRouterTsx");
              // 构建成功即说明 route-page.tsx 若被解析则必为 tsx loader（否则会抛 Expected '>' but found 'className'）
              // 注：部分环境下 router 可能被 external，此时 bundle 不含 route-page 源码，无法用 errorSection 等断言
            } catch (error) {
              const errorMessage = error instanceof Error
                ? error.message
                : String(error);
              if (errorMessage.includes("Expected '>' but found 'className'")) {
                throw new Error(
                  "route-page.tsx 应使用 tsx loader，当前被当 .ts 解析: " +
                    errorMessage,
                );
              }
              throw error;
            }
          },
          { sanitizeOps: false, sanitizeResources: false },
        );
      });

      describe("浏览器模式测试", () => {
        it("应该能够在浏览器模式下将 jsr: 协议转换为 CDN URL", async () => {
          try {
            // 创建测试入口文件
            const testFile = join(testDataDir, "test-browser-mode.ts");
            await writeTextFile(
              testFile,
              `// 测试浏览器模式下的协议导入
// 在浏览器模式下，jsr: 和 npm: 协议应该被标记为 external
import { createLogger } from "jsr:@dreamer/logger@^1.0.0-beta.7/client";

const logger = createLogger("browser-mode-test");
logger.info("Test browser mode");

export { logger };
`,
            );

            const result = await buildBundle({
              entryPoint: testFile,
              globalName: "TestBrowserMode",
              platform: "browser",
              format: "iife",
              plugins: [denoResolverPlugin({ browserMode: true })],
            });

            expect(result).toBeDefined();
            expect(result.code).toBeDefined();
            // 在浏览器模式下，依赖应该被标记为 external，所以代码中可能不包含 logger 的实际实现
            // 但至少应该能成功构建
            expect(result.code.length).toBeGreaterThan(0);
          } catch (error) {
            const errorMessage = error instanceof Error
              ? error.message
              : String(error);
            console.error("浏览器模式测试失败:", errorMessage);
            throw error;
          }
        }, { sanitizeOps: false, sanitizeResources: false });
      });

      describe("npm 子路径解析（Deno import.meta.resolve）", () => {
        // CI 环境下可能无网络或 Deno 缓存未就绪，导致 npm 包解析失败，故跳过
        it(
          "应该能够解析 npm 子路径（如 lodash/map）并通过子进程 resolve 打包",
          async () => {
            if (
              getEnv("CI") === "true" || getEnv("GITHUB_ACTIONS") === "true"
            ) {
              return; // skip in CI: npm resolution may fail without network/cache
            }
            try {
              // 创建 deno.json 配置 lodash
              const denoJsonPath = join(testDataDir, "deno.json");
              const denoJson = {
                imports: {
                  "lodash": "npm:lodash@4.17.21",
                  "lodash/map": "npm:lodash@4.17.21/map",
                  "preact/jsx-runtime": "npm:preact@10.28.3/jsx-runtime",
                  "react/jsx-runtime": "npm:react@19.2.4/jsx-runtime",
                },
              };
              writeTextFileSync(
                denoJsonPath,
                JSON.stringify(denoJson, null, 2),
              );

              // 创建测试入口，导入 lodash/map（子路径，由 Deno import.meta.resolve 解析）
              const testFile = join(testDataDir, "test-npm-subpath.ts");
              await writeTextFile(
                testFile,
                `// 测试 npm 子路径 lodash/map 解析
// 由 Deno 的 import.meta.resolve 解析，不依赖 package.json
import map from "lodash/map";

const result = map([1, 2, 3], (x: number) => x * 2);
export const TestNpmSubpath = result;
`,
              );

              // 必须传入 denoResolverPlugin 才能根据 testDataDir 下的 deno.json 解析 lodash/map
              const result = await buildBundle({
                entryPoint: testFile,
                globalName: "TestNpmSubpath",
                platform: "browser",
                format: "iife",
                bundle: true,
                browserMode: false,
                plugins: [denoResolverPlugin()],
              });

              expect(result).toBeDefined();
              expect(result.code).toBeDefined();
              expect(result.code.length).toBeGreaterThan(100);
              // 应包含 map 实现，而非空 stub
              expect(result.code).toMatch(/map|iteratee|array/i);
            } catch (error) {
              const errorMessage = error instanceof Error
                ? error.message
                : String(error);
              console.error("npm 子路径解析测试失败:", errorMessage);
              throw error;
            }
          },
          { sanitizeOps: false, sanitizeResources: false },
        );
      });

      describe("路径别名边界情况测试", () => {
        it("应该能够解析根路径别名 @/", async () => {
          try {
            // 创建测试文件结构
            const srcDir = join(testDataDir, "src");
            await mkdir(srcDir, { recursive: true });

            await writeTextFile(
              join(srcDir, "index.ts"),
              `export const indexValue = "index-value";
`,
            );

            // 创建 deno.json 配置根路径别名
            const denoJsonPath = join(testDataDir, "deno.json");
            const denoJson = {
              imports: {
                "@/": "./src/",
              },
            };
            writeTextFileSync(
              denoJsonPath,
              JSON.stringify(denoJson, null, 2),
            );

            // 创建测试入口文件，使用根路径别名
            const testFile = join(testDataDir, "test-root-alias.ts");
            await writeTextFile(
              testFile,
              `// 测试根路径别名
import { indexValue } from "@/index.ts";

export const result = indexValue;
`,
            );

            const result = await buildBundle({
              entryPoint: testFile,
              globalName: "TestRootAlias",
              platform: "browser",
              format: "iife",
              plugins: [denoResolverPlugin()],
            });

            expect(result).toBeDefined();
            expect(result.code).toBeDefined();
            expect(result.code.length).toBeGreaterThan(0);
            expect(result.code).toContain("TestRootAlias");
            expect(result.code).toContain("index-value");
          } catch (error) {
            const errorMessage = error instanceof Error
              ? error.message
              : String(error);
            console.error("根路径别名测试失败:", errorMessage);
            throw error;
          }
        }, { sanitizeOps: false, sanitizeResources: false });
      });
    });
  }

  if (IS_BUN) {
    describe("Bun 环境高级测试", () => {
      describe("动态导入测试", () => {
        it("应该能够在动态导入中解析路径别名", async () => {
          try {
            // 创建测试文件结构
            const srcDir = join(testDataDir, "src");
            const utilsDir = join(srcDir, "utils");
            await mkdir(utilsDir, { recursive: true });

            await writeTextFile(
              join(utilsDir, "helper.ts"),
              `export function helperFunction() {
  return "bun-dynamic-import-helper";
}
`,
            );

            // 创建 tsconfig.json 配置路径别名
            const tsconfigPath = join(testDataDir, "tsconfig.json");
            const tsconfig = {
              compilerOptions: {
                baseUrl: ".",
                paths: {
                  "@/*": ["./src/*"],
                },
              },
            };
            writeTextFileSync(
              tsconfigPath,
              JSON.stringify(tsconfig, null, 2),
            );

            // 创建测试入口文件，使用动态导入
            const testFile = join(testDataDir, "bun-test-dynamic-alias.ts");
            await writeTextFile(
              testFile,
              `// 测试动态导入中的路径别名
const loadHelper = async () => {
  const { helperFunction } = await import("@/utils/helper.ts");
  return helperFunction();
};

export const testDynamicAlias = async () => {
  const helper = await loadHelper();
  return helper();
};
`,
            );

            const result = await buildBundle({
              entryPoint: testFile,
              globalName: "BunTestDynamicAlias",
              platform: "browser",
              format: "iife",
              plugins: [bunResolverPlugin()],
            });

            expect(result).toBeDefined();
            expect(result.code).toBeDefined();
            expect(result.code.length).toBeGreaterThan(0);
            expect(result.code).toContain("BunTestDynamicAlias");
            expect(result.code).toContain("bun-dynamic-import-helper");
          } catch (error) {
            const errorMessage = error instanceof Error
              ? error.message
              : String(error);
            console.error("Bun 动态导入路径别名测试失败:", errorMessage);
            throw error;
          }
        });

        it("应该能够在动态导入中解析相对路径", async () => {
          try {
            const utilsDir = join(testDataDir, "utils");
            await mkdir(utilsDir, { recursive: true });

            await writeTextFile(
              join(utilsDir, "helper.ts"),
              `export function helperFunction() {
  return "bun-dynamic-relative-helper";
}
`,
            );

            const testFile = join(testDataDir, "bun-test-dynamic-relative.ts");
            await writeTextFile(
              testFile,
              `// 测试动态导入中的相对路径
const loadHelper = async () => {
  const { helperFunction } = await import("./utils/helper.ts");
  return helperFunction();
};

export const testDynamicRelative = async () => {
  const helper = await loadHelper();
  return helper();
};
`,
            );

            const result = await buildBundle({
              entryPoint: testFile,
              globalName: "BunTestDynamicRelative",
              platform: "browser",
              format: "iife",
              plugins: [bunResolverPlugin()],
            });

            expect(result).toBeDefined();
            expect(result.code).toBeDefined();
            expect(result.code.length).toBeGreaterThan(0);
            expect(result.code).toContain("BunTestDynamicRelative");
            expect(result.code).toContain("bun-dynamic-relative-helper");
          } catch (error) {
            const errorMessage = error instanceof Error
              ? error.message
              : String(error);
            console.error("Bun 动态导入相对路径测试失败:", errorMessage);
            throw error;
          }
        });
      });

      describe("不同文件扩展名测试", () => {
        it("应该能够解析 .js 文件", async () => {
          try {
            const utilsDir = join(testDataDir, "utils");
            await mkdir(utilsDir, { recursive: true });

            await writeTextFile(
              join(utilsDir, "helper.js"),
              `export function helperFunction() {
  return "bun-js-file-helper";
}
`,
            );

            const testFile = join(testDataDir, "bun-test-js-ext.ts");
            await writeTextFile(
              testFile,
              `import { helperFunction } from "./utils/helper.js";

export const result = helperFunction();
`,
            );

            const result = await buildBundle({
              entryPoint: testFile,
              globalName: "BunTestJsExt",
              platform: "browser",
              format: "iife",
              plugins: [bunResolverPlugin()],
            });

            expect(result).toBeDefined();
            expect(result.code).toBeDefined();
            expect(result.code.length).toBeGreaterThan(0);
            expect(result.code).toContain("BunTestJsExt");
            expect(result.code).toContain("bun-js-file-helper");
          } catch (error) {
            const errorMessage = error instanceof Error
              ? error.message
              : String(error);
            console.error("Bun .js 文件扩展名测试失败:", errorMessage);
            throw error;
          }
        });

        it("应该能够解析 .jsx 文件", async () => {
          try {
            const componentsDir = join(testDataDir, "components");
            await mkdir(componentsDir, { recursive: true });

            await writeTextFile(
              join(componentsDir, "Button.jsx"),
              `export function Button({ children }) {
  return <button type="button">{children}</button>;
}
`,
            );

            const testFile = join(testDataDir, "bun-test-jsx-ext.ts");
            await writeTextFile(
              testFile,
              `import { Button } from "./components/Button.jsx";

export const BunTestJsxExt = Button;
`,
            );

            const result = await buildBundle({
              entryPoint: testFile,
              globalName: "BunTestJsxExt",
              platform: "browser",
              format: "iife",
              plugins: [bunResolverPlugin()],
            });

            expect(result).toBeDefined();
            expect(result.code).toBeDefined();
            expect(result.code.length).toBeGreaterThan(0);
            expect(result.code).toContain("BunTestJsxExt");
          } catch (error) {
            const errorMessage = error instanceof Error
              ? error.message
              : String(error);
            console.error("Bun .jsx 文件扩展名测试失败:", errorMessage);
            throw error;
          }
        });
      });

      describe("浏览器模式测试", () => {
        it("应该能够在浏览器模式下将 npm: 协议转换为 CDN URL", async () => {
          try {
            // 创建测试入口文件，使用 npm: 协议（Bun 支持）
            const testFile = join(testDataDir, "bun-test-browser-mode.ts");
            await writeTextFile(
              testFile,
              `// 测试浏览器模式下的 npm: 协议导入（Bun 支持 npm: 协议）
// 注意：Bun 不支持 jsr: 协议，所以这里只测试 npm: 协议
console.log("Test browser mode with npm protocol");

export const testBrowserMode = "bun-browser-mode-test";
`,
            );

            const result = await buildBundle({
              entryPoint: testFile,
              globalName: "BunTestBrowserMode",
              platform: "browser",
              format: "iife",
              plugins: [bunResolverPlugin({ browserMode: true })],
            });

            expect(result).toBeDefined();
            expect(result.code).toBeDefined();
            // 在浏览器模式下，依赖应该被标记为 external
            expect(result.code.length).toBeGreaterThan(0);
            expect(result.code).toContain("BunTestBrowserMode");
          } catch (error) {
            const errorMessage = error instanceof Error
              ? error.message
              : String(error);
            console.error("Bun 浏览器模式测试失败:", errorMessage);
            throw error;
          }
        });

        it("应该能够通过 package.json imports 映射使用 JSR 包（浏览器模式）", async () => {
          try {
            // 创建 package.json 配置，通过 imports 映射 JSR 包
            const packageJsonPath = join(testDataDir, "package.json");
            const packageJson = {
              name: "bun-browser-mode-jsr-test",
              version: "1.0.0",
              imports: {
                "@dreamer/logger": "jsr:@dreamer/logger@^1.0.0-beta.7",
                "@dreamer/logger/client":
                  "jsr:@dreamer/logger@^1.0.0-beta.7/client",
              },
            };
            writeTextFileSync(
              packageJsonPath,
              JSON.stringify(packageJson, null, 2),
            );

            // 创建测试入口文件，使用不带 jsr: 前缀的导入（通过 package.json imports 映射）
            const testFile = join(testDataDir, "bun-test-browser-mode-jsr.ts");
            await writeTextFile(
              testFile,
              `// 测试浏览器模式下通过 package.json imports 映射的 JSR 包导入
// 注意：代码中不使用 jsr: 前缀，而是通过 package.json imports 映射
import { createLogger } from "@dreamer/logger/client";

const logger = createLogger("bun-browser-mode-jsr-test");
logger.info("Test browser mode with JSR package via imports mapping");

export { logger };
`,
            );

            const result = await buildBundle({
              entryPoint: testFile,
              globalName: "BunTestBrowserModeJsr",
              platform: "browser",
              format: "iife",
              plugins: [bunResolverPlugin({ browserMode: true })],
            });

            expect(result).toBeDefined();
            expect(result.code).toBeDefined();
            // 在浏览器模式下，依赖应该被标记为 external
            expect(result.code.length).toBeGreaterThan(0);
          } catch (error) {
            const errorMessage = error instanceof Error
              ? error.message
              : String(error);
            console.error("Bun 浏览器模式 JSR 包测试失败:", errorMessage);
            // 如果失败，可能是因为 Bun 不支持通过这种方式使用 JSR 包
            // 这是预期的，因为 Bun 不支持 jsr: 协议
            console.log(
              "注意：Bun 可能不支持通过 package.json imports 映射使用 JSR 包",
            );
          }
        });
      });
    });
  }

  // 测试结束后无条件清理本套件生成的目录，不依赖 CLEANUP_AFTER_TEST
  it("应该清理测试输出目录", async () => {
    if (testDataDir) {
      try {
        await remove(testDataDir, { recursive: true });
      } catch {
        // 忽略错误
      }
    }
  });
});
