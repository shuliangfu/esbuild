/**
 * @fileoverview CSS 注入工具测试
 */

import { describe, expect, it } from "@dreamer/test";
import {
  type CSSFileInfo,
  type CSSInjectOptions,
  generateCSSTag,
  generateCSSTags,
  getCSSRelativePath,
  injectCSSFromDependencies,
  injectCSSIntoHTML,
} from "../src/utils/css-injector.ts";

describe("CSSInjector", () => {
  describe("generateCSSTag", () => {
    it("应该生成基本的 CSS 标签", () => {
      const tag = generateCSSTag("styles/main.css");
      expect(tag).toContain('<link rel="stylesheet"');
      expect(tag).toContain('href="styles/main.css"');
    });

    it("应该支持 CSSFileInfo 对象", () => {
      const cssFile: CSSFileInfo = {
        path: "styles/main.css",
        external: false,
      };
      const tag = generateCSSTag(cssFile);
      expect(tag).toContain('href="styles/main.css"');
    });

    it("应该支持自定义属性", () => {
      const cssFile: CSSFileInfo = {
        path: "styles/main.css",
        attributes: {
          media: "screen",
          crossorigin: "anonymous",
        },
      };
      const tag = generateCSSTag(cssFile);
      expect(tag).toContain('media="screen"');
      expect(tag).toContain('crossorigin="anonymous"');
    });

    it("应该支持 publicPath 选项", () => {
      const options: CSSInjectOptions = {
        publicPath: "/assets/",
      };
      const tag = generateCSSTag("styles/main.css", options);
      expect(tag).toContain('href="/assets/styles/main.css"');
    });

    it("不应该修改 http:// 开头的路径", () => {
      const tag = generateCSSTag("http://example.com/style.css", {
        publicPath: "/assets/",
      });
      expect(tag).toContain('href="http://example.com/style.css"');
    });

    it("不应该修改 https:// 开头的路径", () => {
      const tag = generateCSSTag("https://example.com/style.css", {
        publicPath: "/assets/",
      });
      expect(tag).toContain('href="https://example.com/style.css"');
    });
  });

  describe("generateCSSTags", () => {
    it("应该生成多个 CSS 标签", () => {
      const cssFiles = ["styles/main.css", "styles/theme.css"];
      const tags = generateCSSTags(cssFiles);
      expect(tags).toContain('href="styles/main.css"');
      expect(tags).toContain('href="styles/theme.css"');
    });

    it("应该支持混合字符串和对象", () => {
      const cssFiles: (string | CSSFileInfo)[] = [
        "styles/main.css",
        { path: "styles/theme.css", external: true },
      ];
      const tags = generateCSSTags(cssFiles);
      expect(tags).toContain('href="styles/main.css"');
      expect(tags).toContain('href="styles/theme.css"');
    });

    it("应该自动去重（默认）", () => {
      const cssFiles = [
        "styles/main.css",
        "styles/main.css", // 重复
        "styles/theme.css",
      ];
      const tags = generateCSSTags(cssFiles, { dedupe: true });
      const matches = tags.match(/styles\/main\.css/g);
      expect(matches?.length).toBe(1); // 应该只有一个
    });

    it("应该支持禁用去重", () => {
      const cssFiles = [
        "styles/main.css",
        "styles/main.css", // 重复
      ];
      const tags = generateCSSTags(cssFiles, { dedupe: false });
      const matches = tags.match(/styles\/main\.css/g);
      expect(matches?.length).toBe(2); // 应该有两个
    });

    it("应该用换行分隔多个标签", () => {
      const cssFiles = ["styles/main.css", "styles/theme.css"];
      const tags = generateCSSTags(cssFiles);
      expect(tags.split("\n").length).toBeGreaterThan(1);
    });
  });

  describe("injectCSSIntoHTML", () => {
    it("应该将 CSS 标签注入到 HTML 的 head 中", () => {
      const html = `<!DOCTYPE html>
<html>
<head>
  <title>Test</title>
</head>
<body>
  <div>Content</div>
</body>
</html>`;

      const cssFiles = ["styles/main.css"];
      const result = injectCSSIntoHTML(html, cssFiles);

      expect(result).toContain('<link rel="stylesheet"');
      expect(result).toContain('href="styles/main.css"');
      expect(result.indexOf("</head>")).toBeGreaterThan(
        result.indexOf("styles/main.css"),
      );
    });

    it("应该处理多个 CSS 文件", () => {
      const html = `<!DOCTYPE html>
<html>
<head>
  <title>Test</title>
</head>
<body>
</body>
</html>`;

      const cssFiles = ["styles/main.css", "styles/theme.css"];
      const result = injectCSSIntoHTML(html, cssFiles);

      expect(result).toContain('href="styles/main.css"');
      expect(result).toContain('href="styles/theme.css"');
    });

    it("应该在空 CSS 列表时返回原 HTML", () => {
      const html = "<html><head></head><body></body></html>";
      const result = injectCSSIntoHTML(html, []);
      expect(result).toBe(html);
    });

    it("应该支持 publicPath 选项", () => {
      const html = `<!DOCTYPE html>
<html>
<head>
  <title>Test</title>
</head>
<body>
</body>
</html>`;

      const cssFiles = ["styles/main.css"];
      const result = injectCSSIntoHTML(html, cssFiles, {
        publicPath: "/assets/",
      });

      expect(result).toContain('href="/assets/styles/main.css"');
    });

    it("应该在没有 </head> 时尝试在 <head> 后注入", () => {
      const html = `<!DOCTYPE html>
<html>
<head>
  <title>Test</title>
<body>
</body>
</html>`;

      const cssFiles = ["styles/main.css"];
      const result = injectCSSIntoHTML(html, cssFiles);

      expect(result).toContain('<link rel="stylesheet"');
    });
  });

  describe("injectCSSFromDependencies", () => {
    it("应该从组件依赖中提取 CSS 并注入", async () => {
      const html = `<!DOCTYPE html>
<html>
<head>
  <title>Test</title>
</head>
<body>
</body>
</html>`;

      const dependencies = {
        styles: [
          { path: "styles/main.css", external: false },
          { path: "styles/theme.css", external: true },
        ],
      };

      const result = await injectCSSFromDependencies(html, dependencies);

      expect(result).toContain('href="styles/main.css"');
      expect(result).toContain('href="styles/theme.css"');
    });

    it("应该处理空的依赖列表", async () => {
      const html = "<html><head></head><body></body></html>";
      const dependencies = { styles: [] };
      const result = await injectCSSFromDependencies(html, dependencies);
      expect(result).toBe(html);
    });

    it("应该支持选项参数", async () => {
      const html = `<!DOCTYPE html>
<html>
<head>
  <title>Test</title>
</head>
<body>
</body>
</html>`;

      const dependencies = {
        styles: [{ path: "styles/main.css", external: false }],
      };

      const result = await injectCSSFromDependencies(html, dependencies, {
        publicPath: "/static/",
      });

      expect(result).toContain('href="/static/styles/main.css"');
    });
  });

  describe("getCSSRelativePath", () => {
    it("应该返回相对路径", async () => {
      // 注意：这个函数需要真实的文件系统路径
      // 在测试中，我们主要测试函数不会抛出错误
      const result = await getCSSRelativePath("styles/main.css", "./dist");
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("应该在路径解析失败时返回原始路径", async () => {
      const result = await getCSSRelativePath(
        "invalid/path.css",
        "./dist",
      );
      expect(result).toBe("invalid/path.css");
    });

    it("应该处理相对路径", async () => {
      const result = await getCSSRelativePath("./styles/main.css", "./dist");
      expect(typeof result).toBe("string");
    });
  });

  describe("边界情况", () => {
    it("应该处理空字符串路径", () => {
      const tag = generateCSSTag("");
      expect(tag).toContain('href=""');
    });

    it("应该处理特殊字符", () => {
      const tag = generateCSSTag("styles/main-v2.0.css");
      expect(tag).toContain("main-v2.0.css");
    });

    it("应该处理绝对路径", () => {
      const tag = generateCSSTag("/absolute/path/style.css");
      expect(tag).toContain('href="/absolute/path/style.css"');
    });

    it("应该处理没有 head 标签的 HTML", () => {
      const html = "<html><body></body></html>";
      const cssFiles = ["styles/main.css"];
      const result = injectCSSIntoHTML(html, cssFiles);
      // 应该不会抛出错误
      expect(typeof result).toBe("string");
    });

    it("应该处理没有 body 标签的 HTML", () => {
      const html = "<html><head></head></html>";
      const cssFiles = ["styles/main.css"];
      const result = injectCSSIntoHTML(html, cssFiles);
      expect(result).toContain('<link rel="stylesheet"');
    });
  });

  // 清理测试数据
  it("应该清理测试数据", async () => {
    const { cleanupTestData } = await import("./test-utils.ts");
    await cleanupTestData();
  });
});
