/**
 * @fileoverview CSS 导入处理插件
 *
 * 功能：
 * - 检测组件中的 CSS 导入（import "./styles.css"）
 * - 提取 CSS 文件路径
 * - 在构建时或运行时生成 <link> 标签并注入到 HTML
 */

import type { BuildPlugin, OnLoadArgs, OnLoadResult } from "../plugin.ts";

/**
 * CSS 导入处理选项
 */
export interface CSSImportHandlerOptions {
  /** 是否启用 CSS 提取（默认 true） */
  enabled?: boolean;
  /** CSS 文件输出目录（相对于输出目录） */
  cssOutputDir?: string;
  /** 是否提取到单独文件（默认 true，false 则内联） */
  extract?: boolean;
}

/**
 * CSS 导入处理插件实例
 *
 * 注意：为了兼容 BuildPlugin 接口，插件可以直接使用
 * 如果需要访问 CSS 文件列表，可以使用此接口
 */
export interface CSSImportHandlerPluginInstance extends BuildPlugin {
  /** 获取收集到的 CSS 文件路径 */
  getCSSFiles(): string[];
  /** 清空收集的 CSS 文件 */
  clearCSSFiles(): void;
}

/**
 * 创建 CSS 导入处理插件
 *
 * 此插件会：
 * 1. 检测 CSS 导入语句
 * 2. 将 CSS 文件标记为外部资源（不打包到 JS 中）
 * 3. 收集 CSS 文件路径，供后续生成 <link> 标签使用
 *
 * @param options 插件选项
 * @returns CSS 导入处理插件（可以直接作为 BuildPlugin 使用，也可以访问工具方法）
 */
export function createCSSImportHandlerPlugin(
  options: CSSImportHandlerOptions = {},
): CSSImportHandlerPluginInstance {
  const { enabled = true, extract = true } = options;

  // 收集到的 CSS 文件路径
  const cssFiles = new Set<string>();

  const plugin: BuildPlugin = {
    name: "css-import-handler",
    setup(build) {
      if (!enabled) {
        return;
      }

      // 拦截 CSS 文件的导入
      build.onResolve(
        { filter: /\.(css|scss|sass|less|styl)$/ },
        (args: any) => {
          // 标记为外部资源，不打包到 JS 中
          // 这样 CSS 文件会被单独处理
          if (extract) {
            // 收集 CSS 文件路径
            cssFiles.add(args.path);
            // 返回 undefined，继续处理，在 onLoad 中提取
            return undefined;
          }
          return undefined;
        },
      );

      // 处理 CSS 文件加载
      build.onLoad(
        { filter: /\.(css|scss|sass|less|styl)$/ },
        async (args: OnLoadArgs): Promise<OnLoadResult | null | undefined> => {
          // 收集 CSS 文件路径
          cssFiles.add(args.path);

          if (extract) {
            // 提取模式：返回空内容，CSS 文件会被单独处理
            // 实际文件会被复制到输出目录
            return {
              contents: "", // 空内容，不打包到 JS 中
              loader: "css",
            };
          } else {
            // 内联模式：读取 CSS 内容，返回为字符串
            const { readTextFile } = await import("@dreamer/runtime-adapter");
            try {
              const content = await readTextFile(args.path);
              // 将 CSS 内容作为字符串导出，供运行时使用
              return {
                contents: `export default ${JSON.stringify(content)};`,
                loader: "js",
              };
            } catch {
              return undefined;
            }
          }
        },
      );
    },
  };

  // 返回插件对象，同时添加工具方法
  return {
    name: plugin.name,
    setup: plugin.setup,
    /**
     * 获取收集到的 CSS 文件路径
     */
    getCSSFiles(): string[] {
      return Array.from(cssFiles);
    },
    /**
     * 清空收集的 CSS 文件
     */
    clearCSSFiles(): void {
      cssFiles.clear();
    },
  };
}
