/**
 * @fileoverview HTMLGenerator 内部方法测试
 */

import { describe, expect, it } from "@dreamer/test";
import {
  join,
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
} from "@dreamer/runtime-adapter";
import { HTMLGenerator } from "../src/html-generator.ts";
import type { HTMLConfig } from "../src/types.ts";
import { getTestDataDir, getTestOutputDir } from "./test-utils.ts";

describe("HTMLGenerator 内部方法", () => {
  let outputDir: string;
  let testDataDir: string;

  // 测试前创建测试目录
  it("应该创建测试目录", async () => {
    testDataDir = getTestDataDir();
    outputDir = getTestOutputDir("html-generator-internal");
    await mkdir(outputDir, { recursive: true });
    expect(testDataDir).toBeTruthy();
  });

  describe("相对路径生成", () => {
    it("应该生成正确的相对路径", async () => {
      const config: HTMLConfig = {
        title: "Test App",
      };
      const generator = new HTMLGenerator(config, outputDir);
      const jsFiles = ["main.js", "chunk-1.js"];
      const cssFiles: string[] = [];

      const htmlPath = await generator.generate(jsFiles, cssFiles);
      const html = await readTextFile(htmlPath);

      // 检查相对路径是否正确
      expect(html).toContain("main.js");
      expect(html).toContain("chunk-1.js");
    });
  });

  describe("预加载标签生成", () => {
    it("应该为 JS 文件生成预加载标签", async () => {
      const config: HTMLConfig = {
        title: "Test App",
        preload: {
          enabled: true,
          strategy: "immediate",
          types: ["js"],
        },
      };
      const generator = new HTMLGenerator(config, outputDir);
      const jsFiles = ["main.js"];
      const cssFiles: string[] = [];

      const htmlPath = await generator.generate(jsFiles, cssFiles);
      const html = await readTextFile(htmlPath);

      expect(html).toContain('rel="preload"');
      expect(html).toContain('as="script"');
      expect(html).toContain("main.js");
    });

    it("应该为 CSS 文件生成预加载标签", async () => {
      const config: HTMLConfig = {
        title: "Test App",
        preload: {
          enabled: true,
          strategy: "immediate",
          types: ["css"],
        },
      };
      const generator = new HTMLGenerator(config, outputDir);
      const jsFiles: string[] = [];
      const cssFiles = ["main.css"];

      const htmlPath = await generator.generate(jsFiles, cssFiles);
      const html = await readTextFile(htmlPath);

      expect(html).toContain('rel="preload"');
      expect(html).toContain('as="style"');
      expect(html).toContain("main.css");
    });
  });

  describe("预加载匹配规则", () => {
    it("应该使用正则表达式匹配", async () => {
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

      // main.js 应该被预加载
      expect(html).toContain("main.js");
    });

    it("应该使用函数匹配", async () => {
      const config: HTMLConfig = {
        title: "Test App",
        preload: {
          enabled: true,
          strategy: "immediate",
          match: (path: string) => path.includes("critical"),
        },
      };
      const generator = new HTMLGenerator(config, outputDir);
      const jsFiles = ["critical.js", "non-critical.js"];
      const cssFiles: string[] = [];

      const htmlPath = await generator.generate(jsFiles, cssFiles);
      const html = await readTextFile(htmlPath);

      expect(html).toContain("critical.js");
    });
  });

  describe("默认模板", () => {
    it("应该在未提供模板时使用默认模板", async () => {
      const config: HTMLConfig = {
        title: "Test App",
      };
      const generator = new HTMLGenerator(config, outputDir);
      const jsFiles = ["main.js"];
      const cssFiles: string[] = [];

      const htmlPath = await generator.generate(jsFiles, cssFiles);
      const html = await readTextFile(htmlPath);

      // 默认模板应该包含基本的 HTML 结构
      expect(html).toContain("<html");
      expect(html).toContain("</html>");
      expect(html).toContain("<head");
      expect(html).toContain("<body");
    });
  });

  // 清理测试输出目录
  it("应该清理测试输出目录", async () => {
    if (outputDir) {
      try {
        await remove(outputDir, { recursive: true });
      } catch {
        // 忽略错误
      }
    }
  });
});
