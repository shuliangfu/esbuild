/**
 * @module @dreamer/esbuild/types
 *
 * 类型定义
 */

/**
 * 模板引擎类型（与 @dreamer/render 一致）
 */
export type Engine = "react" | "preact";

/**
 * 构建模式
 */
export type BuildMode = "dev" | "prod";

/**
 * 目标运行时
 */
export type TargetRuntime = "deno" | "bun";

/**
 * 输出格式
 */
export type OutputFormat = "esm" | "cjs" | "iife";

/**
 * 平台类型
 */
export type Platform = "linux" | "darwin" | "windows";

/**
 * 服务端编译选项
 */
export interface ServerCompileOptions {
  /** 是否压缩 */
  minify?: boolean;
  /** 是否生成 source map */
  sourcemap?: boolean;
  /** 目标平台 */
  platform?: Platform[];
  /** 是否 standalone（包含所有依赖） */
  standalone?: boolean;
}

/**
 * 服务端配置（完整配置，用于 BuilderServer）
 */
export interface ServerConfig {
  /** 入口文件 */
  entry: string;
  /** 输出目录（输出 JS 文件的目录，或可执行文件路径） */
  output: string;
  /** 目标运行时 */
  target?: TargetRuntime;
  /** 编译选项（压缩、sourcemap 等） */
  compile?: ServerCompileOptions;
  /**
   * 外部依赖（不打包，保留 import 语句）
   *
   * 适用于：
   * - 原生模块（.node 文件）
   * - 需要在运行时动态加载的模块
   *
   * @example ["tailwindcss", "lightningcss", "@tailwindcss/*"]
   */
  external?: string[];
  /**
   * 自动将 npm 包标记为 external（默认 false）
   *
   * 启用后，所有 npm: 协议的包都不会被打包，
   * 而是保留 import 语句，由运行时解析。
   *
   * 适用于服务端编译成 JS 文件的场景，
   * Deno/Bun 运行时可以直接解析 npm 包。
   */
  externalNpm?: boolean;
  /**
   * 使用原生编译器（生成独立可执行文件）
   *
   * - Deno: 使用 `deno compile`
   * - Bun: 使用 `bun build --compile`
   *
   * 默认 false（输出 JS 文件）
   */
  useNativeCompile?: boolean;
  /**
   * 排除的路径模式列表
   *
   * 匹配这些模式的路径会被标记为 external，不会被 esbuild 扫描。
   * 可用于阻止 esbuild 扫描全局缓存目录（如 .bun/install, .npm/ 等）。
   *
   * 默认值：["node_modules"]
   *
   * @example [".bun/install", ".npm/", "yarn/global"]
   */
  excludePaths?: string[];
}

/**
 * 代码分割策略
 */
export interface SplittingStrategy {
  /** 是否启用代码分割 */
  enabled?: boolean;
  /** 按路由分割 */
  byRoute?: boolean;
  /** 按组件分割 */
  byComponent?: boolean;
  /** 按大小分割（字节） */
  bySize?: number;
  /** 自定义分割规则（函数） */
  custom?: (path: string) => boolean;
}

/**
 * 客户端打包选项
 */
export interface ClientBundleOptions {
  /** 是否压缩 */
  minify?: boolean;
  /** 是否生成 source map */
  sourcemap?: boolean;
  /** 代码分割 */
  splitting?: boolean | SplittingStrategy;
  /** 外部依赖（不打包） */
  external?: string[];
  /** 输出格式 */
  format?: OutputFormat;
  /** 模块别名（用于解决多实例问题，如 preact） */
  alias?: Record<string, string>;
}

/**
 * HTML 入口配置
 */
export interface HTMLEntry {
  /** 入口文件 */
  entry: string;
  /** HTML 模板路径（可选） */
  template?: string;
  /** HTML 标题 */
  title?: string;
}

/**
 * 预加载策略
 */
export type PreloadStrategy = "immediate" | "defer" | "async";

/**
 * 预加载配置
 */
export interface PreloadConfig {
  /** 是否启用预加载 */
  enabled?: boolean;
  /** 预加载策略 */
  strategy?: PreloadStrategy;
  /** 需要预加载的文件类型 */
  types?: ("js" | "css" | "font" | "image")[];
  /** 需要预加载的文件路径（正则表达式或函数） */
  match?: RegExp | ((path: string) => boolean);
}

/**
 * HTML 配置
 */
export interface HTMLConfig {
  /** HTML 模板路径（可选） */
  template?: string;
  /** HTML 标题 */
  title?: string;
  /** 多入口配置 */
  entries?: {
    [name: string]: HTMLEntry;
  };
  /** 预加载配置 */
  preload?: PreloadConfig;
}

/**
 * Source Map 配置
 */
export interface SourceMapConfig {
  /** 是否启用 source map */
  enabled?: boolean;
  /** Source map 模式：inline（内联）、external（外部文件）、both（同时生成） */
  mode?: "inline" | "external" | "both";
  /** 是否压缩 source map（生产环境） */
  compress?: boolean;
  /** 是否验证 source map */
  validate?: boolean;
}

/**
 * 客户端配置
 */
export interface ClientConfig {
  /** 入口文件（单入口） */
  entry?: string;
  /** 多入口配置（与 entry 互斥） */
  entries?: {
    [name: string]: {
      /** 入口文件路径 */
      entry: string;
      /** 输出目录（可选，默认使用主输出目录） */
      output?: string;
    };
  };
  /** 输出目录 */
  output: string;
  /** 模板引擎类型（react、preact） */
  engine: Engine;
  /** 打包选项 */
  bundle?: ClientBundleOptions;
  /** HTML 配置 */
  html?: HTMLConfig;
  /** 插件列表 */
  plugins?: import("./plugin.ts").BuildPlugin[];
  /** Source Map 配置 */
  sourcemap?: SourceMapConfig | boolean;
}

/**
 * CSS 处理选项
 */
export interface CSSOptions {
  /** 是否提取 CSS */
  extract?: boolean;
  /** 是否压缩 */
  minify?: boolean;
  /** 自动前缀 */
  autoprefix?: boolean;
}

/**
 * 图片处理选项
 */
export interface ImageOptions {
  /** 是否压缩 */
  compress?: boolean;
  /** 输出格式 */
  format?: "webp" | "avif" | "original";
}

/**
 * 资源处理配置
 */
export interface AssetsConfig {
  /** CSS 处理 */
  css?: CSSOptions;
  /** 图片处理（可选，可集成 @dreamer/image） */
  images?: ImageOptions;
  /** 静态资源目录 */
  publicDir?: string;
  /** 资源输出目录 */
  assetsDir?: string;
}

/**
 * 构建进度回调
 */
export interface BuildProgressCallback {
  /** 当前阶段 */
  stage: string;
  /** 进度百分比（0-100） */
  progress: number;
  /** 当前处理的文件（可选） */
  currentFile?: string;
  /** 总文件数（可选） */
  totalFiles?: number;
}

/**
 * Watch 模式配置
 */
export interface WatchOptions {
  /** 是否启用 Watch 模式 */
  enabled?: boolean;
  /** 监听的文件/目录路径 */
  paths?: string[];
  /** 是否递归监听 */
  recursive?: boolean;
  /** 忽略的文件/目录（支持 glob 模式） */
  ignore?: (string | RegExp)[];
  /** 文件变化时的回调函数 */
  onFileChange?: (
    path: string,
    kind: "create" | "modify" | "remove",
  ) => void | Promise<void>;
  /** 防抖延迟（毫秒，默认 300） */
  debounce?: number;
}

/**
 * 日志级别
 */
export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

/**
 * 错误统计信息
 */
export interface ErrorStats {
  /** 错误总数 */
  total: number;
  /** 警告总数 */
  warnings: number;
  /** 错误类型统计 */
  errorsByType: Record<string, number>;
  /** 最近错误列表 */
  recentErrors: Array<{
    message: string;
    type: string;
    timestamp: number;
    stack?: string;
  }>;
}

/**
 * 构建优化建议
 */
export interface OptimizationSuggestion {
  /** 建议类型 */
  type: "warning" | "info" | "error";
  /** 建议标题 */
  title: string;
  /** 建议描述 */
  description: string;
  /** 修复建议 */
  fix?: string;
  /** 相关文件 */
  files?: string[];
}

/**
 * 构建选项
 */
export interface BuildOptions {
  /** 构建模式 */
  mode?: BuildMode;
  /** 是否清理输出目录 */
  clean?: boolean;
  /** 构建缓存（true 使用默认缓存目录，string 指定缓存目录，false 禁用缓存） */
  cache?: boolean | string;
  /** 增量编译 */
  incremental?: boolean;
  /** Watch 模式配置 */
  watch?: WatchOptions;
  /** 构建进度回调（可选） */
  onProgress?: (progress: BuildProgressCallback) => void;
  /** 是否静默模式（不输出进度信息，默认 false） */
  silent?: boolean;
  /** 慢构建警告阈值（毫秒，默认 5000，即 5 秒） */
  slowBuildThreshold?: number;
  /** 是否验证构建配置（默认 false） */
  validateConfig?: boolean;
  /** 日志级别（默认 "info"） */
  logLevel?: LogLevel;
  /** HTML 报告路径（false 表示不生成，字符串表示路径，默认在开发模式下生成） */
  reportHTML?: boolean | string;
}

/**
 * 构建器配置
 */
export interface BuilderConfig {
  /** 服务端配置 */
  server?: ServerConfig;
  /** 客户端配置 */
  client?: ClientConfig;
  /** 资源处理配置 */
  assets?: AssetsConfig;
  /** 构建选项 */
  build?: BuildOptions;
  /** 是否验证构建配置（默认 false） */
  validateConfig?: boolean;
}

/**
 * 构建性能统计
 */
export interface BuildPerformance {
  /** 构建阶段耗时（毫秒） */
  stages: {
    /** 清理阶段耗时 */
    clean?: number;
    /** 缓存检查耗时 */
    cacheCheck?: number;
    /** 构建阶段耗时 */
    build?: number;
    /** 资源处理耗时 */
    assets?: number;
    /** HTML 生成耗时 */
    html?: number;
    /** CSS 优化耗时 */
    css?: number;
  };
  /** 总耗时（毫秒） */
  total: number;
}

/**
 * 输出文件内容
 * 当 write 为 false 时，返回此类型包含文件内容
 */
export interface OutputFileContent {
  /** 文件路径（虚拟路径，不实际写入） */
  path: string;
  /** 文件内容（字符串格式） */
  text: string;
  /** 文件内容（二进制格式） */
  contents: Uint8Array;
}

/**
 * 构建结果
 */
export interface BuildResult {
  /** 输出文件列表（文件路径） */
  outputFiles: string[];
  /** 输出文件内容列表（当 write 为 false 时有值） */
  outputContents?: OutputFileContent[];
  /** 构建元数据（esbuild Metafile） */
  metafile?: unknown;
  /** 构建时间（毫秒） */
  duration: number;
  /** 构建性能统计（可选） */
  performance?: BuildPerformance;
}

/**
 * 构建器接口
 */
export interface Builder {
  /** 构建服务端代码 */
  buildServer(options?: BuildOptions): Promise<BuildResult>;
  /** 构建客户端代码 */
  buildClient(options?: BuildOptions): Promise<BuildResult>;
  /** 同时构建服务端和客户端 */
  build(options?: BuildOptions): Promise<BuildResult>;
  /** 清理构建产物 */
  clean(): Promise<void>;
  /** 启动 Watch 模式 */
  watch(options?: BuildOptions): Promise<void>;
  /** 停止 Watch 模式 */
  stopWatch(): void;
}
