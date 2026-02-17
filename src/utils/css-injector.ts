/**
 * @fileoverview CSS 注入工具
 *
 * 功能：
 * - 将 CSS 文件路径转换为 <link> 标签
 * - 注入到 HTML 的 <head> 中
 * - 支持 SSR 和 CSR 场景
 */

import { resolve } from "@dreamer/runtime-adapter";
import { initEsbuildI18n } from "../i18n.ts";

initEsbuildI18n();

/**
 * 注入 HTML 内容到指定位置（简化版实现）
 *
 * 注意：如果项目中有 @dreamer/render，可以使用其 injectHtml 函数获得更强大的功能
 */
function injectHtml(
  html: string,
  content: string,
  options: { inHead?: boolean } = {},
): string {
  if (!content) {
    return html;
  }

  const { inHead = false } = options;

  if (inHead) {
    // 注入到 </head> 之前
    const headEndIndex = html.indexOf("</head>");
    if (headEndIndex !== -1) {
      const beforeHead = html.slice(0, headEndIndex);
      const afterHead = html.slice(headEndIndex);
      return `${beforeHead}\n    ${content}\n${afterHead}`;
    }
    // 如果没有 </head>，尝试在 <head> 之后注入
    const headStartIndex = html.indexOf("<head>");
    if (headStartIndex !== -1) {
      const beforeHead = html.slice(0, headStartIndex + 6);
      const afterHead = html.slice(headStartIndex + 6);
      return `${beforeHead}\n    ${content}\n${afterHead}`;
    }
  } else {
    // 注入到 </body> 之前
    const bodyEndIndex = html.indexOf("</body>");
    if (bodyEndIndex !== -1) {
      const beforeBody = html.slice(0, bodyEndIndex);
      const afterBody = html.slice(bodyEndIndex);
      return `${beforeBody}\n    ${content}\n${afterBody}`;
    }
  }

  return html;
}

/**
 * CSS 文件信息
 */
export interface CSSFileInfo {
  /** CSS 文件路径（相对或绝对） */
  path: string;
  /** 是否为外部 CSS（node_modules） */
  external?: boolean;
  /** 自定义属性（如 media, crossorigin 等） */
  attributes?: Record<string, string>;
}

/**
 * CSS 注入选项
 */
export interface CSSInjectOptions {
  /** 输出目录（用于计算相对路径） */
  outputDir?: string;
  /** 公共路径前缀（如 /assets/） */
  publicPath?: string;
  /** 是否去重（默认 true） */
  dedupe?: boolean;
}

/**
 * 将 CSS 文件路径转换为 <link> 标签
 *
 * @param cssFile CSS 文件信息
 * @param options 注入选项
 * @returns <link> 标签字符串
 */
export function generateCSSTag(
  cssFile: CSSFileInfo | string,
  options: CSSInjectOptions = {},
): string {
  const { publicPath = "" } = options;

  // 如果传入的是字符串，转换为 CSSFileInfo
  const fileInfo: CSSFileInfo = typeof cssFile === "string"
    ? { path: cssFile }
    : cssFile;

  const { path, attributes = {} } = fileInfo;

  // 构建 href 路径
  let href = path;
  if (
    publicPath && !path.startsWith("http://") && !path.startsWith("https://")
  ) {
    // 确保 publicPath 以 / 结尾，path 不以 / 开头
    const base = publicPath.endsWith("/")
      ? publicPath.slice(0, -1)
      : publicPath;
    const file = path.startsWith("/") ? path : `/${path}`;
    href = `${base}${file}`;
  }

  // 构建属性字符串
  const attrs = Object.entries(attributes)
    .map(([key, value]) => `${key}="${value}"`)
    .join(" ");

  return `<link rel="stylesheet" href="${href}"${attrs ? ` ${attrs}` : ""}>`;
}

/**
 * 将多个 CSS 文件转换为 <link> 标签
 *
 * @param cssFiles CSS 文件列表
 * @param options 注入选项
 * @returns <link> 标签字符串（多个标签，用换行分隔）
 */
export function generateCSSTags(
  cssFiles: (CSSFileInfo | string)[],
  options: CSSInjectOptions = {},
): string {
  const { dedupe = true } = options;

  // 去重
  let uniqueFiles: (CSSFileInfo | string)[] = cssFiles;
  if (dedupe) {
    const seen = new Set<string>();
    uniqueFiles = cssFiles.filter((file) => {
      const path = typeof file === "string" ? file : file.path;
      if (seen.has(path)) {
        return false;
      }
      seen.add(path);
      return true;
    });
  }

  // 生成标签
  return uniqueFiles
    .map((file) => generateCSSTag(file, options))
    .join("\n    "); // 4 空格缩进
}

/**
 * 将 CSS <link> 标签注入到 HTML
 *
 * @param html 原始 HTML
 * @param cssFiles CSS 文件列表
 * @param options 注入选项
 * @returns 注入后的 HTML
 */
export function injectCSSIntoHTML(
  html: string,
  cssFiles: (CSSFileInfo | string)[],
  options: CSSInjectOptions = {},
): string {
  if (cssFiles.length === 0) {
    return html;
  }

  // 生成 CSS 标签
  const cssTags = generateCSSTags(cssFiles, options);

  // 注入到 <head> 中
  return injectHtml(html, cssTags, {
    inHead: true,
  });
}

/**
 * 从组件依赖中提取 CSS 文件并注入到 HTML
 *
 * @param html 原始 HTML
 * @param dependencies 组件依赖信息（来自 ComponentAnalyzer）
 * @param options 注入选项
 * @returns 注入后的 HTML
 */
export function injectCSSFromDependencies(
  html: string,
  dependencies: {
    styles: Array<{ path: string; external?: boolean }>;
  },
  options: CSSInjectOptions = {},
): string {
  const cssFiles: CSSFileInfo[] = dependencies.styles.map((style) => ({
    path: style.path,
    external: style.external,
  }));

  return injectCSSIntoHTML(html, cssFiles, options);
}

/**
 * 计算 CSS 文件的相对路径（相对于输出目录）
 *
 * @param cssPath CSS 文件路径
 * @param outputDir 输出目录
 * @returns 相对路径
 */
export async function getCSSRelativePath(
  cssPath: string,
  outputDir: string,
): Promise<string> {
  try {
    const resolved = await resolve(cssPath);
    const outputResolved = await resolve(outputDir);

    // 如果 CSS 文件在输出目录中，计算相对路径
    if (resolved.startsWith(outputResolved)) {
      const relative = resolved.slice(outputResolved.length);
      return relative.startsWith("/") ? relative.slice(1) : relative;
    }

    // 否则返回原始路径
    return cssPath;
  } catch {
    return cssPath;
  }
}
