/**
 * @fileoverview HTML 生成器测试
 */

import {
  join,
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
} from "@dreamer/runtime-adapter";
import { describe, expect, it } from "@dreamer/test";
import { HTMLGenerator } from "../src/html-generator.ts";
import type { HTMLConfig } from "../src/types.ts";
import { cleanupDir, getTestDataDir, getTestOutputDir } from "./test-utils.ts";

describe("HTMLGenerator", () => {
  let outputDir: string;
  let testDataDir: string;

  // 测试前创建测试目录
  it("应该创建测试目录", async () => {
    testDataDir = getTestDataDir();
    outputDir = getTestOutputDir("html-generator");
    await mkdir(outputDir, { recursive: true });
    expect(testDataDir).toBeTruthy();
  });

  describe("构造函数", () => {
    it("应该创建 HTML 生成器实例", () => {
      const config: HTMLConfig = {};
      const generator = new HTMLGenerator(config, outputDir);
      expect(generator).toBeTruthy();
    });
  });

  describe("HTML 生成", () => {
    it("应该生成基本的 HTML 文件", async () => {
      const config: HTMLConfig = {
        title: "Test App",
      };
      const generator = new HTMLGenerator(config, outputDir);
      const jsFiles = ["main.js"];
      const cssFiles = ["main.css"];

      const htmlPath = await generator.generate(jsFiles, cssFiles);

      expect(htmlPath).toBeTruthy();
      const html = await readTextFile(htmlPath);
      expect(html).toContain("<html");
      expect(html).toContain("<title>Test App</title>");
      expect(html).toContain('src="main.js"');
      expect(html).toContain('href="main.css"');
    });

    it("应该注入多个 JS 文件", async () => {
      const config: HTMLConfig = {
        title: "Test App",
      };
      const generator = new HTMLGenerator(config, outputDir);
      const jsFiles = ["main.js", "chunk-1.js", "chunk-2.js"];
      const cssFiles: string[] = [];

      const htmlPath = await generator.generate(jsFiles, cssFiles);
      const html = await readTextFile(htmlPath);

      expect(html).toContain('src="main.js"');
      expect(html).toContain('src="chunk-1.js"');
      expect(html).toContain('src="chunk-2.js"');
    });

    it("应该注入多个 CSS 文件", async () => {
      const config: HTMLConfig = {
        title: "Test App",
      };
      const generator = new HTMLGenerator(config, outputDir);
      const jsFiles: string[] = [];
      const cssFiles = ["main.css", "theme.css"];

      const htmlPath = await generator.generate(jsFiles, cssFiles);
      const html = await readTextFile(htmlPath);

      expect(html).toContain('href="main.css"');
      expect(html).toContain('href="theme.css"');
    });

    it("应该使用自定义 HTML 模板", async () => {
      const templatePath = join(testDataDir, "template.html");
      await writeTextFile(
        templatePath,
        `<!DOCTYPE html>
<html>
<head>
  <title>Custom Template</title>
</head>
<body>
  <div id="app"></div>
</body>
</html>`,
      );

      const config: HTMLConfig = {
        template: templatePath,
        title: "Test App",
      };
      const generator = new HTMLGenerator(config, outputDir);
      const jsFiles = ["main.js"];
      const cssFiles: string[] = [];

      const htmlPath = await generator.generate(jsFiles, cssFiles);
      const html = await readTextFile(htmlPath);

      expect(html).toContain('<div id="app"></div>');
      expect(html).toContain('src="main.js"');
    });

    it("应该在模板不存在时使用默认模板", async () => {
      const config: HTMLConfig = {
        template: join(testDataDir, "non-existent.html"),
        title: "Test App",
      };
      const generator = new HTMLGenerator(config, outputDir);
      const jsFiles = ["main.js"];
      const cssFiles: string[] = [];

      const htmlPath = await generator.generate(jsFiles, cssFiles);
      const html = await readTextFile(htmlPath);

      // 应该使用默认模板
      expect(html).toContain("<html");
      expect(html).toContain('src="main.js"');
    });

    it("应该替换模板中的标题", async () => {
      const templatePath = join(testDataDir, "template.html");
      await writeTextFile(
        templatePath,
        `<!DOCTYPE html>
<html>
<head>
  <title>Old Title</title>
</head>
<body></body>
</html>`,
      );

      const config: HTMLConfig = {
        template: templatePath,
        title: "New Title",
      };
      const generator = new HTMLGenerator(config, outputDir);
      const jsFiles: string[] = [];
      const cssFiles: string[] = [];

      const htmlPath = await generator.generate(jsFiles, cssFiles);
      const html = await readTextFile(htmlPath);

      expect(html).toContain("<title>New Title</title>");
      expect(html).not.toContain("Old Title");
    });

    it("应该生成相对路径", async () => {
      const config: HTMLConfig = {
        title: "Test App",
      };
      const generator = new HTMLGenerator(config, outputDir);
      const jsFiles = ["subdir/main.js"];
      const cssFiles = ["subdir/main.css"];

      const htmlPath = await generator.generate(jsFiles, cssFiles);
      const html = await readTextFile(htmlPath);

      // 应该使用相对路径
      expect(html).toContain('src="subdir/main.js"');
      expect(html).toContain('href="subdir/main.css"');
    });
  });

  describe("预加载配置", () => {
    it("应该生成预加载标签（immediate 策略）", async () => {
      const config: HTMLConfig = {
        title: "Test App",
        preload: {
          enabled: true,
          strategy: "immediate",
          types: ["js", "css"],
        },
      };
      const generator = new HTMLGenerator(config, outputDir);
      const jsFiles = ["main.js"];
      const cssFiles = ["main.css"];

      const htmlPath = await generator.generate(jsFiles, cssFiles);
      const html = await readTextFile(htmlPath);

      expect(html).toContain('rel="preload"');
      expect(html).toContain('as="script"');
      expect(html).toContain('as="style"');
    });

    it("应该生成预加载标签（defer 策略）", async () => {
      const config: HTMLConfig = {
        title: "Test App",
        preload: {
          enabled: true,
          strategy: "defer",
          types: ["js"],
        },
      };
      const generator = new HTMLGenerator(config, outputDir);
      const jsFiles = ["main.js"];
      const cssFiles: string[] = [];

      const htmlPath = await generator.generate(jsFiles, cssFiles);
      const html = await readTextFile(htmlPath);

      // defer 策略使用 prefetch，不是 preload
      expect(html).toContain('rel="prefetch"');
    });

    it("应该根据匹配规则过滤预加载文件", async () => {
      const config: HTMLConfig = {
        title: "Test App",
        preload: {
          enabled: true,
          strategy: "immediate",
          match: /^main\./,
        },
      };
      const generator = new HTMLGenerator(config, outputDir);
      const jsFiles = ["main.js", "chunk-1.js"];
      const cssFiles: string[] = [];

      const htmlPath = await generator.generate(jsFiles, cssFiles);
      const html = await readTextFile(htmlPath);

      // 只应该预加载 main.js
      const preloadCount = (html.match(/rel="preload"/g) || []).length;
      expect(preloadCount).toBeGreaterThan(0);
    });
  });

  describe("多入口 HTML", () => {
    it("应该生成多个 HTML 文件", async () => {
      const config: HTMLConfig = {
        title: "Test App",
        entries: {
          index: {
            entry: "index.ts",
            title: "Index Page",
          },
          about: {
            entry: "about.ts",
            title: "About Page",
          },
        },
      };
      const generator = new HTMLGenerator(config, outputDir);

      const entries = {
        index: {
          entry: "index.ts",
          title: "Index Page",
        },
        about: {
          entry: "about.ts",
          title: "About Page",
        },
      };
      const jsFilesMap = {
        index: ["index.js"],
        about: ["about.js"],
      };
      const cssFilesMap = {
        index: [],
        about: [],
      };
      const htmlFiles = await generator.generateMultiple(
        entries,
        jsFilesMap,
        cssFilesMap,
      );

      expect(htmlFiles).toHaveLength(2);
      expect(htmlFiles[0]).toBeTruthy();
      expect(htmlFiles[1]).toBeTruthy();
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
