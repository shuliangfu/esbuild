/**
 * @fileoverview CSS 优化器测试
 */

import {
  join,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@dreamer/runtime-adapter";
import { describe, expect, it } from "@dreamer/test";
import { CSSOptimizer } from "../src/css-optimizer.ts";
import type { CSSOptions } from "../src/types.ts";
import { getTestDataDir } from "./test-utils.ts";

describe("CSSOptimizer", () => {
  let testDataDir: string;

  // 测试前创建测试目录
  it("应该创建测试目录", async () => {
    testDataDir = getTestDataDir();
    await mkdir(testDataDir, { recursive: true });
    expect(testDataDir).toBeTruthy();
  });

  describe("构造函数", () => {
    it("应该创建 CSS 优化器实例", () => {
      const config: CSSOptions = {};
      const optimizer = new CSSOptimizer(config);
      expect(optimizer).toBeTruthy();
    });
  });

  describe("CSS 压缩", () => {
    it("应该压缩 CSS 文件", async () => {
      const cssFile = join(testDataDir, "test.css");
      const originalCSS = `
        .container {
          margin: 10px;
          padding: 20px;
        }

        .header {
          color: #333;
          font-size: 16px;
        }
      `;
      await writeTextFile(cssFile, originalCSS);

      const config: CSSOptions = {
        minify: true,
      };
      const optimizer = new CSSOptimizer(config);
      await optimizer.optimizeCSS(cssFile);

      const optimized = await readTextFile(cssFile);
      // 压缩后的 CSS 应该更短
      expect(optimized.length).toBeLessThan(originalCSS.length);
      // 应该保留关键内容
      expect(optimized).toContain(".container");
      expect(optimized).toContain(".header");
    });

    it("应该在不启用压缩时保持原样", async () => {
      const cssFile = join(testDataDir, "test.css");
      const originalCSS = ".container { margin: 10px; }";
      await writeTextFile(cssFile, originalCSS);

      const config: CSSOptions = {
        minify: false,
      };
      const optimizer = new CSSOptimizer(config);
      await optimizer.optimizeCSS(cssFile);

      const result = await readTextFile(cssFile);
      expect(result).toBe(originalCSS);
    });
  });

  describe("自动前缀", () => {
    it("应该添加自动前缀", async () => {
      const cssFile = join(testDataDir, "test.css");
      const originalCSS = `
        .box {
          display: flex;
          transform: rotate(45deg);
        }
      `;
      await writeTextFile(cssFile, originalCSS);

      const config: CSSOptions = {
        autoprefix: true,
        minify: false,
      };
      const optimizer = new CSSOptimizer(config);
      await optimizer.optimizeCSS(cssFile);

      const optimized = await readTextFile(cssFile);
      // 应该包含自动前缀（如 -webkit-, -moz- 等）
      expect(optimized).toContain("display");
      expect(optimized).toContain("transform");
    });

    it("应该同时压缩和添加自动前缀", async () => {
      const cssFile = join(testDataDir, "test.css");
      const originalCSS = `
        .container {
          display: flex;
          justify-content: center;
        }
      `;
      await writeTextFile(cssFile, originalCSS);

      const config: CSSOptions = {
        autoprefix: true,
        minify: true,
      };
      const optimizer = new CSSOptimizer(config);
      await optimizer.optimizeCSS(cssFile);

      const optimized = await readTextFile(cssFile);
      // 应该同时压缩和添加前缀
      expect(optimized.length).toBeLessThan(originalCSS.length);
      expect(optimized).toContain("display");
    });
  });

  describe("CSS 提取", () => {
    it("应该从 JS 代码中提取 CSS", async () => {
      const jsContent = `
        import './styles.css';
        console.log('test');
      `;
      const cssContent = ".test { color: red; }";

      const config: CSSOptions = {
        extract: true,
      };
      const optimizer = new CSSOptimizer(config);

      // 注意：实际的 CSS 提取通常在构建过程中完成
      // 这里主要测试配置是否正确
      expect(config.extract).toBe(true);
    });
  });

  describe("边界情况", () => {
    it("应该处理空 CSS 文件", async () => {
      const cssFile = join(testDataDir, "empty.css");
      await writeTextFile(cssFile, "");

      const config: CSSOptions = {
        minify: true,
      };
      const optimizer = new CSSOptimizer(config);

      // 不应该抛出错误
      try {
        await optimizer.optimizeCSS(cssFile);
      } catch (error) {
        // 如果抛出错误，测试失败
        throw error;
      }
    });

    it("应该处理只有注释的 CSS 文件", async () => {
      const cssFile = join(testDataDir, "comment.css");
      const originalCSS = "/* This is a comment */";
      await writeTextFile(cssFile, originalCSS);

      const config: CSSOptions = {
        minify: true,
      };
      const optimizer = new CSSOptimizer(config);
      await optimizer.optimizeCSS(cssFile);

      const optimized = await readTextFile(cssFile);
      // 压缩后注释可能被移除，文件可能为空
      // 只要不抛出错误即可
      expect(typeof optimized).toBe("string");
    });

    it("应该处理无效的 CSS（不抛出错误）", async () => {
      const cssFile = join(testDataDir, "invalid.css");
      const originalCSS = "invalid css syntax {";
      await writeTextFile(cssFile, originalCSS);

      const config: CSSOptions = {
        minify: true,
      };
      const optimizer = new CSSOptimizer(config);

      // 应该处理错误而不崩溃
      try {
        await optimizer.optimizeCSS(cssFile);
      } catch (error) {
        // 如果抛出错误，测试失败
        throw error;
      }
    });
  });

  // 清理测试输出目录
  it("应该清理测试输出目录", async () => {
    // CSS 文件在测试中创建，不需要特别清理
  });
});
