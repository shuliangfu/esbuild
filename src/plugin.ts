/**
 * @module @dreamer/esbuild/plugin
 *
 * 插件系统
 *
 * 提供插件接口，允许用户扩展构建功能
 */

import type * as esbuild from "esbuild";

/**
 * 插件构建接口
 */
export interface PluginBuild {
  /** 解析钩子 */
  onResolve(
    options: OnResolveOptions,
    callback: OnResolveCallback,
  ): void;
  /** 加载钩子 */
  onLoad(
    options: OnLoadOptions,
    callback: OnLoadCallback,
  ): void;
  /** esbuild 实例 */
  esbuild: typeof esbuild;
  /** 构建选项 */
  initialOptions: esbuild.BuildOptions;
}

/**
 * 解析选项
 */
export interface OnResolveOptions {
  /** 过滤器（正则表达式） */
  filter: RegExp;
  /** 命名空间 */
  namespace?: string;
}

/**
 * 解析回调
 */
export type OnResolveCallback = (
  args: OnResolveArgs,
) =>
  | Promise<OnResolveResult | null | undefined>
  | OnResolveResult
  | null
  | undefined;

/**
 * 解析参数
 */
export interface OnResolveArgs {
  /** 导入路径 */
  path: string;
  /** 导入者路径 */
  importer: string;
  /** 命名空间 */
  namespace: string;
  /** 解析选项 */
  resolveDir: string;
  /** 类型 */
  kind: esbuild.ImportKind;
  /** 插件数据 */
  pluginData?: unknown;
}

/**
 * 解析结果
 */
export interface OnResolveResult {
  /** 解析后的路径 */
  path?: string;
  /** 命名空间 */
  namespace?: string;
  /** 外部标记 */
  external?: boolean;
  /** 副作用标记 */
  sideEffects?: boolean;
  /** 插件数据 */
  pluginData?: unknown;
  /** 警告 */
  warnings?: esbuild.PartialMessage[];
  /** 错误 */
  errors?: esbuild.PartialMessage[];
  /** 观察的文件 */
  watchFiles?: string[];
  /** 观察的目录 */
  watchDirs?: string[];
}

/**
 * 加载选项
 */
export interface OnLoadOptions {
  /** 过滤器（正则表达式或函数） */
  filter: RegExp | ((path: string) => boolean);
  /** 命名空间 */
  namespace?: string;
}

/**
 * 加载回调
 */
export type OnLoadCallback = (
  args: OnLoadArgs,
) => Promise<OnLoadResult | null | undefined> | OnLoadResult | null | undefined;

/**
 * 加载参数
 */
export interface OnLoadArgs {
  /** 文件路径 */
  path: string;
  /** 命名空间 */
  namespace: string;
  /** 后缀 */
  suffix?: string;
  /** 插件数据 */
  pluginData?: unknown;
}

/**
 * 加载结果
 */
export interface OnLoadResult {
  /** 文件内容 */
  contents?: string | Uint8Array;
  /** 加载器 */
  loader?: esbuild.Loader;
  /** 解析选项 */
  resolveDir?: string;
  /** 插件数据 */
  pluginData?: unknown;
  /** 警告 */
  warnings?: esbuild.PartialMessage[];
  /** 错误 */
  errors?: esbuild.PartialMessage[];
  /** 观察的文件 */
  watchFiles?: string[];
  /** 观察的目录 */
  watchDirs?: string[];
}

/**
 * 构建插件接口
 */
export interface BuildPlugin {
  /** 插件名称 */
  name: string;
  /** 插件设置函数 */
  setup(build: PluginBuild): void | Promise<void>;
}

/**
 * 插件管理器
 */
export class PluginManager {
  private plugins: BuildPlugin[] = [];

  /**
   * 注册插件
   */
  register(plugin: BuildPlugin): void {
    this.plugins.push(plugin);
  }

  /**
   * 注册多个插件
   */
  registerAll(plugins: BuildPlugin[]): void {
    this.plugins.push(...plugins);
  }

  /**
   * 获取所有插件
   */
  getPlugins(): BuildPlugin[] {
    return [...this.plugins];
  }

  /**
   * 清空所有插件
   */
  clear(): void {
    this.plugins = [];
  }

  /**
   * 转换为 esbuild 插件格式
   */
  toEsbuildPlugins(
    esbuildInstance: typeof esbuild,
    initialOptions: esbuild.BuildOptions,
  ): esbuild.Plugin[] {
    return this.plugins.map((plugin) => {
      const esbuildPlugin: esbuild.Plugin = {
        name: plugin.name,
        setup(build) {
          // 创建插件构建接口
          const pluginBuild: PluginBuild = {
            onResolve(options, callback) {
              const filter = typeof options.filter === "function"
                ? options.filter
                : options.filter;
              build.onResolve(
                {
                  filter,
                  namespace: options.namespace,
                },
                async (args) => {
                  const result = await callback({
                    path: args.path,
                    importer: args.importer,
                    namespace: args.namespace,
                    resolveDir: args.resolveDir,
                    kind: args.kind,
                    pluginData: args.pluginData,
                  });
                  if (!result) {
                    return undefined;
                  }
                  return {
                    path: result.path,
                    namespace: result.namespace,
                    external: result.external,
                    sideEffects: result.sideEffects,
                    pluginData: result.pluginData,
                    warnings: result.warnings,
                    errors: result.errors,
                    watchFiles: result.watchFiles,
                    watchDirs: result.watchDirs,
                  };
                },
              );
            },
            onLoad(options, callback) {
              // esbuild 的 filter 只支持 RegExp，不支持函数
              // 如果 filter 是函数，使用通配符匹配所有，然后在回调中手动过滤
              const filter = typeof options.filter === "function"
                ? /.*/
                : options.filter;
              build.onLoad(
                {
                  filter,
                  namespace: options.namespace,
                },
                async (args) => {
                  // 如果 filter 是函数，在这里进行额外过滤
                  if (
                    typeof options.filter === "function" &&
                    !options.filter(args.path)
                  ) {
                    return undefined;
                  }
                  const result = await callback({
                    path: args.path,
                    namespace: args.namespace,
                    suffix: args.suffix,
                    pluginData: args.pluginData,
                  });
                  if (!result) {
                    return undefined;
                  }
                  return {
                    contents: result.contents,
                    loader: result.loader,
                    resolveDir: result.resolveDir,
                    pluginData: result.pluginData,
                    warnings: result.warnings,
                    errors: result.errors,
                    watchFiles: result.watchFiles,
                    watchDirs: result.watchDirs,
                  };
                },
              );
            },
            esbuild: esbuildInstance,
            initialOptions,
          };

          // 调用插件的 setup 函数
          const setupResult = plugin.setup(pluginBuild);
          if (setupResult instanceof Promise) {
            return setupResult;
          }
        },
      };
      return esbuildPlugin;
    });
  }
}
