/**
 * @module @dreamer/esbuild/builder-bundle
 *
 * 简单打包器
 *
 * 提供快速将代码打包为浏览器可用格式的功能，适用于浏览器测试、服务端渲染等场景
 */

import * as esbuild from "esbuild";

/**
 * 简单打包选项
 * 用于快速将代码打包为浏览器可用格式
 */
export interface BundleOptions {
  /** 入口文件路径 */
  entryPoint: string;
  /** 全局变量名（IIFE 格式时使用） */
  globalName?: string;
  /** 目标平台（默认：browser） */
  platform?: "browser" | "node" | "neutral";
  /** 目标 ES 版本（默认：es2020） */
  target?: string | string[];
  /** 是否压缩（默认：false） */
  minify?: boolean;
  /** 输出格式（默认：iife） */
  format?: "iife" | "esm" | "cjs";
  /** 是否生成 sourcemap（默认：false） */
  sourcemap?: boolean;
  /** 外部依赖（不打包） */
  external?: string[];
  /** 自定义 esbuild 插件 */
  plugins?: esbuild.Plugin[];
  /** 定义替换（define） */
  define?: Record<string, string>;
  /** 是否打包依赖（默认：true） */
  bundle?: boolean;
}

/**
 * 打包结果
 */
export interface BundleResult {
  /** 打包后的代码 */
  code: string;
  /** Source Map（如果启用） */
  map?: string;
}

/**
 * 简单打包器类
 *
 * 提供快速将 TypeScript/JavaScript 代码打包为浏览器可用格式的功能
 *
 * @example
 * ```typescript
 * import { BuilderBundle } from "@dreamer/esbuild";
 *
 * const bundler = new BuilderBundle();
 *
 * // 基础用法：打包为 IIFE
 * const result = await bundler.build({
 *   entryPoint: "./src/client/mod.ts",
 *   globalName: "MyClient",
 * });
 * console.log(result.code);
 *
 * // 高级用法：打包为 ESM 并压缩
 * const result = await bundler.build({
 *   entryPoint: "./src/lib/index.ts",
 *   format: "esm",
 *   minify: true,
 *   sourcemap: true,
 * });
 * ```
 */
export class BuilderBundle {
  /**
   * 将代码打包为指定格式
   *
   * @param options - 打包选项
   * @returns 打包结果，包含代码和可选的 Source Map
   */
  async build(options: BundleOptions): Promise<BundleResult> {
    const buildResult = await esbuild.build({
      entryPoints: [options.entryPoint],
      bundle: options.bundle !== false,
      format: options.format || "iife",
      platform: options.platform || "browser",
      target: options.target || "es2020",
      globalName: options.globalName,
      minify: options.minify || false,
      sourcemap: options.sourcemap ? "inline" : false,
      external: options.external,
      plugins: options.plugins,
      define: options.define,
      write: false,
    });

    // 获取打包后的代码
    if (!buildResult.outputFiles || buildResult.outputFiles.length === 0) {
      throw new Error(
        `esbuild 打包失败：没有生成输出文件。入口文件: ${options.entryPoint}`,
      );
    }

    const outputFile = buildResult.outputFiles[0];
    if (!outputFile) {
      throw new Error(
        `esbuild 打包失败：输出文件为空。入口文件: ${options.entryPoint}`,
      );
    }

    const code = new TextDecoder().decode(outputFile.contents);

    // 如果有多个输出文件（代码 + sourcemap），提取 sourcemap
    let map: string | undefined;
    if (buildResult.outputFiles.length > 1) {
      const mapFile = buildResult.outputFiles[1];
      if (mapFile) {
        map = new TextDecoder().decode(mapFile.contents);
      }
    }

    return { code, map };
  }
}

/**
 * 将代码打包为浏览器可用格式（函数形式）
 *
 * 这是一个简化的打包函数，适用于需要快速将 TypeScript/JavaScript 代码
 * 打包为 IIFE 或其他格式的场景，如浏览器测试、服务端渲染等。
 *
 * @param options - 打包选项
 * @returns 打包结果，包含代码和可选的 Source Map
 *
 * @example
 * ```typescript
 * import { buildBundle } from "@dreamer/esbuild";
 *
 * // 基础用法：打包为 IIFE
 * const result = await buildBundle({
 *   entryPoint: "./src/client/mod.ts",
 *   globalName: "MyClient",
 * });
 * console.log(result.code);
 *
 * // 高级用法：打包为 ESM 并压缩
 * const result = await buildBundle({
 *   entryPoint: "./src/lib/index.ts",
 *   format: "esm",
 *   minify: true,
 *   sourcemap: true,
 * });
 * ```
 */
export function buildBundle(
  options: BundleOptions,
): Promise<BundleResult> {
  const bundler = new BuilderBundle();
  return bundler.build(options);
}

// 重新导出 esbuild 模块，供需要底层 esbuild API 的场景使用
export { esbuild };
