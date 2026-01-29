/**
 * @fileoverview 测试工具函数
 *
 * 提供测试数据目录管理和清理功能
 * 所有测试输出文件都应该放在 tests/data/ 目录下
 */

import {
  exists,
  join,
  readdir,
  remove,
  resolve,
  stat,
} from "@dreamer/runtime-adapter";

/**
 * 是否在测试完成后清理测试数据
 *
 * 设为 false 可以保留测试输出文件，方便检查编译结果
 * 设为 true 则会在测试完成后自动清理
 */
export const CLEANUP_AFTER_TEST = false;

/**
 * 获取测试数据目录路径
 *
 * 每个库的测试数据目录是独立的：{库目录}/tests/data/
 *
 * @returns 测试数据目录的绝对路径
 */
export function getTestDataDir(): string {
  const testDir = new URL(".", import.meta.url).pathname;
  return resolve(join(testDir, "data"));
}

/**
 * 获取测试输出目录路径
 *
 * 所有测试输出文件都应该放在 tests/data/ 下的子目录中
 *
 * @param subDir 子目录名称（可选，用于区分不同测试模块）
 * @returns 测试输出目录路径（绝对路径）
 *
 * @example
 * ```typescript
 * // 获取 builder 测试的输出目录
 * const outputDir = getTestOutputDir("builder");
 * // 结果: /path/to/esbuild/tests/data/builder
 * ```
 */
export function getTestOutputDir(subDir?: string): string {
  const dataDir = getTestDataDir();
  return subDir ? join(dataDir, subDir) : dataDir;
}

/**
 * 清理测试数据目录
 *
 * 在测试完成后调用，清理 tests/data/ 目录下的所有文件和子目录
 * 同时清理根目录下可能生成的临时文件（如 server.tmp-*）
 *
 * @returns Promise<void>
 *
 * @example
 * ```typescript
 * // 在测试文件的最后调用
 * it("应该清理测试数据", async () => {
 *   await cleanupTestData();
 * });
 * ```
 */
export async function cleanupTestData(): Promise<void> {
  const dataDir = getTestDataDir();

  try {
    // 清理 tests/data/ 目录
    if (await exists(dataDir)) {
      const entries = await readdir(dataDir);

      if (entries.length > 0) {
        // 删除所有文件和子目录
        for (const entry of entries) {
          const entryPath = join(dataDir, entry.name);
          const entryStat = await stat(entryPath);

          if (entryStat.isDirectory) {
            // 递归删除子目录
            await remove(entryPath, { recursive: true });
          } else {
            // 删除文件
            await remove(entryPath);
          }
        }
      }
    }
  } catch (error) {
    // 忽略清理错误，不影响测试
    console.warn(`清理测试数据目录失败: ${dataDir}`, error);
  }

  // 清理根目录下的临时文件（如 server.tmp-*）
  try {
    await cleanupRootTempFiles();
  } catch (error) {
    // 忽略清理错误
    console.warn("清理根目录临时文件失败", error);
  }
}

/**
 * 清理指定目录
 *
 * 受 CLEANUP_AFTER_TEST 开关控制，如果禁用清理则不执行
 *
 * @param dirPath - 要清理的目录路径
 * @returns Promise<void>
 */
export async function cleanupDir(dirPath: string): Promise<void> {
  // 如果禁用清理，直接返回
  if (!CLEANUP_AFTER_TEST) {
    return;
  }

  try {
    if (await exists(dirPath)) {
      await remove(dirPath, { recursive: true });
    }
  } catch {
    // 忽略清理错误
  }
}

/**
 * 清理根目录下的临时文件
 *
 * 清理可能生成在库根目录的临时文件，如：
 * - server.tmp-*
 * - server
 * - server.js
 * - *.tmp*
 *
 * @returns Promise<void>
 */
export async function cleanupRootTempFiles(): Promise<void> {
  // 如果禁用清理，直接返回
  if (!CLEANUP_AFTER_TEST) {
    return;
  }
  try {
    // 获取库的根目录（tests 目录的父目录）
    const testDir = new URL(".", import.meta.url).pathname;
    const rootDir = resolve(join(testDir, ".."));

    // 检查根目录是否存在
    if (!(await exists(rootDir))) {
      return;
    }

    // 读取根目录内容
    const entries = await readdir(rootDir);

    // 需要清理的文件模式
    const tempFilePatterns = [
      /^server\.tmp-/,
      /^server$/,
      /^server\.js$/,
      /\.tmp-\w+$/,
    ];

    // 删除匹配的临时文件
    for (const entry of entries) {
      // 检查是否是临时文件
      const isTempFile = tempFilePatterns.some((pattern) =>
        pattern.test(entry.name)
      );

      if (isTempFile) {
        const filePath = join(rootDir, entry.name);
        try {
          const fileStat = await stat(filePath);
          // 只删除文件，不删除目录
          if (!fileStat.isDirectory) {
            await remove(filePath);
          }
        } catch {
          // 忽略删除失败的文件
        }
      }
    }
  } catch (error) {
    // 忽略清理错误，不影响测试
    console.warn("清理根目录临时文件失败", error);
  }
}
