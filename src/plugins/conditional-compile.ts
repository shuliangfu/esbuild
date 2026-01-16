/**
 * @module @dreamer/esbuild/plugins/conditional-compile
 *
 * 条件编译插件（方案二）
 *
 * 支持类似 #ifdef CLIENT / #endif 的条件编译指令
 *
 * 依赖移除机制：
 * 1. 条件编译块内的 import 语句会被直接移除（因为整个块被移除）
 * 2. 块外的 import 如果只在块内使用，会被 esbuild 的 tree-shaking 自动移除
 * 3. 服务端模块会被 server-module-detector 插件自动标记为 external
 */

import type { BuildPlugin, OnLoadArgs, OnLoadResult } from "../plugin.ts";
import { logger } from "../utils/logger.ts";

/**
 * 条件编译插件选项
 */
export interface ConditionalCompileOptions {
  /** 目标平台（默认：CLIENT） */
  target?: "CLIENT" | "SERVER";
  /** 是否启用条件编译（默认：true） */
  enabled?: boolean;
}

/**
 * 创建条件编译插件
 *
 * 支持以下语法：
 * - `// #ifdef CLIENT` - 客户端代码块开始
 * - `// #ifdef SERVER` - 服务端代码块开始
 * - `// #else` - 否则分支
 * - `// #endif` - 代码块结束
 *
 * @example
 * ```typescript
 * // #ifdef CLIENT
 * export const clientOnlyCode = () => {
 *   console.log("This is client code");
 * };
 * // #endif
 *
 * // #ifdef SERVER
 * import { db } from "./database.ts";  // 这行在客户端构建时会被移除
 * export const serverOnlyCode = () => {
 *   console.log("This is server code");
 * };
 * // #endif
 * ```
 *
 * **依赖移除说明**：
 * - 条件编译块内的 import 语句会被直接移除（因为整个块被移除）
 * - 块外的 import 如果只在块内使用，会被 esbuild 的 tree-shaking 自动移除
 * - 服务端模块会被 server-module-detector 插件自动标记为 external
 *
 * @param options 插件选项
 * @returns 条件编译插件
 */
export function createConditionalCompilePlugin(
  options: ConditionalCompileOptions = {},
): BuildPlugin {
  const { target = "CLIENT", enabled = true } = options;

  return {
    name: "conditional-compile",
    setup(build) {
      if (!enabled) {
        return;
      }

      // 处理所有 TypeScript/JavaScript 文件
      build.onLoad(
        {
          filter: /\.(ts|tsx|js|jsx|mjs|cjs)$/,
        },
        async (args: OnLoadArgs): Promise<OnLoadResult | null | undefined> => {
          // 读取文件内容
          const { readTextFile } = await import("@dreamer/runtime-adapter");
          let contents: string;
          try {
            contents = await readTextFile(args.path);
          } catch {
            // 如果读取失败，返回 undefined 让其他插件处理
            return undefined;
          }

          // 处理条件编译指令
          const processedContents = processConditionalCompile(
            contents,
            target,
          );

          // 如果内容没有变化，返回 undefined（让 esbuild 使用原始文件）
          if (processedContents === contents) {
            return undefined;
          }

          // 返回处理后的内容
          return {
            contents: processedContents,
            loader: args.path.endsWith(".tsx") || args.path.endsWith(".jsx")
              ? "tsx"
              : args.path.endsWith(".ts") || args.path.endsWith(".mts")
              ? "ts"
              : "js",
          };
        },
      );
    },
  };
}

/**
 * 处理条件编译指令
 *
 * 功能说明：
 * 1. 移除不匹配目标平台的条件编译块（包括块内的所有代码和 import 语句）
 * 2. 保留匹配目标平台的代码块
 * 3. 依赖移除机制：
 *    - 条件编译块内的 import 会被直接移除（因为整个块被移除）
 *    - 块外的 import 如果只在块内使用，会被 esbuild 的 tree-shaking 自动移除
 *    - 服务端模块会被 server-module-detector 插件标记为 external，不会被打包
 *
 * @param content 原始文件内容
 * @param target 目标平台
 * @returns 处理后的文件内容
 */
function processConditionalCompile(
  content: string,
  target: "CLIENT" | "SERVER",
): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let inConditionalBlock = false;
  let currentCondition: "CLIENT" | "SERVER" | null = null;
  let inElseBlock = false;
  let blockDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 检测条件编译指令
    if (trimmed.startsWith("//") || trimmed.startsWith("/*")) {
      // 单行注释：// #ifdef CLIENT
      if (trimmed.match(/\/\/\s*#ifdef\s+(CLIENT|SERVER)/)) {
        const match = trimmed.match(/#ifdef\s+(CLIENT|SERVER)/);
        if (match) {
          const condition = match[1] as "CLIENT" | "SERVER";
          inConditionalBlock = true;
          currentCondition = condition;
          inElseBlock = false;
          blockDepth++;
          // 不添加这一行到结果中
          continue;
        }
      }

      // 单行注释：// #else
      if (trimmed.match(/\/\/\s*#else/)) {
        if (inConditionalBlock && currentCondition) {
          inElseBlock = true;
          // 不添加这一行到结果中
          continue;
        }
      }

      // 单行注释：// #endif
      if (trimmed.match(/\/\/\s*#endif/)) {
        if (inConditionalBlock) {
          blockDepth--;
          if (blockDepth === 0) {
            inConditionalBlock = false;
            currentCondition = null;
            inElseBlock = false;
          }
          // 不添加这一行到结果中
          continue;
        }
      }

      // 多行注释：/* #ifdef CLIENT */
      if (trimmed.match(/\/\*\s*#ifdef\s+(CLIENT|SERVER)\s*\*\//)) {
        const match = trimmed.match(/#ifdef\s+(CLIENT|SERVER)/);
        if (match) {
          const condition = match[1] as "CLIENT" | "SERVER";
          inConditionalBlock = true;
          currentCondition = condition;
          inElseBlock = false;
          blockDepth++;
          // 不添加这一行到结果中
          continue;
        }
      }

      // 多行注释：/* #else */
      if (trimmed.match(/\/\*\s*#else\s*\*\//)) {
        if (inConditionalBlock && currentCondition) {
          inElseBlock = true;
          // 不添加这一行到结果中
          continue;
        }
      }

      // 多行注释：/* #endif */
      if (trimmed.match(/\/\*\s*#endif\s*\*\//)) {
        if (inConditionalBlock) {
          blockDepth--;
          if (blockDepth === 0) {
            inConditionalBlock = false;
            currentCondition = null;
            inElseBlock = false;
          }
          // 不添加这一行到结果中
          continue;
        }
      }
    }

    // 处理条件编译块内的代码
    if (inConditionalBlock) {
      // 如果当前条件匹配目标平台，保留代码（包括 import 语句）
      if (currentCondition === target && !inElseBlock) {
        result.push(line);
      } // 如果当前条件不匹配，但在 else 块中，保留代码
      else if (currentCondition !== target && inElseBlock) {
        result.push(line);
      }
      // 否则，跳过这一行（不添加到结果中）
      // 注意：如果这是 import 语句，也会被跳过，从而移除相关依赖
      // 例如：// #ifdef SERVER
      //       import { db } from "./database.ts";  // 这行会被移除
      //       // #endif
    } else {
      // 不在条件编译块中，保留所有代码
      // 注意：如果 import 在块外，但只在块内使用，esbuild 的 tree-shaking 会自动移除
      result.push(line);
    }
  }

  // 如果还有未关闭的条件编译块，发出警告
  if (inConditionalBlock) {
    logger.warn(
      "条件编译警告：检测到未关闭的条件编译块（#ifdef 没有对应的 #endif）",
    );
  }

  return result.join("\n");
}
