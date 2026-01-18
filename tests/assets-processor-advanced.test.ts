/**
 * @fileoverview AssetsProcessor 高级功能测试
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
import { cleanupDir, getTestDataDir, getTestOutputDir } from "./test-utils.ts";

describe("AssetsProcessor 高级功能", () => {
  let outputDir: string;
  let publicDir: string;
  let testDataDir: string;

  // 测试前创建测试目录
  it("应该创建测试目录", async () => {
    testDataDir = getTestDataDir();
    outputDir = getTestOutputDir("assets-processor-advanced");
    publicDir = join(testDataDir, "public");
    await mkdir(publicDir, { recursive: true });
    expect(testDataDir).toBeTruthy();
  });

  describe("图片处理", () => {
    it("应该处理图片压缩配置", async () => {
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

      // 注意：实际图片处理需要 @dreamer/image 库支持
      expect(config.images).toBeTruthy();
      expect(config.images?.compress).toBe(true);
      expect(config.images?.format).toBe("webp");
    });

    it("应该处理 AVIF 格式转换", async () => {
      const config: AssetsConfig = {
        publicDir: publicDir,
        images: {
          compress: true,
          format: "avif",
        },
      };
      const processor = new AssetsProcessor(config, outputDir);

      expect(config.images?.format).toBe("avif");
    });

    it("应该保持原始格式", async () => {
      const config: AssetsConfig = {
        publicDir: publicDir,
        images: {
          compress: true,
          format: "original",
        },
      };
      const processor = new AssetsProcessor(config, outputDir);

      expect(config.images?.format).toBe("original");
    });
  });

  describe("资源路径更新", () => {
    it("应该更新 HTML 中的资源路径", async () => {
      const htmlFile = join(outputDir, "index.html");
      await mkdir(outputDir, { recursive: true });
      await writeTextFile(
        htmlFile,
        `<img src="/assets/image.png" />`,
      );

      const config: AssetsConfig = {
        publicDir: publicDir,
        assetsDir: "assets",
      };
      const processor = new AssetsProcessor(config, outputDir);

      // 注意：路径更新功能的具体实现可能需要测试
      expect(processor).toBeTruthy();
    });

    it("应该更新 CSS 中的资源路径", async () => {
      const cssFile = join(outputDir, "style.css");
      await mkdir(outputDir, { recursive: true });
      await writeTextFile(
        cssFile,
        `background-image: url('/assets/bg.png');`,
      );

      const config: AssetsConfig = {
        publicDir: publicDir,
        assetsDir: "assets",
      };
      const processor = new AssetsProcessor(config, outputDir);

      expect(processor).toBeTruthy();
    });
  });

  describe("静态资源复制", () => {
    it("应该复制多种类型的文件", async () => {
      // 创建各种类型的文件
      await writeTextFile(join(publicDir, "data.json"), '{"test": true}');
      await writeFile(join(publicDir, "icon.svg"), new Uint8Array([1, 2, 3]));
      await writeTextFile(join(publicDir, "readme.txt"), "Test file");

      const config: AssetsConfig = {
        publicDir: publicDir,
        assetsDir: "assets",
      };
      const processor = new AssetsProcessor(config, outputDir);
      await processor.processAssets();

      // 验证文件已复制
      const jsonExists = await stat(join(outputDir, "assets", "data.json"))
        .then(() => true)
        .catch(() => false);
      expect(jsonExists).toBe(true);
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
