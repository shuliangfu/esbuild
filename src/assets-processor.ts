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
  cwd,
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

  /**
   * 额外需要更新路径的目录（如服务端 bundle，SSR 渲染的 HTML 来自服务端）
   */
  private pathUpdateDirs: string[] = [];

  constructor(
    config: AssetsConfig,
    outputDir: string,
    /** 额外扫描并更新路径的目录（如 server output，用于 SSR 场景） */
    pathUpdateDirs?: string[],
  ) {
    this.config = config;
    this.outputDir = outputDir;
    this.pathUpdateDirs = pathUpdateDirs ?? [];
  }

  /**
   * 处理所有资源
   *
   * 流程：先复制静态资源到输出目录，再对图片做压缩/hash 处理，最后更新引用路径。
   * 注意：processImages 依赖 copyStaticAssets 的输出，必须串行执行。
   */
  async processAssets(): Promise<void> {
    // 1. 先复制静态资源到 outputDir/assets（图片等依赖此步骤才能被后续处理）
    if (this.config.publicDir) {
      await this.copyStaticAssets();
    }

    // 2. 并行处理图片和字体（图片在复制后的目录中做压缩、格式转换、hash）
    const tasks: Promise<void>[] = [];
    if (this.config.images) {
      tasks.push(this.processImages());
    }
    tasks.push(this.processFonts());
    await Promise.all(tasks);

    // 3. 更新 HTML/CSS/JS 中的资源引用路径（替换为带 hash 的新路径）
    await this.updateAssetPaths();

    // 4. 生成 asset-manifest.json，供 SSR 在渲染 HTML 时替换资源路径（Hybrid 模式首屏来自服务端）
    if (this.assetPathMap.size > 0) {
      await this.writeAssetManifest();
    }
  }

  /**
   * 写入 asset-manifest.json
   *
   * 供 SSR 在渲染 HTML 时替换资源路径。Hybrid 模式下服务端从源码加载路由，
   * 源码中的路径未经过构建替换，需在 HTML 输出前用此 manifest 做运行时替换。
   */
  private async writeAssetManifest(): Promise<void> {
    const manifest: Record<string, string> = {};
    for (const [oldRel, newRel] of this.assetPathMap) {
      manifest[`/${oldRel}`] = `/${newRel}`;
    }
    const manifestPath = join(this.outputDir, "asset-manifest.json");
    await writeTextFile(manifestPath, JSON.stringify(manifest, null, 0));
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

    // 递归复制文件（排除会被其他插件编译的源文件）
    await this.copyDirectory(publicDir, targetDir, "");
  }

  /**
   * 检查路径是否在排除列表中
   * @param relativePath 相对于 publicDir 的路径，如 "tailwind.css" 或 "images/0.png"
   */
  private isExcluded(relativePath: string): boolean {
    const exclude = this.config.exclude;
    if (!exclude || exclude.length === 0) return false;
    const normalized = relativePath.replace(/\\/g, "/");
    return exclude.some((pattern) => {
      const p = pattern.replace(/\\/g, "/");
      return normalized === p || normalized.endsWith("/" + p);
    });
  }

  /**
   * 递归复制目录
   * @param sourceDir 源目录
   * @param targetDir 目标目录
   * @param relativeFromPublic 当前源目录相对于 publicDir 的路径（用于 exclude 匹配）
   */
  private async copyDirectory(
    sourceDir: string,
    targetDir: string,
    relativeFromPublic: string,
  ): Promise<void> {
    const entries = await readdir(sourceDir);

    for (const entry of entries) {
      const relPath = relativeFromPublic
        ? `${relativeFromPublic}/${entry.name}`
        : entry.name;

      if (this.isExcluded(relPath)) {
        continue;
      }

      const sourcePath = join(sourceDir, entry.name);
      const targetPath = join(targetDir, entry.name);

      const entryStat = await stat(sourcePath);
      if (entryStat.isDirectory) {
        // 递归复制子目录
        await mkdir(targetPath, { recursive: true });
        await this.copyDirectory(sourcePath, targetPath, relPath);
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
      quality?: number;
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
   * 支持格式转换、压缩、content hash 化（用于缓存失效）。
   * 格式转换或压缩失败时，回退到原图并仍执行 hash，确保页面链接能被更新。
   */
  private async processImageFile(
    filePath: string,
    config: {
      compress?: boolean;
      format?: "webp" | "avif" | "original";
      hash?: boolean;
      quality?: number;
    },
  ): Promise<void> {
    let imageData: Uint8Array;
    try {
      imageData = await readFile(filePath);
    } catch (error) {
      logger.warn("读取图片失败", {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    let processedData = imageData;
    let outputPath = filePath;

    // 格式转换（失败时保持原格式，仍继续 hash）
    if (config.format && config.format !== "original") {
      try {
        const formatMap: Record<string, "jpeg" | "png" | "webp" | "avif"> = {
          webp: "webp",
          avif: "avif",
        };
        const targetFormat = formatMap[config.format];
        if (targetFormat) {
          const quality = config.quality ?? (config.compress ? 80 : 100);
          processedData = await convert(processedData, {
            format: targetFormat,
            quality,
          });
          const ext = targetFormat === "jpeg" ? "jpg" : targetFormat;
          outputPath = filePath.replace(/\.[^.]+$/, `.${ext}`);
        }
      } catch (error) {
        logger.warn("图片格式转换失败，保持原格式并继续 hash", {
          filePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // 图片压缩（失败时保持当前数据，仍继续 hash）
    if (config.compress) {
      try {
        const ext = outputPath.split(".").pop()?.toLowerCase();
        const quality = config.quality ??
          (ext === "png" || ext === "gif" ? 100 : 80);
        processedData = await compress(processedData, {
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
      } catch (error) {
        logger.warn("图片压缩失败，保持原样并继续 hash", {
          filePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // content hash 化（格式/压缩失败时仍执行，确保页面链接能更新）
    const useHash = config.hash !== false;
    if (useHash) {
      try {
        const contentHash = await this.computeContentHash(processedData);
        const dir = filePath.substring(0, filePath.lastIndexOf("/") + 1);
        const basename = outputPath.split("/").pop() ?? "";
        const ext = basename.includes(".")
          ? basename.split(".").pop() ?? ""
          : "";
        const nameWithoutExt = basename.slice(0, -(ext.length + 1));
        const hashedBasename = `${nameWithoutExt}.${contentHash}.${ext}`;
        outputPath = join(dir, hashedBasename);

        const oldRelPath = relative(this.outputDir, filePath);
        const newRelPath = relative(this.outputDir, outputPath);
        this.assetPathMap.set(oldRelPath, newRelPath);

        await writeFile(outputPath, processedData);
        // 输出处理后的图片路径（与 builder 产物列表格式一致）
        const displayPath = relative(cwd(), outputPath);
        logger.info(`./${displayPath}`);
        if (outputPath !== filePath) {
          try {
            await remove(filePath);
          } catch {
            // 忽略删除错误
          }
        }
      } catch (error) {
        logger.warn("图片 hash 化失败", {
          filePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else if (processedData !== imageData || outputPath !== filePath) {
      await writeFile(outputPath, processedData);
      // 输出处理后的图片路径（无 hash 时，压缩/转换后仍输出）
      const displayPath = relative(cwd(), outputPath);
      logger.info(`./${displayPath}`);
      if (outputPath !== filePath) {
        try {
          await remove(filePath);
        } catch {
          // 忽略删除错误
        }
      }
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
   * 更新 HTML、CSS、JS 文件中的资源路径引用（含 client 与 server output，SSR 需更新服务端 bundle）
   */
  private async updateAssetPaths(): Promise<void> {
    const dirsToUpdate = [this.outputDir, ...this.pathUpdateDirs];
    for (const dir of dirsToUpdate) {
      try {
        await stat(dir);
        await this.updatePathsInDirectory(dir);
      } catch {
        // 目录不存在则跳过
      }
    }
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
     * @param path 原始引用路径（如 assets/logo.png 或 /assets/images/0.png）
     * @returns 替换后的路径，若无需替换则返回原路径
     */
    const replaceWithHashedPath = (path: string): string => {
      if (
        path.startsWith("http://") ||
        path.startsWith("https://") ||
        path.startsWith("data:")
      ) {
        return path;
      }
      // 处理绝对路径 /assets/images/0.png：去掉首斜杠后查映射
      const isAbsolute = path.startsWith("/");
      const pathWithoutSlash = isAbsolute ? path.slice(1) : path;
      const newRelPath = this.assetPathMap.get(pathWithoutSlash);
      if (newRelPath) {
        return isAbsolute ? `/${newRelPath}` : newRelPath;
      }
      if (isAbsolute) return path;
      // 相对路径：解析后查映射
      const resolvedPath = resolve(fileDir, path);
      const oldRelPath = relative(this.outputDir, resolvedPath);
      const newPath = this.assetPathMap.get(oldRelPath);
      if (newPath) {
        return relative(fileDir, resolve(this.outputDir, newPath));
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
