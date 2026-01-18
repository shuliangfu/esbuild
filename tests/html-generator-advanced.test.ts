/**
 * @fileoverview HTMLGenerator 高级功能测试
 */

import { mkdir, readTextFile} from "@dreamer/runtime-adapter";
import { describe, expect, it } from "@dreamer/test";
import { HTMLGenerator } from "../src/html-generator.ts";
import type { HTMLConfig } from "../src/types.ts";
import { cleanupDir, getTestDataDir, getTestOutputDir } from "./test-utils.ts";

describe("HTMLGenerator 高级功能", () => {
  let outputDir: string;
  let testDataDir: string;

  // 测试前创建测试目录
  it("应该创建测试目录", async () => {
    testDataDir = getTestDataDir();
    outputDir = getTestOutputDir("html-generator-advanced");
    await mkdir(outputDir, { recursive: true });
    expect(testDataDir).toBeTruthy();
  });

  describe("预加载策略", () => {
    it("应该支持 immediate 预加载策略", async () => {
      const config: HTMLConfig = {
        title: "Test App",
        preload: {
          enabled: true,
          strategy: "immediate",
          types: ["js", "css"],
        },
      };
      const generator = new HTMLGenerator(config, outputDir);
      const jsFiles = ["main.js", "chunk-1.js"];
      const cssFiles = ["main.css"];

      const htmlPath = await generator.generate(jsFiles, cssFiles);
      const html = await readTextFile(htmlPath);

      expect(html).toContain('rel="preload"');
      expect(html).toContain('as="script"');
      expect(html).toContain('as="style"');
    });

    it("应该支持 defer 预加载策略", async () => {
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

    it("应该支持 async 预加载策略", async () => {
      const config: HTMLConfig = {
        title: "Test App",
        preload: {
          enabled: true,
          strategy: "async",
          types: ["js"],
        },
      };
      const generator = new HTMLGenerator(config, outputDir);
      const jsFiles = ["main.js"];
      const cssFiles: string[] = [];

      const htmlPath = await generator.generate(jsFiles, cssFiles);
      const html = await readTextFile(htmlPath);

      expect(html).toContain('rel="preload"');
    });
  });

  describe("预加载匹配规则", () => {
    it("应该支持正则表达式匹配", async () => {
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

    it("应该支持函数匹配", async () => {
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

  describe("多入口 HTML", () => {
    it("应该为每个入口生成独立的 HTML", async () => {
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
          contact: {
            entry: "contact.ts",
            title: "Contact Page",
          },
        },
      };
      const generator = new HTMLGenerator(config, outputDir);

      const entries = config.entries!;
      const jsFilesMap = {
        index: ["index.js"],
        about: ["about.js"],
        contact: ["contact.js"],
      };
      const cssFilesMap = {
        index: [],
        about: [],
        contact: [],
      };

      const htmlFiles = await generator.generateMultiple(
        entries,
        jsFilesMap,
        cssFilesMap,
      );

      expect(htmlFiles).toHaveLength(3);
      expect(htmlFiles[0]).toBeTruthy();
      expect(htmlFiles[1]).toBeTruthy();
      expect(htmlFiles[2]).toBeTruthy();
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
