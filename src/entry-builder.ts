/**
 * @module @dreamer/esbuild/builder
 *
 * 主构建器子路径导出
 * 按需导入：import { Builder, AssetsProcessor } from "jsr:@dreamer/esbuild/builder"
 */

import { Builder } from "./builder.ts";
import type { BuilderConfig } from "./types.ts";

export { Builder } from "./builder.ts";
export { AssetsProcessor } from "./assets-processor.ts";
export type { BuilderConfig } from "./types.ts";

/** 创建构建器 */
export function createBuilder(config: BuilderConfig): Builder {
  return new Builder(config);
}
