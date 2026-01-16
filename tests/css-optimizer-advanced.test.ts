/**
 * @fileoverview CSSOptimizer 高级功能测试
 */

import { describe, expect, it } from "@dreamer/test";
import {
  join,
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
} from "@dreamer/runtime-adapter";
import { CSSOptimizer } from "../src/css-optimizer.ts";
import type { CSSOptions } from "../src/types.ts";
import { getTestDataDir, getTestOutputDir } from "./test-utils.ts";

describe("CSSOptimizer 高级功能", () => {
  let testDataDir: string;

  // 测试前创建测试目录
  it("应该创建测试目录", async () => {
    testDataDir = getTestDataDir();
    await mkdir(testDataDir, { recursive: true });
    expect(testDataDir).toBeTruthy();
  });

  describe("PostCSS 处理", () => {
    it("应该使用 PostCSS 处理 CSS", async () => {
      const cssFile = join(testDataDir, "test.css");
      const originalCSS = `
        .container {
          display: flex;
          transform: rotate(45deg);
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
      expect(optimized).toBeTruthy();
      expect(optimized.length).toBeLessThanOrEqual(originalCSS.length);
    });

    it("应该只使用 autoprefixer", async () => {
      const cssFile = join(testDataDir, "test-autoprefix.css");
      const originalCSS = `
        .box {
          display: flex;
          user-select: none;
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
      expect(optimized).toContain("display");
    });

    it("应该只使用 cssnano 压缩", async () => {
      const cssFile = join(testDataDir, "test-minify.css");
      const originalCSS = `
        .container {
          margin: 10px;
          padding: 20px;
        }
      `;
      await writeTextFile(cssFile, originalCSS);

      const config: CSSOptions = {
        autoprefix: false,
        minify: true,
      };
      const optimizer = new CSSOptimizer(config);
      await optimizer.optimizeCSS(cssFile);

      const optimized = await readTextFile(cssFile);
      expect(optimized.length).toBeLessThan(originalCSS.length);
    });
  });

  describe("复杂 CSS 处理", () => {
    it("应该处理嵌套选择器", async () => {
      const cssFile = join(testDataDir, "nested.css");
      const originalCSS = `
        .parent {
          color: red;
        }
        .parent .child {
          color: blue;
        }
      `;
      await writeTextFile(cssFile, originalCSS);

      const config: CSSOptions = {
        minify: true,
      };
      const optimizer = new CSSOptimizer(config);
      await optimizer.optimizeCSS(cssFile);

      const optimized = await readTextFile(cssFile);
      expect(optimized).toContain(".parent");
    });

    it("应该处理媒体查询", async () => {
      const cssFile = join(testDataDir, "media.css");
      const originalCSS = `
        @media (max-width: 768px) {
          .container {
            width: 100%;
          }
        }
      `;
      await writeTextFile(cssFile, originalCSS);

      const config: CSSOptions = {
        minify: true,
      };
      const optimizer = new CSSOptimizer(config);
      await optimizer.optimizeCSS(cssFile);

      const optimized = await readTextFile(cssFile);
      expect(optimized).toContain("@media");
    });
  });

  // 清理测试输出目录
  it("应该清理测试输出目录", async () => {
    // CSS 文件在测试中创建，不需要特别清理
  });
});
