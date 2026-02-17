/**
 * @module @dreamer/esbuild
 *
 * 构建工具库
 *
 * 提供统一的构建接口，支持服务端和客户端代码的编译、打包、优化等功能
 */

import { initEsbuildI18n } from "./i18n.ts";
import { Builder } from "./builder.ts";

// 入口处初始化 i18n，供 Builder/analyzer 等日志与错误文案使用
initEsbuildI18n();
import type { BuilderConfig } from "./types.ts";

export { AssetsProcessor } from "./assets-processor.ts";
export { BuildAnalyzer } from "./build-analyzer.ts";
export { buildBundle, BuilderBundle, esbuild } from "./builder-bundle.ts";
export type { BundleOptions, BundleResult } from "./builder-bundle.ts";
export { BuilderClient } from "./builder-client.ts";
export type { ClientBuildOptions } from "./builder-client.ts";
export { BuilderServer } from "./builder-server.ts";
export type { ServerBuildOptions } from "./builder-server.ts";
export { Builder } from "./builder.ts";
export { CacheManager } from "./cache-manager.ts";
export type { CacheStats } from "./cache-manager.ts";
export { CSSOptimizer } from "./css-optimizer.ts";
export { HTMLGenerator } from "./html-generator.ts";
export { PluginManager } from "./plugin.ts";
export { createConditionalCompilePlugin } from "./plugins/conditional-compile.ts";
export type { ConditionalCompileOptions } from "./plugins/conditional-compile.ts";
export { createCSSImportHandlerPlugin } from "./plugins/css-import-handler.ts";
export type {
  CSSImportHandlerOptions,
  CSSImportHandlerPluginInstance,
} from "./plugins/css-import-handler.ts";
export { bunResolverPlugin } from "./plugins/resolver-bun.ts";
export type { ResolverOptions as BunResolverOptions } from "./plugins/resolver-bun.ts";
export { denoResolverPlugin } from "./plugins/resolver-deno.ts";
export type { ResolverOptions as DenoResolverOptions } from "./plugins/resolver-deno.ts";
export { createServerModuleDetectorPlugin } from "./plugins/server-module-detector.ts";
export type { ServerModuleDetectorOptions } from "./plugins/server-module-detector.ts";
// css-injector 拆至子路径，按需导入：import { injectCSSIntoHTML } from "jsr:@dreamer/esbuild/css-injector"

export type {
  BuilderConfig,
  BuildMode,
  BuildOptions,
  BuildPerformance,
  BuildProgressCallback,
  BuildResult,
  ClientBundleOptions,
  ClientConfig,
  Engine,
  ErrorStats,
  LogLevel,
  OptimizationSuggestion,
  OutputFileContent,
  OutputFormat,
  Platform,
  PreloadConfig,
  PreloadStrategy,
  ServerConfig,
  SourceMapConfig,
  SplittingStrategy,
  TargetRuntime,
  WatchOptions,
} from "./types.ts";

export type {
  AnalysisResult,
  DependencyGraph,
  DuplicateInfo,
  FileInfo,
} from "./build-analyzer.ts";

export type {
  BuildPlugin,
  OnLoadArgs,
  OnLoadCallback,
  OnLoadOptions,
  OnLoadResult,
  OnResolveArgs,
  OnResolveCallback,
  OnResolveOptions,
  OnResolveResult,
  PluginBuild,
} from "./plugin.ts";

/**
 * 创建构建器
 */
export function createBuilder(config: BuilderConfig): Builder {
  return new Builder(config);
}

/** i18n：日志与错误文案翻译，可按需 init 或使用默认入口初始化 */
export { $t, initEsbuildI18n, type Locale } from "./i18n.ts";
