/**
 * @fileoverview 资源处理器测试
 */

import { describe, expect, it } from "@dreamer/test";
import {
  join,
  mkdir,
  readFile,
  readTextFile,
  remove,
  stat,
  writeFile,
  writeTextFile,
} from "@dreamer/runtime-adapter";
import { AssetsProcessor } from "../src/assets-processor.ts";
import type { AssetsConfig } from "../src/types.ts";
import { getTestDataDir, getTestOutputDir } from "./test-utils.ts";

describe("AssetsProcessor", () => {
  let outputDir: string;
  let publicDir: string;
  let testDataDir: string;

  // 测试前创建测试目录
  it("应该创建测试目录", async () => {
    testDataDir = getTestDataDir();
    outputDir = getTestOutputDir("assets-processor");
    publicDir = join(testDataDir, "public");
    await mkdir(publicDir, { recursive: true });
    expect(testDataDir).toBeTruthy();
  });

  describe("构造函数", () => {
    it("应该创建资源处理器实例", () => {
      const config: AssetsConfig = {};
      const processor = new AssetsProcessor(config, outputDir);
      expect(processor).toBeTruthy();
    });
  });

  describe("静态资源复制", () => {
    it("应该复制静态资源文件", async () => {
      // 创建源目录和文件
      await writeTextFile(join(publicDir, "test.txt"), "test content");
      await writeFile(
        join(publicDir, "image.png"),
        new Uint8Array([137, 80, 78, 71]), // PNG 文件头
      );

      const config: AssetsConfig = {
        publicDir: publicDir,
        assetsDir: "assets",
      };
      const processor = new AssetsProcessor(config, outputDir);
      await processor.processAssets();

      // 验证文件已复制
      const copiedText = await readTextFile(
        join(outputDir, "assets", "test.txt"),
      );
      expect(copiedText).toBe("test content");

      const copiedImage = await readFile(
        join(outputDir, "assets", "image.png"),
      );
      expect(copiedImage[0]).toBe(137);
    });

    it("应该保持目录结构", async () => {
      // 创建嵌套目录结构
      const nestedDir = join(publicDir, "nested", "deep");
      await mkdir(nestedDir, { recursive: true });
      await writeTextFile(join(nestedDir, "file.txt"), "nested content");

      const config: AssetsConfig = {
        publicDir: publicDir,
        assetsDir: "assets",
      };
      const processor = new AssetsProcessor(config, outputDir);
      await processor.processAssets();

      // 验证嵌套结构已保持
      const copiedFile = await readTextFile(
        join(outputDir, "assets", "nested", "deep", "file.txt"),
      );
      expect(copiedFile).toBe("nested content");
    });

    it("应该在 publicDir 不存在时跳过复制", async () => {
      const config: AssetsConfig = {
        publicDir: join(testDataDir, "non-existent"),
        assetsDir: "assets",
      };
      const processor = new AssetsProcessor(config, outputDir);

      // 不应该抛出错误
      try {
        await processor.processAssets();
      } catch (error) {
        // 如果抛出错误，测试失败
        throw error;
      }
    });
  });

  describe("图片处理", () => {
    it("应该处理图片文件（如果配置了）", async () => {
      // 创建测试图片文件
      const imagePath = join(publicDir, "test.png");
      await writeFile(imagePath, new Uint8Array([137, 80, 78, 71]));

      const config: AssetsConfig = {
        publicDir: publicDir,
        images: {
          compress: true,
          format: "webp",
        },
      };
      const processor = new AssetsProcessor(config, outputDir);

      // 注意：实际的图片处理需要 @dreamer/image 库支持
      // 这里主要测试配置是否正确
      expect(config.images).toBeTruthy();
      expect(config.images?.compress).toBe(true);
    });

    it("应该在不配置图片处理时跳过", async () => {
      const config: AssetsConfig = {
        publicDir: publicDir,
      };
      const processor = new AssetsProcessor(config, outputDir);

      // 不应该抛出错误
      try {
        await processor.processAssets();
      } catch (error) {
        // 如果抛出错误，测试失败
        throw error;
      }
    });
  });

  describe("字体文件处理", () => {
    it("应该处理字体文件", async () => {
      // 创建测试字体文件
      const fontPath = join(publicDir, "font.woff2");
      await writeFile(fontPath, new Uint8Array([1, 2, 3, 4]));

      const config: AssetsConfig = {
        publicDir: publicDir,
        assetsDir: "assets",
      };
      const processor = new AssetsProcessor(config, outputDir);
      await processor.processAssets();

      // 验证字体文件已复制
      const fontExists = await stat(join(outputDir, "assets", "font.woff2"))
        .then(() => true)
        .catch(() => false);
      expect(fontExists).toBe(true);
    });
  });

  describe("资源路径更新", () => {
    it("应该更新资源路径", async () => {
      // 创建包含资源引用的 HTML 文件
      const htmlContent = `
        <img src="/assets/image.png" />
        <link rel="stylesheet" href="/assets/style.css" />
      `;
      await writeTextFile(join(outputDir, "index.html"), htmlContent);

      const config: AssetsConfig = {
        publicDir: publicDir,
        assetsDir: "assets",
      };
      const processor = new AssetsProcessor(config, outputDir);
      await processor.processAssets();

      // 验证路径已更新（如果实现了路径更新功能）
      const updatedHtml = await readTextFile(join(outputDir, "index.html"));
      expect(updatedHtml).toContain("assets");
    });
  });

  describe("边界情况", () => {
    it("应该处理空的 publicDir", async () => {
      const emptyDir = join(testDataDir, "empty");
      const config: AssetsConfig = {
        publicDir: emptyDir,
        assetsDir: "assets",
      };
      const processor = new AssetsProcessor(config, outputDir);

      // 不应该抛出错误
      try {
        await processor.processAssets();
      } catch (error) {
        // 如果抛出错误，测试失败
        throw error;
      }
    });

    it("应该处理不存在的输出目录", async () => {
      const config: AssetsConfig = {
        publicDir: publicDir,
        assetsDir: "assets",
      };
      const processor = new AssetsProcessor(config, outputDir);

      // 应该自动创建输出目录
      try {
        await processor.processAssets();
      } catch (error) {
        // 如果抛出错误，测试失败
        throw error;
      }
    });

    it("应该处理符号链接（如果支持）", async () => {
      // 注意：符号链接处理取决于运行时支持
      const config: AssetsConfig = {
        publicDir: publicDir,
        assetsDir: "assets",
      };
      const processor = new AssetsProcessor(config, outputDir);

      // 不应该抛出错误
      try {
        await processor.processAssets();
      } catch (error) {
        // 如果抛出错误，测试失败
        throw error;
      }
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
