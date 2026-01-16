/**
 * @module @dreamer/esbuild/assets-processor
 *
 * 静态资源处理器
 *
 * 负责处理静态资源：复制、图片处理、字体处理、资源路径更新等
 */

import { compress, convert } from "@dreamer/image";
import {
  copyFile,
  join,
  mkdir,
  readdir,
  readFile,
  readTextFile,
  relative,
  remove,
  resolve,
  stat,
  writeFile,
  writeTextFile,
} from "@dreamer/runtime-adapter";
import type { AssetsConfig } from "./types.ts";
import { logger } from "./utils/logger.ts";

/**
 * 静态资源处理器
 */
export class AssetsProcessor {
  private config: AssetsConfig;
  private outputDir: string;

  constructor(config: AssetsConfig, outputDir: string) {
    this.config = config;
    this.outputDir = outputDir;
  }

  /**
   * 处理所有资源
   *
   * 优化：并行处理不同类型的资源（静态资源、图片、字体），减少总处理时间
   */
  async processAssets(): Promise<void> {
    const tasks: Promise<void>[] = [];

    // 1. 复制静态资源（如果配置了）
    if (this.config.publicDir) {
      tasks.push(this.copyStaticAssets());
    }

    // 2. 处理图片（如果配置了）
    if (this.config.images) {
      tasks.push(this.processImages());
    }

    // 3. 处理字体文件
    tasks.push(this.processFonts());

    // 并行执行所有资源处理任务
    await Promise.all(tasks);

    // 4. 更新资源路径（必须在所有资源处理完成后执行）
    await this.updateAssetPaths();
  }

  /**
   * 复制静态资源
   */
  private async copyStaticAssets(): Promise<void> {
    if (!this.config.publicDir) {
      return;
    }

    const publicDir = resolve(this.config.publicDir);
    const assetsDir = this.config.assetsDir || "assets";
    const targetDir = join(this.outputDir, assetsDir);

    // 检查源目录是否存在
    try {
      await stat(publicDir);
    } catch {
      // 目录不存在，直接返回
      return;
    }

    // 创建目标目录
    await mkdir(targetDir, { recursive: true });

    // 递归复制文件
    await this.copyDirectory(publicDir, targetDir);
  }

  /**
   * 递归复制目录
   */
  private async copyDirectory(
    sourceDir: string,
    targetDir: string,
  ): Promise<void> {
    const entries = await readdir(sourceDir);

    for (const entry of entries) {
      const sourcePath = join(sourceDir, entry.name);
      const targetPath = join(targetDir, entry.name);

      const entryStat = await stat(sourcePath);
      if (entryStat.isDirectory) {
        // 递归复制子目录
        await mkdir(targetPath, { recursive: true });
        await this.copyDirectory(sourcePath, targetPath);
      } else {
        // 复制文件
        await copyFile(sourcePath, targetPath);
      }
    }
  }

  /**
   * 处理图片
   *
   * 支持图片压缩和格式转换，使用 @dreamer/image 库
   */
  private async processImages(): Promise<void> {
    if (!this.config.images) {
      return;
    }

    const imagesConfig = this.config.images;
    const assetsDir = this.config.assetsDir || "assets";
    const imagesDir = join(this.outputDir, assetsDir);

    // 检查图片目录是否存在
    try {
      await stat(imagesDir);
    } catch {
      // 目录不存在，直接返回
      return;
    }

    // 遍历图片目录，处理所有图片文件
    await this.processImagesInDirectory(imagesDir, imagesConfig);
  }

  /**
   * 递归处理目录中的图片文件
   *
   * 优化：并行处理同一目录下的多个图片文件
   */
  private async processImagesInDirectory(
    dir: string,
    config: { compress?: boolean; format?: "webp" | "avif" | "original" },
  ): Promise<void> {
    const entries = await readdir(dir);
    const tasks: Promise<void>[] = [];

    for (const entry of entries) {
      const filePath = join(dir, entry.name);
      const entryStat = await stat(filePath);

      if (entryStat.isDirectory) {
        // 递归处理子目录
        tasks.push(this.processImagesInDirectory(filePath, config));
      } else if (entryStat.isFile) {
        // 检查是否为图片文件
        const ext = entry.name.split(".").pop()?.toLowerCase();
        const imageExts = ["jpg", "jpeg", "png", "gif", "bmp", "webp", "avif"];

        if (ext && imageExts.includes(ext)) {
          tasks.push(this.processImageFile(filePath, config));
        }
      }
    }

    // 并行处理所有图片文件
    await Promise.all(tasks);
  }

  /**
   * 处理单个图片文件
   */
  private async processImageFile(
    filePath: string,
    config: { compress?: boolean; format?: "webp" | "avif" | "original" },
  ): Promise<void> {
    try {
      // 读取原始图片数据
      const imageData = await readFile(filePath);

      let processedData = imageData;
      let outputPath = filePath;

      // 格式转换
      if (config.format && config.format !== "original") {
        const formatMap: Record<string, "jpeg" | "png" | "webp" | "avif"> = {
          webp: "webp",
          avif: "avif",
        };

        const targetFormat = formatMap[config.format];
        if (targetFormat) {
          processedData = await convert(processedData, {
            format: targetFormat,
            quality: config.compress ? 80 : 100, // 如果同时压缩，使用较低质量
          });

          // 更新输出路径（更改文件扩展名）
          const ext = targetFormat === "jpeg" ? "jpg" : targetFormat;
          outputPath = filePath.replace(/\.[^.]+$/, `.${ext}`);
        }
      }

      // 图片压缩
      if (config.compress) {
        // 如果已经进行了格式转换，使用转换后的数据
        // 否则使用原始数据
        const dataToCompress = processedData;

        // 根据文件格式确定压缩质量
        const ext = outputPath.split(".").pop()?.toLowerCase();
        let quality = 80; // 默认质量

        // PNG 和 GIF 使用无损压缩（quality = 100）
        if (ext === "png" || ext === "gif") {
          quality = 100;
        }

        processedData = await compress(dataToCompress, {
          quality,
          format: ext as
            | "jpeg"
            | "png"
            | "webp"
            | "gif"
            | "bmp"
            | "tiff"
            | "avif"
            | undefined,
        });
      }

      // 如果数据有变化，写回文件
      if (processedData !== imageData || outputPath !== filePath) {
        await writeFile(outputPath, processedData);

        // 如果输出路径不同，删除原文件
        if (outputPath !== filePath) {
          try {
            await remove(filePath);
          } catch {
            // 忽略删除错误
          }
        }
      }
    } catch (error) {
      // 图片处理失败，记录警告但不中断构建
      logger.warn("图片处理失败", {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * 处理字体文件
   *
   * 字体文件通常只需要复制，不需要特殊处理
   */
  private async processFonts(): Promise<void> {
    // 字体文件已经在 copyStaticAssets 中处理了
    // 这里可以添加字体文件的特殊处理逻辑（如字体子集化等）
  }

  /**
   * 更新资源路径
   *
   * 更新 HTML、CSS、JS 文件中的资源路径引用
   */
  private async updateAssetPaths(): Promise<void> {
    // 扫描输出目录中的 HTML、CSS、JS 文件
    await this.updatePathsInDirectory(this.outputDir);
  }

  /**
   * 递归更新目录中的文件路径
   */
  private async updatePathsInDirectory(dir: string): Promise<void> {
    const entries = await readdir(dir);

    for (const entry of entries) {
      const filePath = join(dir, entry.name);
      const entryStat = await stat(filePath);

      if (entryStat.isDirectory) {
        // 递归处理子目录
        await this.updatePathsInDirectory(filePath);
      } else {
        // 处理文件
        const ext = entry.name.split(".").pop()?.toLowerCase();
        if (ext === "html" || ext === "css" || ext === "js") {
          await this.updatePathsInFile(filePath);
        }
      }
    }
  }

  /**
   * 更新文件中的资源路径
   */
  private async updatePathsInFile(filePath: string): Promise<void> {
    const content = await readTextFile(filePath);
    const dir = filePath.substring(0, filePath.lastIndexOf("/"));
    const relativePath = relative(this.outputDir, dir);

    // 更新相对路径引用
    // 这里可以根据需要实现更复杂的路径更新逻辑
    let updatedContent = content;

    // 更新 CSS 中的 url() 引用
    if (filePath.endsWith(".css")) {
      updatedContent = updatedContent.replace(
        /url\(['"]?([^'")]+)['"]?\)/g,
        (match, path) => {
          if (
            path.startsWith("http://") || path.startsWith("https://") ||
            path.startsWith("data:") || path.startsWith("/")
          ) {
            return match; // 不处理绝对路径和数据 URI
          }
          // 更新相对路径
          const newPath = this.resolveAssetPath(path, relativePath);
          return `url('${newPath}')`;
        },
      );
    }

    // 更新 HTML 中的 src 和 href 引用
    if (filePath.endsWith(".html")) {
      updatedContent = updatedContent.replace(
        /(src|href)=['"]([^'"]+)['"]/g,
        (match, attr, path) => {
          if (
            path.startsWith("http://") || path.startsWith("https://") ||
            path.startsWith("data:") || path.startsWith("/")
          ) {
            return match; // 不处理绝对路径和数据 URI
          }
          // 更新相对路径
          const newPath = this.resolveAssetPath(path, relativePath);
          return `${attr}="${newPath}"`;
        },
      );
    }

    // 如果内容有变化，写回文件
    if (updatedContent !== content) {
      await writeTextFile(filePath, updatedContent);
    }
  }

  /**
   * 解析资源路径
   */
  private resolveAssetPath(path: string, relativePath: string): string {
    // 如果配置了 assetsDir，将资源路径指向 assets 目录
    if (this.config.assetsDir) {
      // 计算从当前文件到 assets 目录的相对路径
      const depth = relativePath.split("/").filter(Boolean).length;
      const prefix = depth > 0 ? "../".repeat(depth) : "./";
      return `${prefix}${this.config.assetsDir}/${path}`;
    }

    // 保持原有相对路径
    return path;
  }
}
