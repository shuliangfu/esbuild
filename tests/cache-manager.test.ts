/**
 * @fileoverview 缓存管理器测试
 */

import { join, mkdir, writeTextFile } from "@dreamer/runtime-adapter";
import { describe, expect, it } from "@dreamer/test";
import { CacheManager } from "../src/cache-manager.ts";
import type { BuildOptions, BuildResult } from "../src/types.ts";
import { getTestDataDir } from "./test-utils.ts";

describe("CacheManager", () => {
  let testDataDir: string;

  // 测试前创建测试目录
  it("应该创建测试目录", async () => {
    testDataDir = getTestDataDir();
    await mkdir(testDataDir, { recursive: true });
    expect(testDataDir).toBeTruthy();
  });

  describe("构造函数", () => {
    it("应该创建缓存管理器实例（启用缓存）", async () => {
      const cacheManager = new CacheManager(undefined, true);
      expect(cacheManager).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该创建缓存管理器实例（禁用缓存）", async () => {
      const cacheManager = new CacheManager(undefined, false);
      expect(cacheManager).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该使用指定的缓存目录", async () => {
      const cacheDir = join(testDataDir, "custom-cache");
      const cacheManager = new CacheManager(cacheDir, true);
      expect(cacheManager).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("缓存键生成", () => {
    it("应该为相同的输入生成相同的缓存键", async () => {
      const cacheManager = new CacheManager(undefined, true);
      const files = ["file1.ts", "file2.ts"];
      const options: BuildOptions = { mode: "prod" };

      const key1 = await cacheManager.getCacheKey(files, options);
      const key2 = await cacheManager.getCacheKey(files, options);

      expect(key1).toBe(key2);
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该为不同的输入生成不同的缓存键", async () => {
      const cacheManager = new CacheManager(undefined, true);
      const files1 = ["file1.ts"];
      const files2 = ["file2.ts"];
      const options: BuildOptions = { mode: "prod" };

      const key1 = await cacheManager.getCacheKey(files1, options);
      const key2 = await cacheManager.getCacheKey(files2, options);

      expect(key1).not.toBe(key2);
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该为不同的选项生成不同的缓存键", async () => {
      const cacheManager = new CacheManager(undefined, true);
      const files = ["file1.ts"];
      const options1: BuildOptions = { mode: "prod" };
      const options2: BuildOptions = { mode: "dev" };

      const key1 = await cacheManager.getCacheKey(files, options1);
      const key2 = await cacheManager.getCacheKey(files, options2);

      expect(key1).not.toBe(key2);
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("缓存操作", () => {
    it("应该能够设置和获取缓存", async () => {
      const cacheManager = new CacheManager(undefined, true);
      const files = ["file1.ts"];
      const options: BuildOptions = { mode: "prod" };
      const cacheKey = await cacheManager.getCacheKey(files, options);

      const buildResult: BuildResult = {
        outputFiles: ["output.js"],
        duration: 100,
      };

      await cacheManager.saveCache(cacheKey, buildResult);
      const cached = await cacheManager.getCachedResult(cacheKey);

      expect(cached).toBeTruthy();
      expect(cached?.outputFiles).toEqual(buildResult.outputFiles);
      expect(cached?.duration).toBe(buildResult.duration);
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该返回 null 当缓存不存在时", async () => {
      const cacheManager = new CacheManager(undefined, true);
      const files = ["file1.ts"];
      const options: BuildOptions = { mode: "prod" };
      const cacheKey = await cacheManager.getCacheKey(files, options);

      const cached = await cacheManager.getCachedResult(cacheKey);

      expect(cached).toBeNull();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该能够清除缓存", async () => {
      const cacheManager = new CacheManager(undefined, true);
      const files = ["file1.ts"];
      const options: BuildOptions = { mode: "prod" };
      const cacheKey = await cacheManager.getCacheKey(files, options);

      const buildResult: BuildResult = {
        outputFiles: ["output.js"],
        duration: 100,
      };

      await cacheManager.saveCache(cacheKey, buildResult);
      await cacheManager.removeCache(cacheKey);
      const cached = await cacheManager.getCachedResult(cacheKey);

      expect(cached).toBeNull();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该能够清除所有缓存", async () => {
      const cacheManager = new CacheManager(undefined, true);
      const files1 = ["file1.ts"];
      const files2 = ["file2.ts"];
      const options: BuildOptions = { mode: "prod" };

      const key1 = await cacheManager.getCacheKey(files1, options);
      const key2 = await cacheManager.getCacheKey(files2, options);

      const buildResult: BuildResult = {
        outputFiles: ["output.js"],
        duration: 100,
      };

      await cacheManager.saveCache(key1, buildResult);
      await cacheManager.saveCache(key2, buildResult);

      await cacheManager.clearCache();

      const cached1 = await cacheManager.getCachedResult(key1);
      const cached2 = await cacheManager.getCachedResult(key2);

      expect(cached1).toBeNull();
      expect(cached2).toBeNull();
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("缓存失效", () => {
    it("应该检测到文件变化并失效缓存", async () => {
      const cacheManager = new CacheManager(undefined, true);
      const files = [join(testDataDir, "test.ts")];

      // 先创建文件
      await writeTextFile(files[0], "content1");

      const options: BuildOptions = { mode: "prod" };
      const cacheKey1 = await cacheManager.getCacheKey(files, options);

      const buildResult: BuildResult = {
        outputFiles: ["output.js"],
        duration: 100,
      };
      await cacheManager.saveCache(cacheKey1, buildResult);

      // 验证缓存存在
      let cached = await cacheManager.getCachedResult(cacheKey1);
      expect(cached).toBeTruthy();

      // 修改文件后，重新生成缓存键（会不同）
      await writeTextFile(files[0], "content2");
      const cacheKey2 = await cacheManager.getCacheKey(files, options);

      // 新的缓存键应该不同，旧的缓存应该仍然存在（但内容不匹配）
      expect(cacheKey1).not.toBe(cacheKey2);

      // 使用新键获取缓存（应该不存在）
      cached = await cacheManager.getCachedResult(cacheKey2);
      expect(cached).toBeNull();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该检测到依赖文件变化并失效缓存", async () => {
      const cacheManager = new CacheManager(undefined, true);
      const files = [join(testDataDir, "main.ts")];
      const depFile = join(testDataDir, "dep.ts");

      // 先创建文件
      await writeTextFile(files[0], "import './dep.ts'");
      await writeTextFile(depFile, "export const x = 1");

      const options: BuildOptions = { mode: "prod" };
      // 使用 metafile 包含依赖信息
      const metafile = {
        inputs: {
          [files[0]]: { bytes: 100, imports: [] },
          [depFile]: { bytes: 50, imports: [] },
        },
        outputs: {},
      };
      const cacheKey1 = await cacheManager.getCacheKey(
        files,
        options,
        metafile,
      );

      const buildResult: BuildResult = {
        outputFiles: ["output.js"],
        duration: 100,
      };
      await cacheManager.saveCache(cacheKey1, buildResult);

      // 验证缓存存在
      let cached = await cacheManager.getCachedResult(cacheKey1);
      expect(cached).toBeTruthy();

      // 修改依赖文件后，重新生成缓存键（会不同）
      await writeTextFile(depFile, "export const x = 2");
      const cacheKey2 = await cacheManager.getCacheKey(
        files,
        options,
        metafile,
      );

      // 新的缓存键应该不同
      expect(cacheKey1).not.toBe(cacheKey2);

      // 使用新键获取缓存（应该不存在）
      cached = await cacheManager.getCachedResult(cacheKey2);
      expect(cached).toBeNull();
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("缓存统计", () => {
    it("应该返回缓存统计信息", async () => {
      const cacheManager = new CacheManager(undefined, true);
      const files1 = ["file1.ts"];
      const files2 = ["file2.ts"];
      const options: BuildOptions = { mode: "prod" };

      const key1 = await cacheManager.getCacheKey(files1, options);
      const key2 = await cacheManager.getCacheKey(files2, options);

      const buildResult: BuildResult = {
        outputFiles: ["output.js"],
        duration: 100,
      };

      await cacheManager.saveCache(key1, buildResult);
      await cacheManager.saveCache(key2, buildResult);

      const stats = await cacheManager.getCacheStats();

      expect(stats).toBeTruthy();
      expect(stats.total).toBeGreaterThanOrEqual(2);
      expect(stats.totalSize).toBeGreaterThan(0);
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("禁用缓存", () => {
    it("应该在禁用缓存时返回 null", async () => {
      const cacheManager = new CacheManager(undefined, false);
      const files = ["file1.ts"];
      const options: BuildOptions = { mode: "prod" };
      const cacheKey = await cacheManager.getCacheKey(files, options);

      const buildResult: BuildResult = {
        outputFiles: ["output.js"],
        duration: 100,
      };

      await cacheManager.saveCache(cacheKey, buildResult);
      const cached = await cacheManager.getCachedResult(cacheKey);

      expect(cached).toBeNull();
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  // 清理测试输出目录
  it("应该清理测试输出目录", async () => {
    // 缓存目录由 CacheManager 管理，不需要手动清理
  });
});
