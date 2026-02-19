/**
 * @module @dreamer/esbuild/bundle
 *
 * 打包工具子路径导出（测试库等使用）
 * 按需导入：import { buildBundle } from "jsr:@dreamer/esbuild/bundle"
 */

export { buildBundle, BuilderBundle, esbuild } from "./builder-bundle.ts";
export type { BundleOptions, BundleResult } from "./builder-bundle.ts";
