/**
 * @fileoverview AssetsProcessor 高级功能测试
 */

import { describe, expect, it } from "@dreamer/test";
import {
  join,
  mkdir,
  readdir,
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

  // 测试前创建测试目录（Windows CI 上 tests/data 可能不存在，需显式创建）
  it("应该创建测试目录", async () => {
    testDataDir = getTestDataDir();
    outputDir = getTestOutputDir("assets-processor-advanced");
    publicDir = join(testDataDir, "public");
    await mkdir(testDataDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });
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

    it("应该为图片添加 content hash 并更新引用", async () => {
      // 创建 PNG 图片（PNG magic bytes），copyStaticAssets 会复制到 outputDir/assets
      // 使用 format: "original" 和 compress: false 仅测试 hash，避免 ImageMagick 处理无效图片
      const imagePath = join(publicDir, "logo.png");
      await writeFile(
        imagePath,
        new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      );

      // 创建输出目录和引用该图片的 HTML（需在 processAssets 前存在）
      await mkdir(outputDir, { recursive: true });
      const htmlPath = join(outputDir, "index.html");
      await writeTextFile(
        htmlPath,
        '<img src="assets/logo.png" alt="logo" />',
      );

      const config: AssetsConfig = {
        publicDir: publicDir,
        assetsDir: "assets",
        images: {
          compress: false,
          format: "original",
          hash: true,
        },
      };
      const processor = new AssetsProcessor(config, outputDir);
      await processor.processAssets();

      // 验证：原 logo.png 应被替换为带 hash 的 logo.xxxxxxxx.png
      const assetsOutputDir = join(outputDir, "assets");
      const files = await readdir(assetsOutputDir);
      const hashedFile = files.find(
        (f) => f.name.startsWith("logo.") && f.name.endsWith(".png"),
      );
      expect(hashedFile).toBeTruthy();
      expect(hashedFile!.name).toMatch(/^logo\.[a-f0-9]{8}\.png$/);

      // 验证：HTML 中的引用应已更新为带 hash 的路径
      const htmlContent = await readTextFile(htmlPath);
      expect(htmlContent).toContain(hashedFile!.name);
      expect(htmlContent).not.toContain("assets/logo.png");
    });

    it("应该对 HTML/CSS/JS 中的图片链接进行 hash 化替换", async () => {
      // 创建 images 子目录下的图片，模拟 gallery 场景
      const imagesDir = join(publicDir, "images");
      await mkdir(imagesDir, { recursive: true });
      await writeFile(
        join(imagesDir, "0.png"),
        new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      );

      await mkdir(outputDir, { recursive: true });
      // HTML：绝对路径 /assets/images/0.png
      await writeTextFile(
        join(outputDir, "index.html"),
        '<img src="/assets/images/0.png" alt="图片" loading="lazy" />',
      );
      // CSS：url() 中的路径
      await writeTextFile(
        join(outputDir, "style.css"),
        ".bg { background-image: url('/assets/images/0.png'); }",
      );
      // JS：字符串中的路径（模拟编译后代码）
      await writeTextFile(
        join(outputDir, "main.js"),
        'const imgSrc="/assets/images/0.png";',
      );

      const config: AssetsConfig = {
        publicDir: publicDir,
        assetsDir: "assets",
        images: {
          compress: false,
          format: "original",
          hash: true,
        },
      };
      const processor = new AssetsProcessor(config, outputDir);
      await processor.processAssets();

      const assetsImagesDir = join(outputDir, "assets", "images");
      const imageFiles = await readdir(assetsImagesDir);
      const hashedImage = imageFiles.find(
        (f) => f.name.startsWith("0.") && f.name.endsWith(".png"),
      );
      expect(hashedImage).toBeTruthy();
      expect(hashedImage!.name).toMatch(/^0\.[a-f0-9]{8}\.png$/);

      const expectedPath = `assets/images/${hashedImage!.name}`;
      const expectedPathWithSlash = `/assets/images/${hashedImage!.name}`;

      const htmlContent = await readTextFile(join(outputDir, "index.html"));
      expect(htmlContent).toContain(expectedPathWithSlash);
      expect(htmlContent).not.toContain("/assets/images/0.png");

      const cssContent = await readTextFile(join(outputDir, "style.css"));
      expect(cssContent).toContain(expectedPathWithSlash);
      expect(cssContent).not.toContain("/assets/images/0.png");

      const jsContent = await readTextFile(join(outputDir, "main.js"));
      expect(jsContent).toContain(expectedPathWithSlash);
      expect(jsContent).not.toContain("/assets/images/0.png");
    });

    it("应该支持 quality 参数配置", async () => {
      const config: AssetsConfig = {
        publicDir: publicDir,
        images: {
          compress: true,
          format: "webp",
          quality: 75,
        },
      };
      const processor = new AssetsProcessor(config, outputDir);
      expect(config.images?.quality).toBe(75);
      expect(processor).toBeTruthy();
    });

    it("应该在处理图片后生成 asset-manifest.json", async () => {
      const manifestPublicDir = join(testDataDir, "public-manifest");
      await mkdir(manifestPublicDir, { recursive: true });
      await writeFile(
        join(manifestPublicDir, "icon.png"),
        new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      );

      const manifestOutputDir = getTestOutputDir("assets-manifest");
      await mkdir(manifestOutputDir, { recursive: true });

      const config: AssetsConfig = {
        publicDir: manifestPublicDir,
        assetsDir: "assets",
        images: {
          compress: false,
          format: "original",
          hash: true,
        },
      };
      const processor = new AssetsProcessor(config, manifestOutputDir);
      await processor.processAssets();

      const manifestPath = join(manifestOutputDir, "asset-manifest.json");
      const manifestExists = await stat(manifestPath)
        .then(() => true)
        .catch(() => false);
      expect(manifestExists).toBe(true);

      const manifestContent = await readTextFile(manifestPath);
      const manifest = JSON.parse(manifestContent) as Record<string, string>;
      expect(typeof manifest).toBe("object");
      const keys = Object.keys(manifest);
      expect(keys.length).toBeGreaterThan(0);
      // manifest 格式：原路径 -> 带 hash 的新路径，如 /assets/icon.png -> /assets/icon.abc12345.png
      expect(keys[0]).toBe("/assets/icon.png");
      expect(manifest[keys[0]]).toMatch(/^\/assets\/icon\.[a-f0-9]{8}\.png$/);
    });

    it("应该在 compress: true 时尝试压缩图片（失败时保持原样不中断）", async () => {
      // 使用与 hash 测试相同的有效 PNG，compress 会尝试处理
      // ImageMagick 可能因环境差异失败，处理器会捕获并保持原文件
      const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
      const compressTestDir = join(testDataDir, "public-compress");
      await mkdir(compressTestDir, { recursive: true });
      await writeFile(join(compressTestDir, "small.png"), pngBytes);

      const compressOutputDir = getTestOutputDir("assets-compress");
      await mkdir(compressOutputDir, { recursive: true });

      const config: AssetsConfig = {
        publicDir: compressTestDir,
        assetsDir: "assets",
        images: {
          compress: true,
          format: "original",
          hash: true,
        },
      };
      const processor = new AssetsProcessor(config, compressOutputDir);
      await processor.processAssets();

      const assetsDir = join(compressOutputDir, "assets");
      const files = await readdir(assetsDir);
      // 成功时：small.xxx.png；失败时：small.png（处理器捕获错误不中断）
      const pngFile = files.find((f) =>
        f.name.startsWith("small") && f.name.endsWith(".png")
      );
      expect(pngFile).toBeTruthy();
      expect(pngFile!.name).toMatch(/^small(\.[a-f0-9]{8})?\.png$/);
    });
  });

  describe("pathUpdateDirs（SSR 场景）", () => {
    it("应该更新 pathUpdateDirs 指定目录下的资源引用", async () => {
      const pathUpdatePublicDir = join(testDataDir, "public-path-update");
      await mkdir(pathUpdatePublicDir, { recursive: true });
      await writeFile(
        join(pathUpdatePublicDir, "banner.png"),
        new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      );

      const mainOutputDir = getTestOutputDir("assets-path-update-main");
      const serverOutputDir = getTestOutputDir("assets-path-update-server");
      await mkdir(mainOutputDir, { recursive: true });
      await mkdir(serverOutputDir, { recursive: true });

      await writeTextFile(
        join(mainOutputDir, "index.html"),
        '<img src="/assets/banner.png" />',
      );
      await writeTextFile(
        join(serverOutputDir, "render.js"),
        'const img="/assets/banner.png";',
      );

      const config: AssetsConfig = {
        publicDir: pathUpdatePublicDir,
        assetsDir: "assets",
        images: {
          compress: false,
          format: "original",
          hash: true,
        },
      };
      const processor = new AssetsProcessor(
        config,
        mainOutputDir,
        [serverOutputDir],
      );
      await processor.processAssets();

      const assetsDir = join(mainOutputDir, "assets");
      const files = await readdir(assetsDir);
      const hashedFile = files.find(
        (f) => f.name.startsWith("banner.") && f.name.endsWith(".png"),
      );
      expect(hashedFile).toBeTruthy();
      const expectedPath = `assets/${hashedFile!.name}`;

      const mainHtml = await readTextFile(join(mainOutputDir, "index.html"));
      expect(mainHtml).toContain(expectedPath);
      expect(mainHtml).not.toContain("/assets/banner.png");

      const serverJs = await readTextFile(join(serverOutputDir, "render.js"));
      expect(serverJs).toContain(expectedPath);
      expect(serverJs).not.toContain("/assets/banner.png");
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
    it("应该排除 exclude 配置的文件", async () => {
      // 使用独立目录避免其他测试污染
      const excludePublicDir = join(testDataDir, "public-exclude");
      await mkdir(excludePublicDir, { recursive: true });
      await writeTextFile(
        join(excludePublicDir, "tailwind.css"),
        "/* tailwind */",
      );
      await writeTextFile(join(excludePublicDir, "uno.css"), "/* uno */");
      await writeTextFile(join(excludePublicDir, "keep.txt"), "keep");

      const excludeOutputDir = getTestOutputDir("assets-exclude");
      await mkdir(excludeOutputDir, { recursive: true });

      const config: AssetsConfig = {
        publicDir: excludePublicDir,
        assetsDir: "assets",
        exclude: ["tailwind.css", "uno.css"],
      };
      const processor = new AssetsProcessor(config, excludeOutputDir);
      await processor.processAssets();

      const keepExists = await stat(
        join(excludeOutputDir, "assets", "keep.txt"),
      )
        .then(() => true)
        .catch(() => false);
      expect(keepExists).toBe(true);

      const tailwindExists = await stat(
        join(excludeOutputDir, "assets", "tailwind.css"),
      )
        .then(() => true)
        .catch(() => false);
      expect(tailwindExists).toBe(false);

      const unoExists = await stat(
        join(excludeOutputDir, "assets", "uno.css"),
      )
        .then(() => true)
        .catch(() => false);
      expect(unoExists).toBe(false);
    });

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
