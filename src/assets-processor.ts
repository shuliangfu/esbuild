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

  /**
   * 原路径 -> 新路径（带 hash）的映射，用于更新 HTML/CSS/JS 中的引用
   * key: 相对于 outputDir 的路径，如 assets/logo.png
   * value: 带 hash 的新路径，如 assets/logo.a1b2c3d4.webp
   */
  private assetPathMap = new Map<string, string>();

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
    config: {
      compress?: boolean;
      format?: "webp" | "avif" | "original";
      hash?: boolean;
    },
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
          // 跳过已带 hash 的文件名（如 logo.abc12345.webp），避免重复 hash
          const nameWithoutExt = entry.name.slice(0, -(ext.length + 1));
          const lastPart = nameWithoutExt.split(".").pop() ?? "";
          if (!/^[a-f0-9]{8}$/.test(lastPart)) {
            tasks.push(this.processImageFile(filePath, config));
          }
        }
      }
    }

    // 并行处理所有图片文件
    await Promise.all(tasks);
  }

  /**
   * 处理单个图片文件
   *
   * 支持格式转换、压缩、content hash 化（用于缓存失效）
   */
  private async processImageFile(
    filePath: string,
    config: {
      compress?: boolean;
      format?: "webp" | "avif" | "original";
      hash?: boolean;
    },
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

      // content hash 化（默认开启，用于缓存失效）
      const useHash = config.hash !== false;
      if (useHash) {
        const contentHash = await this.computeContentHash(processedData);
        const dir = filePath.substring(0, filePath.lastIndexOf("/") + 1);
        const basename = outputPath.split("/").pop() ?? "";
        const ext = basename.includes(".") ? basename.split(".").pop() ?? "" : "";
        const nameWithoutExt = basename.slice(0, -(ext.length + 1));
        const hashedBasename = `${nameWithoutExt}.${contentHash}.${ext}`;
        outputPath = join(dir, hashedBasename);

        // 记录路径映射，用于更新 HTML/CSS/JS 中的引用
        const oldRelPath = relative(this.outputDir, filePath);
        const newRelPath = relative(this.outputDir, outputPath);
        this.assetPathMap.set(oldRelPath, newRelPath);
      }

      // 如果数据有变化或路径变化，写回文件
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
   * 计算内容的 SHA-256 hash，取前 8 位十六进制作为短 hash
   */
  private async computeContentHash(data: Uint8Array): Promise<string> {
    const buffer = new Uint8Array(data).buffer;
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = new Uint8Array(hashBuffer);
    const hashHex = Array.from(hashArray)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 8);
    return hashHex;
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
   *
   * 将 HTML/CSS/JS 中对图片的引用替换为带 hash 的新路径，实现缓存失效
   */
  private async updatePathsInFile(filePath: string): Promise<void> {
    const content = await readTextFile(filePath);
    const fileDir = filePath.substring(0, filePath.lastIndexOf("/") + 1);
    const relativePath = relative(this.outputDir, fileDir);

    // 更新相对路径引用
    let updatedContent = content;

    /**
     * 将路径替换为带 hash 的新路径（若存在映射）
     * @param path 原始引用路径（如 assets/logo.png）
     * @returns 替换后的路径，若无需替换则返回原路径
     */
    const replaceWithHashedPath = (path: string): string => {
      if (
        path.startsWith("http://") ||
        path.startsWith("https://") ||
        path.startsWith("data:") ||
        path.startsWith("/")
      ) {
        return path;
      }
      // 解析为相对于 outputDir 的路径
      const resolvedPath = resolve(fileDir, path);
      const oldRelPath = relative(this.outputDir, resolvedPath);
      const newRelPath = this.assetPathMap.get(oldRelPath);
      if (newRelPath) {
        // 计算从当前文件到新资源路径的相对路径
        return relative(fileDir, resolve(this.outputDir, newRelPath));
      }
      return this.resolveAssetPath(path, relativePath);
    };

    // 更新 CSS 中的 url() 引用
    if (filePath.endsWith(".css")) {
      updatedContent = updatedContent.replace(
        /url\(['"]?([^'")]+)['"]?\)/g,
        (_match, path) => {
          const newPath = replaceWithHashedPath(path.trim());
          return `url('${newPath}')`;
        },
      );
    }

    // 更新 HTML 中的 src 和 href 引用
    if (filePath.endsWith(".html")) {
      updatedContent = updatedContent.replace(
        /(src|href)=['"]([^'"]+)['"]/g,
        (_match, attr, path) => {
          const newPath = replaceWithHashedPath(path);
          return `${attr}="${newPath}"`;
        },
      );
    }

    // 更新 JS 中的资源路径（将 assets/xxx.png 等替换为带 hash 的路径）
    if (filePath.endsWith(".js")) {
      for (const [oldRelPath, newRelPath] of this.assetPathMap) {
        updatedContent = updatedContent.replaceAll(oldRelPath, newRelPath);
      }
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
