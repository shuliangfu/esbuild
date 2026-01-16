/**
 * @module @dreamer/esbuild
 *
 * 构建工具库
 *
 * 提供统一的构建接口，支持服务端和客户端代码的编译、打包、优化等功能
 */

import { Builder } from "./builder.ts";
import type { BuilderConfig } from "./types.ts";

export { AssetsProcessor } from "./assets-processor.ts";
export { BuildAnalyzer } from "./build-analyzer.ts";
export { Builder } from "./builder.ts";
export { CacheManager } from "./cache-manager.ts";
export type { CacheStats } from "./cache-manager.ts";
export { ClientBuilder } from "./client-builder.ts";
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
export { createServerModuleDetectorPlugin } from "./plugins/server-module-detector.ts";
export type { ServerModuleDetectorOptions } from "./plugins/server-module-detector.ts";
export { ServerBuilder } from "./server-builder.ts";
export {
  generateCSSTag,
  generateCSSTags,
  getCSSRelativePath,
  injectCSSFromDependencies,
  injectCSSIntoHTML,
} from "./utils/css-injector.ts";
export type { CSSFileInfo, CSSInjectOptions } from "./utils/css-injector.ts";

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
