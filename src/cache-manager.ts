/**
 * @module @dreamer/esbuild/cache-manager
 *
 * 构建缓存管理器
 *
 * 负责管理构建缓存，避免重复构建未变化的文件
 */

import {
  exists,
  join,
  makeTempDir,
  mkdir,
  readdir,
  readFile,
  readTextFile,
  remove,
  stat,
  writeFile,
  writeTextFile,
} from "@dreamer/runtime-adapter";
import type { BuildOptions, BuildResult } from "./types.ts";
import { logger } from "./utils/logger.ts";

/**
 * 缓存统计信息
 */
export interface CacheStats {
  /** 缓存总数 */
  total: number;
  /** 缓存总大小（字节） */
  totalSize: number;
  /** 最旧的缓存时间戳 */
  oldestTimestamp: number;
  /** 最新的缓存时间戳 */
  newestTimestamp: number;
  /** 过期的缓存数量 */
  expiredCount: number;
}

/**
 * 缓存项
 */
interface CacheItem {
  /** 缓存键 */
  key: string;
  /** 构建结果 */
  result: BuildResult;
  /** 缓存时间戳 */
  timestamp: number;
  /** 依赖文件列表（用于部分缓存失效） */
  dependencies?: string[];
}

/**
 * 构建缓存管理器
 */
export class CacheManager {
  private cacheDirPromise: Promise<string>;
  private enabled: boolean;

  constructor(cacheDir?: string, enabled = true) {
    this.enabled = enabled;
    this.cacheDirPromise = cacheDir
      ? Promise.resolve(cacheDir)
      : makeTempDir({ prefix: "esbuild-cache" }).then((dir) =>
        join(dir, "cache")
      );
  }

  /**
   * 获取缓存目录
   */
  private async getCacheDir(): Promise<string> {
    return await this.cacheDirPromise;
  }

  /**
   * 生成缓存键
   *
   * 基于文件列表和构建选项生成唯一的缓存键
   * 优化：支持依赖图追踪，基于所有依赖文件生成缓存键
   */
  async getCacheKey(
    files: string[],
    options: BuildOptions,
    metafile?: unknown,
  ): Promise<string> {
    // 收集文件内容哈希
    const fileHashes: string[] = [];
    const processedFiles = new Set<string>();

    // 处理入口文件
    for (const file of files) {
      await this.addFileHash(file, fileHashes, processedFiles);
    }

    // 如果提供了 metafile，处理依赖文件
    if (metafile && typeof metafile === "object") {
      const meta = metafile as Record<string, unknown>;
      if (meta.inputs && typeof meta.inputs === "object") {
        const inputs = meta.inputs as Record<string, unknown>;
        for (const inputPath of Object.keys(inputs)) {
          if (!processedFiles.has(inputPath)) {
            await this.addFileHash(inputPath, fileHashes, processedFiles);
          }
        }
      }
    }

    // 将构建选项序列化为字符串
    const optionsStr = JSON.stringify(options);

    // 生成最终哈希
    const combined = `${fileHashes.join("|")}|${optionsStr}`;
    const key = await this.simpleHash(combined);

    return key;
  }

  /**
   * 添加文件哈希到列表
   */
  private async addFileHash(
    file: string,
    fileHashes: string[],
    processedFiles: Set<string>,
  ): Promise<void> {
    if (processedFiles.has(file)) {
      return;
    }
    processedFiles.add(file);

    try {
      const content = await readTextFile(file);
      // 使用简单的哈希算法（基于字符串长度和内容）
      const hash = await this.simpleHash(content);
      fileHashes.push(`${file}:${hash}`);
    } catch {
      // 文件不存在或无法读取，使用文件路径和修改时间
      try {
        const fileStat = await stat(file);
        fileHashes.push(`${file}:${fileStat.mtime?.getTime() || 0}`);
      } catch {
        // 文件不存在，使用路径
        fileHashes.push(`${file}:missing`);
      }
    }
  }

  /**
   * 简单的哈希函数
   */
  private async simpleHash(str: string): Promise<string> {
    // 使用 Web Crypto API 生成哈希
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /**
   * 获取缓存的构建结果
   *
   * 优化：支持读取压缩的缓存文件
   */
  async getCachedResult(key: string): Promise<BuildResult | null> {
    if (!this.enabled) {
      return null;
    }

    const cacheDir = await this.getCacheDir();
    const cacheFile = this.getCacheFilePath(key, cacheDir);
    const compressedFile = cacheFile + ".gz";

    try {
      let content: string;

      // 优先尝试读取压缩文件
      if (await exists(compressedFile)) {
        try {
          const compressedData = await readFile(compressedFile);
          // 使用 DecompressionStream 解压
          const stream = new DecompressionStream("gzip");
          const writer = stream.writable.getWriter();
          const reader = stream.readable.getReader();

          // 创建新的 Uint8Array 以确保类型兼容
          const dataArray = new Uint8Array(compressedData.length);
          dataArray.set(compressedData);
          writer.write(dataArray);
          writer.close();

          const chunks: Uint8Array[] = [];
          let done = false;
          while (!done) {
            const { value, done: readerDone } = await reader.read();
            done = readerDone;
            if (value) {
              chunks.push(value);
            }
          }

          const decompressed = new Uint8Array(
            chunks.reduce((acc, chunk) => acc + chunk.length, 0),
          );
          let offset = 0;
          for (const chunk of chunks) {
            decompressed.set(chunk, offset);
            offset += chunk.length;
          }

          content = new TextDecoder().decode(decompressed);
        } catch {
          // 解压失败，尝试读取原始文件
          content = await readTextFile(cacheFile);
        }
      } else {
        // 没有压缩文件，读取原始文件
        content = await readTextFile(cacheFile);
      }

      const cacheItem: CacheItem = JSON.parse(content);

      // 检查缓存是否过期（24小时）
      const now = Date.now();
      const cacheAge = now - cacheItem.timestamp;
      const maxAge = 24 * 60 * 60 * 1000; // 24小时

      if (cacheAge > maxAge) {
        // 缓存过期，删除缓存文件
        await this.removeCache(key);
        return null;
      }

      return cacheItem.result;
    } catch {
      // 缓存不存在或读取失败
      return null;
    }
  }

  /**
   * 保存构建结果到缓存
   *
   * 优化：支持缓存压缩（gzip），减少磁盘占用
   */
  async saveCache(key: string, result: BuildResult): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const cacheDir = await this.getCacheDir();
    // 确保缓存目录存在
    await mkdir(cacheDir, { recursive: true });

    const cacheFile = this.getCacheFilePath(key, cacheDir);

    // 从 metafile 中提取依赖文件列表
    const dependencies: string[] = [];
    if (result.metafile && typeof result.metafile === "object") {
      const meta = result.metafile as Record<string, unknown>;
      if (meta.inputs && typeof meta.inputs === "object") {
        const inputs = meta.inputs as Record<string, unknown>;
        dependencies.push(...Object.keys(inputs));
      }
    }

    const cacheItem: CacheItem = {
      key,
      result,
      timestamp: Date.now(),
      dependencies: dependencies.length > 0 ? dependencies : undefined,
    };

    try {
      const jsonContent = JSON.stringify(cacheItem, null, 2);

      // 如果内容较大（> 100KB），尝试压缩
      if (jsonContent.length > 100 * 1024) {
        try {
          // 使用 CompressionStream 压缩
          const encoder = new TextEncoder();
          const data = encoder.encode(jsonContent);
          const stream = new CompressionStream("gzip");
          const writer = stream.writable.getWriter();
          const reader = stream.readable.getReader();

          writer.write(data);
          writer.close();

          const chunks: Uint8Array[] = [];
          let done = false;
          while (!done) {
            const { value, done: readerDone } = await reader.read();
            done = readerDone;
            if (value) {
              chunks.push(value);
            }
          }

          const compressed = new Uint8Array(
            chunks.reduce((acc, chunk) => acc + chunk.length, 0),
          );
          let offset = 0;
          for (const chunk of chunks) {
            compressed.set(chunk, offset);
            offset += chunk.length;
          }

          // 保存压缩后的数据
          await writeFile(cacheFile + ".gz", compressed);
        } catch {
          // 压缩失败，使用原始方式保存
        }
      }

      // 同时保存原始文件（用于兼容性）
      await writeTextFile(cacheFile, jsonContent);
    } catch (error) {
      // 缓存写入失败，但不影响构建
      logger.warn("缓存写入失败", { error });
    }
  }

  /**
   * 删除缓存
   *
   * 优化：同时删除压缩文件
   */
  async removeCache(key: string): Promise<void> {
    const cacheDir = await this.getCacheDir();
    const cacheFile = this.getCacheFilePath(key, cacheDir);
    const compressedFile = cacheFile + ".gz";
    try {
      await remove(cacheFile);
      // 尝试删除压缩文件（如果存在）
      if (await exists(compressedFile)) {
        await remove(compressedFile);
      }
    } catch {
      // 忽略删除失败
    }
  }

  /**
   * 清空所有缓存
   */
  async clearCache(): Promise<void> {
    if (!this.enabled) {
      return;
    }

    try {
      const cacheDir = await this.getCacheDir();
      const entries = await readdir(cacheDir);
      for (const entry of entries) {
        if (
          !entry.isDirectory &&
          (entry.name.endsWith(".json") || entry.name.endsWith(".gz"))
        ) {
          await remove(join(cacheDir, entry.name));
        }
      }
    } catch {
      // 忽略错误
    }
  }

  /**
   * 获取缓存文件路径
   */
  private getCacheFilePath(key: string, cacheDir: string): string {
    return join(cacheDir, `${key}.json`);
  }

  /**
   * 获取缓存统计信息
   */
  async getCacheStats(): Promise<CacheStats> {
    if (!this.enabled) {
      return {
        total: 0,
        totalSize: 0,
        oldestTimestamp: 0,
        newestTimestamp: 0,
        expiredCount: 0,
      };
    }

    try {
      const cacheDir = await this.getCacheDir();
      const files = await readdir(cacheDir);
      const stats: CacheStats = {
        total: 0,
        totalSize: 0,
        oldestTimestamp: Date.now(),
        newestTimestamp: 0,
        expiredCount: 0,
      };

      const maxAge = 24 * 60 * 60 * 1000; // 24小时
      const now = Date.now();

      for (const file of files) {
        if (
          file.isFile &&
          (file.name.endsWith(".json") || file.name.endsWith(".gz"))
        ) {
          stats.total++;
          try {
            const filePath = join(cacheDir, file.name);
            const fileStat = await stat(filePath);
            stats.totalSize += fileStat.size;

            // 如果是 JSON 文件，尝试读取时间戳
            if (file.name.endsWith(".json")) {
              try {
                const content = await readTextFile(filePath);
                const cacheItem = JSON.parse(content);
                if (cacheItem.timestamp) {
                  if (cacheItem.timestamp < stats.oldestTimestamp) {
                    stats.oldestTimestamp = cacheItem.timestamp;
                  }
                  if (cacheItem.timestamp > stats.newestTimestamp) {
                    stats.newestTimestamp = cacheItem.timestamp;
                  }

                  // 检查是否过期
                  if (now - cacheItem.timestamp > maxAge) {
                    stats.expiredCount++;
                  }
                }
              } catch {
                // 忽略解析错误
              }
            }
          } catch {
            // 忽略文件读取错误
          }
        }
      }

      return stats;
    } catch {
      return {
        total: 0,
        totalSize: 0,
        oldestTimestamp: 0,
        newestTimestamp: 0,
        expiredCount: 0,
      };
    }
  }

  /**
   * 清理过期缓存
   */
  async cleanExpiredCache(): Promise<number> {
    if (!this.enabled) {
      return 0;
    }

    let cleanedCount = 0;
    const maxAge = 24 * 60 * 60 * 1000; // 24小时
    const now = Date.now();

    try {
      const cacheDir = await this.getCacheDir();
      const files = await readdir(cacheDir);

      for (const file of files) {
        if (file.isFile && file.name.endsWith(".json")) {
          try {
            const filePath = join(cacheDir, file.name);
            const content = await readTextFile(filePath);
            const cacheItem = JSON.parse(content);

            if (cacheItem.timestamp && now - cacheItem.timestamp > maxAge) {
              // 删除过期缓存
              await remove(filePath);
              // 尝试删除压缩文件
              const compressedFile = filePath + ".gz";
              if (await exists(compressedFile)) {
                await remove(compressedFile);
              }
              cleanedCount++;
            }
          } catch {
            // 忽略错误，继续处理下一个文件
          }
        }
      }
    } catch {
      // 忽略错误
    }

    return cleanedCount;
  }

  /**
   * 清理旧缓存（保留最近的 N 个）
   */
  async cleanOldCache(keepCount: number = 10): Promise<number> {
    if (!this.enabled) {
      return 0;
    }

    let cleanedCount = 0;

    try {
      const cacheDir = await this.getCacheDir();
      const files = await readdir(cacheDir);
      const cacheItems: Array<{ path: string; timestamp: number }> = [];

      // 收集所有缓存项及其时间戳
      for (const file of files) {
        if (file.isFile && file.name.endsWith(".json")) {
          try {
            const filePath = join(cacheDir, file.name);
            const content = await readTextFile(filePath);
            const cacheItem = JSON.parse(content);

            if (cacheItem.timestamp) {
              cacheItems.push({
                path: filePath,
                timestamp: cacheItem.timestamp,
              });
            }
          } catch {
            // 忽略错误
          }
        }
      }

      // 按时间戳排序，保留最新的
      cacheItems.sort((a, b) => b.timestamp - a.timestamp);
      const toRemove = cacheItems.slice(keepCount);

      // 删除旧缓存
      for (const item of toRemove) {
        try {
          await remove(item.path);
          // 尝试删除压缩文件
          const compressedFile = item.path + ".gz";
          if (await exists(compressedFile)) {
            await remove(compressedFile);
          }
          cleanedCount++;
        } catch {
          // 忽略错误
        }
      }
    } catch {
      // 忽略错误
    }

    return cleanedCount;
  }
}
