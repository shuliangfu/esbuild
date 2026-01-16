/**
 * @fileoverview 测试后清理脚本
 *
 * 在所有测试完成后，清理 tests/data/ 目录下的所有文件
 *
 * 使用方法：
 * 1. 在测试文件的最后添加清理步骤
 * 2. 或者在测试运行脚本中调用此函数
 */

import { cleanupRootTempFiles, cleanupTestData } from "./test-utils.ts";

/**
 * 清理所有测试数据
 *
 * 在测试套件完成后调用，清理：
 * 1. tests/data/ 目录下的所有文件
 * 2. 根目录下的临时文件（如 server.tmp-*）
 */
export async function cleanupAllTestData(): Promise<void> {
  await cleanupTestData();
  await cleanupRootTempFiles();
}

// 如果直接运行此脚本
if (import.meta.main) {
  await cleanupAllTestData();
  console.log("✅ 测试数据清理完成");
}
