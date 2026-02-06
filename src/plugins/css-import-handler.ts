/**
 * @fileoverview CSS 导入处理插件
 *
 * 功能：
 * - 检测组件中的 CSS 导入（import "./styles.css"）
 * - extract: true - 提取模式，收集 CSS 路径供后续生成 <link> 注入 HTML
 * - extract: false - 内联模式，CSS 打包进 JS，模块加载时自动注入 <style>
 */

import { join, readTextFile, resolve } from "@dreamer/runtime-adapter";
import type {
  BuildPlugin,
  OnLoadArgs,
  OnLoadResult,
  OnResolveArgs,
} from "../plugin.ts";

/**
 * CSS 导入处理选项
 */
export interface CSSImportHandlerOptions {
  /** 是否启用（默认 true） */
  enabled?: boolean;
  /** CSS 文件输出目录（相对于输出目录，仅 extract 模式有效） */
  cssOutputDir?: string;
  /** 是否提取到单独文件（默认 true），false 则内联进 JS 并自动注入 */
  extract?: boolean;
  /** 内联模式仅处理 .css（scss/sass/less/styl 需预处理器，默认 true） */
  cssOnly?: boolean;
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
/**
 * 简单 hash：用于 style 元素 id，防重复注入
 */
function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i) | 0;
  }
  return "d" + (h >>> 0).toString(36);
}

export function createCSSImportHandlerPlugin(
  options: CSSImportHandlerOptions = {},
): CSSImportHandlerPluginInstance {
  const { enabled = true, extract = true, cssOnly = true } = options;

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
        (args: OnResolveArgs) => {
          if (extract) {
            cssFiles.add(args.path);
          }
          return undefined;
        },
      );

      // 处理 CSS 文件加载
      build.onLoad(
        { filter: /\.(css|scss|sass|less|styl)$/ },
        async (args: OnLoadArgs & { resolveDir?: string }): Promise<OnLoadResult | null | undefined> => {
          cssFiles.add(args.path);

          if (extract) {
            return {
              contents: "",
              loader: "css",
            };
          }

          // 内联模式：仅处理 .css（scss/sass/less/styl 需预处理器）
          if (cssOnly && !/\.css$/i.test(args.path)) {
            return undefined;
          }

          try {
            let filePath = args.path;
            if (args.path.startsWith("./") || args.path.startsWith("../")) {
              const baseDir = args.resolveDir || ".";
              filePath = await resolve(join(baseDir, args.path));
            }
            const content = await readTextFile(filePath);
            const escaped = JSON.stringify(content);
            const hash = simpleHash(content);
            // 注入前检查 data-dweb-css-id，避免重复注入
            const injectCode = `const __css=${escaped};if(typeof document!=="undefined"){const id="dweb-css-${hash}";if(!document.getElementById(id)){const s=document.createElement("style");s.id=id;s.setAttribute("data-dweb-css-id",id);s.textContent=__css;(document.head||document.documentElement).appendChild(s);}}export default __css;`;
            return {
              contents: injectCode,
              loader: "js",
            };
          } catch {
            return undefined;
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
