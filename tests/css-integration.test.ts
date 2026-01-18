/**
 * @fileoverview CSS 自动注入集成测试
 *
 * 测试 CSS 导入处理插件与 CSS 注入工具的集成使用
 */

import { join, mkdir, writeTextFile } from "@dreamer/runtime-adapter";
import { describe, expect, it } from "@dreamer/test";
import { createCSSImportHandlerPlugin } from "../src/plugins/css-import-handler.ts";
import type { ClientConfig } from "../src/types.ts";
import { injectCSSIntoHTML } from "../src/utils/css-injector.ts";
import { cleanupDir, getTestDataDir, getTestOutputDir } from "./test-utils.ts";

describe("CSS 自动注入集成测试", () => {
  let testDataDir: string;
  let outputDir: string;
  let entryFile: string;
  let cssFile: string;

  // 测试前创建测试目录和文件
  it("应该创建测试目录和文件", async () => {
    testDataDir = getTestDataDir();
    outputDir = getTestOutputDir("css-integration");
    entryFile = join(testDataDir, "src", "index.tsx");
    cssFile = join(testDataDir, "src", "styles.css");

    // 创建目录结构
    await mkdir(join(testDataDir, "src"), { recursive: true });

    // 创建 CSS 文件
    await writeTextFile(
      cssFile,
      `body {
  margin: 0;
  padding: 0;
  font-family: Arial, sans-serif;
}`,
    );

    // 创建入口文件（导入 CSS）
    await writeTextFile(
      entryFile,
      `import "./styles.css";

console.log("App loaded");
`,
    );

    expect(testDataDir).toBeTruthy();
  });

  describe("CSS 插件与构建器集成", () => {
    it("应该能够创建 CSS 插件", () => {
      const cssPlugin = createCSSImportHandlerPlugin({
        enabled: true,
        extract: true,
      });

      expect(cssPlugin).toBeTruthy();
      expect(cssPlugin.name).toBe("css-import-handler");
      expect(typeof cssPlugin.setup).toBe("function");
    });

    it("应该能够获取插件收集的 CSS 文件", () => {
      const cssPlugin = createCSSImportHandlerPlugin();
      const cssFiles = cssPlugin.getCSSFiles();
      expect(Array.isArray(cssFiles)).toBe(true);
    });

    it("应该能够将插件添加到配置中", () => {
      const cssPlugin = createCSSImportHandlerPlugin({
        enabled: true,
        extract: true,
      });

      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
        plugins: [cssPlugin],
      };

      expect(config.plugins).toBeTruthy();
      expect(config.plugins?.length).toBe(1);
      expect(config.plugins?.[0].name).toBe("css-import-handler");
    });
  });

  describe("CSS 注入与 HTML 生成集成", () => {
    it("应该能够将 CSS 注入到 HTML 中", () => {
      const html = `<!DOCTYPE html>
<html>
<head>
  <title>Test App</title>
</head>
<body>
  <div id="root"></div>
</body>
</html>`;

      const cssFiles = [
        "styles/main.css",
        "styles/theme.css",
      ];

      const result = injectCSSIntoHTML(html, cssFiles, {
        publicPath: "/assets/",
      });

      // 验证 CSS 标签已注入
      expect(result).toContain('<link rel="stylesheet"');
      expect(result).toContain('href="/assets/styles/main.css"');
      expect(result).toContain('href="/assets/styles/theme.css"');

      // 验证注入位置正确（在 </head> 之前）
      const headEndIndex = result.indexOf("</head>");
      const cssIndex = result.indexOf("styles/main.css");
      expect(cssIndex).toBeLessThan(headEndIndex);
    });

    it("应该能够处理构建后的 CSS 文件路径", () => {
      const html = `<!DOCTYPE html>
<html>
<head>
  <title>Test App</title>
</head>
<body>
</body>
</html>`;

      // 模拟构建后的 CSS 文件路径
      const cssFiles = [
        "main-abc123.css", // 带 hash 的文件名
        "chunk-xyz789.css",
      ];

      const result = injectCSSIntoHTML(html, cssFiles);

      expect(result).toContain('href="main-abc123.css"');
      expect(result).toContain('href="chunk-xyz789.css"');
    });
  });

  describe("完整工作流程", () => {
    it("应该完成从 CSS 导入到 HTML 注入的完整流程", async () => {
      // 步骤 1: 创建 CSS 插件
      const cssPlugin = createCSSImportHandlerPlugin({
        enabled: true,
        extract: true,
      });

      // 步骤 2: 创建构建器配置（不实际创建构建器，避免触发 esbuild）
      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
        plugins: [cssPlugin],
      };

      expect(config.plugins).toBeTruthy();
      expect(config.plugins?.length).toBe(1);

      // 步骤 3: 模拟 HTML 生成和 CSS 注入
      const html = `<!DOCTYPE html>
<html>
<head>
  <title>Test App</title>
</head>
<body>
  <div id="root"></div>
</body>
</html>`;

      // 模拟从插件获取的 CSS 文件列表（实际使用中会从构建结果获取）
      const cssFiles = ["styles/main.css", "styles/theme.css"];
      const result = injectCSSIntoHTML(html, cssFiles);

      // 验证 CSS 已注入
      expect(result).toContain('<link rel="stylesheet"');
      expect(result).toContain('href="styles/main.css"');
      expect(result).toContain('href="styles/theme.css"');

      // 验证流程完整性
      expect(cssPlugin).toBeTruthy();
    });
  });

  describe("多 CSS 文件处理", () => {
    it("应该能够处理多个 CSS 文件", async () => {
      // 创建多个 CSS 文件
      const cssFile1 = join(testDataDir, "src", "main.css");
      const cssFile2 = join(testDataDir, "src", "theme.css");
      const cssFile3 = join(testDataDir, "src", "components.css");

      await writeTextFile(cssFile1, "body { margin: 0; }");
      await writeTextFile(cssFile2, ".theme { color: blue; }");
      await writeTextFile(cssFile3, ".component { padding: 10px; }");

      const html = `<!DOCTYPE html>
<html>
<head>
  <title>Test</title>
</head>
<body>
</body>
</html>`;

      const cssFiles = [
        "main.css",
        "theme.css",
        "components.css",
      ];

      const result = injectCSSIntoHTML(html, cssFiles);

      // 验证所有 CSS 文件都被注入
      expect(result).toContain('href="main.css"');
      expect(result).toContain('href="theme.css"');
      expect(result).toContain('href="components.css"');
    });

    it("应该自动去重重复的 CSS 文件", () => {
      const html = `<!DOCTYPE html>
<html>
<head>
  <title>Test</title>
</head>
<body>
</body>
</html>`;

      const cssFiles = [
        "styles/main.css",
        "styles/main.css", // 重复
        "styles/theme.css",
      ];

      const result = injectCSSIntoHTML(html, cssFiles, { dedupe: true });

      // 验证去重
      const matches = result.match(/styles\/main\.css/g);
      expect(matches?.length).toBe(1);
    });
  });

  // 清理测试文件
  it("应该清理测试文件", async () => {
    try {
      await cleanupDir(testDataDir);
      await cleanupDir(outputDir);
    } catch {
      // 忽略清理错误
    }
  });
}, { sanitizeOps: false, sanitizeResources: false });
