/**
 * @module @dreamer/esbuild/plugins/deno-resolver
 *
 * Deno 模块解析插件
 *
 * 为 esbuild 提供 Deno 兼容的模块解析，支持：
 * - 读取 deno.json 的 exports 配置
 * - 解析 JSR 包的子路径导出（如 @dreamer/logger/client）
 * - 支持 jsr: 协议的模块引用（如 jsr:@dreamer/logger@^1.0.0）
 * - 支持 npm: 协议的模块引用（如 npm:esbuild@^0.27.2）
 * - 自动处理 Deno 模块的下载和缓存
 */

import {
  dirname,
  existsSync,
  join,
  readTextFile,
  readTextFileSync,
} from "@dreamer/runtime-adapter";
import * as esbuild from "esbuild";

/**
 * Deno 解析器选项
 */
export interface DenoResolverOptions {
  /** 是否启用插件（默认：true） */
  enabled?: boolean;
  /** 是否启用调试日志（默认：false） */
  debug?: boolean;
  /** node_modules 目录路径（默认：自动检测） */
  nodeModulesDir?: string;
}

/**
 * deno.json 配置结构
 */
interface DenoConfig {
  name?: string;
  version?: string;
  exports?: Record<string, string> | string;
  imports?: Record<string, string>;
}

/**
 * 解析 deno.json 的 exports 配置
 *
 * @param denoJsonPath - deno.json 文件路径
 * @param subpath - 子路径（如 "./client"）
 * @returns 解析后的文件路径，如果未找到返回 undefined
 */
function _resolveDenoExport(
  denoJsonPath: string,
  subpath: string,
): string | undefined {
  try {
    const content = readTextFileSync(denoJsonPath);
    const config: DenoConfig = JSON.parse(content);

    if (!config.exports) {
      return undefined;
    }

    // 如果 exports 是字符串，只能匹配 "."
    if (typeof config.exports === "string") {
      if (subpath === ".") {
        return config.exports;
      }
      return undefined;
    }

    // exports 是对象，查找对应的子路径
    const exportPath = config.exports[subpath];
    if (exportPath) {
      return exportPath;
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * 查找 node_modules 目录
 *
 * @param startDir - 起始目录
 * @returns node_modules 目录路径，如果未找到返回 undefined
 */
function _findNodeModulesDir(startDir: string): string | undefined {
  let currentDir = startDir;
  const maxDepth = 10; // 防止无限循环
  let depth = 0;

  while (depth < maxDepth) {
    const nodeModulesPath = join(currentDir, "node_modules");
    if (existsSync(nodeModulesPath)) {
      return nodeModulesPath;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      // 已到达根目录
      break;
    }
    currentDir = parentDir;
    depth++;
  }

  return undefined;
}

/**
 * 将包名转换为目录名
 * 例如：@dreamer/logger -> @dreamer/logger
 *
 * @param packageName - 包名
 * @returns 目录名
 */
function packageNameToDir(packageName: string): string {
  return packageName;
}

/**
 * 根据文件路径确定 esbuild loader
 *
 * @param filePath - 文件路径
 * @returns esbuild loader 类型
 */
function getLoaderFromPath(filePath: string): "ts" | "tsx" | "js" | "jsx" {
  if (filePath.endsWith(".tsx") || filePath.endsWith(".jsx")) {
    return "tsx";
  } else if (filePath.endsWith(".ts") || filePath.endsWith(".mts")) {
    return "ts";
  } else if (filePath.endsWith(".js") || filePath.endsWith(".mjs")) {
    return "js";
  }
  // 默认返回 ts，因为 Deno 主要使用 TypeScript
  return "ts";
}

/**
 * 查找项目的 deno.json 文件
 *
 * @param startDir - 起始目录
 * @returns deno.json 文件路径，如果未找到返回 undefined
 */
function findProjectDenoJson(startDir: string): string | undefined {
  let currentDir = startDir;
  const maxDepth = 10;
  let depth = 0;

  while (depth < maxDepth) {
    const denoJsonPath = join(currentDir, "deno.json");
    if (existsSync(denoJsonPath)) {
      return denoJsonPath;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
    depth++;
  }

  return undefined;
}

/**
 * 从项目的 deno.json 中获取包的导入映射
 *
 * @param projectDenoJsonPath - 项目的 deno.json 路径
 * @param packageName - 包名（如 @dreamer/logger）
 * @returns 包的导入路径（如 jsr:@dreamer/logger@^1.0.0-beta.4），如果未找到返回 undefined
 */
function getPackageImport(
  projectDenoJsonPath: string,
  packageName: string,
): string | undefined {
  try {
    const content = readTextFileSync(projectDenoJsonPath);
    const config: DenoConfig = JSON.parse(content);

    if (!config.imports) {
      return undefined;
    }

    return config.imports[packageName];
  } catch {
    return undefined;
  }
}

/**
 * 从 Deno 协议导入路径解析包的实际位置
 * 例如：jsr:@dreamer/logger@^1.0.0-beta.4 -> node_modules/@dreamer/logger
 * 例如：npm:esbuild@^0.27.2 -> node_modules/esbuild
 *
 * @param importPath - 导入路径（如 jsr:@dreamer/logger@^1.0.0-beta.4 或 npm:esbuild@^0.27.2）
 * @param nodeModulesDir - node_modules 目录
 * @returns 包的实际目录路径，如果未找到返回 undefined
 */
function _resolveDenoProtocolPackage(
  importPath: string,
  nodeModulesDir: string,
): string | undefined {
  // 解析 JSR 导入路径：jsr:@dreamer/logger@^1.0.0-beta.4
  // 解析 NPM 导入路径：npm:esbuild@^0.27.2
  if (importPath.startsWith("jsr:")) {
    const packageSpec = importPath.slice(4); // 移除 "jsr:"
    // 提取包名（@ 符号到 @ 或版本号之前）
    const atIndex = packageSpec.indexOf("@");
    if (atIndex > 0) {
      const packageName = packageSpec.slice(0, atIndex);
      const packageDir = join(nodeModulesDir, packageNameToDir(packageName));
      if (existsSync(packageDir)) {
        return packageDir;
      }
    }
  } else if (importPath.startsWith("npm:")) {
    const packageSpec = importPath.slice(4); // 移除 "npm:"
    // 提取包名（到 @ 或版本号之前）
    const atIndex = packageSpec.indexOf("@");
    if (atIndex > 0) {
      const packageName = packageSpec.slice(0, atIndex);
      const packageDir = join(nodeModulesDir, packageName);
      if (existsSync(packageDir)) {
        return packageDir;
      }
    } else {
      // 没有版本号的情况（较少见）
      const packageDir = join(nodeModulesDir, packageSpec);
      if (existsSync(packageDir)) {
        return packageDir;
      }
    }
  }

  return undefined;
}

/**
 * 创建 Deno 模块解析插件
 *
 * 该插件解决 esbuild 在 Deno 环境下无法正确解析 JSR 包子路径导出的问题。
 * esbuild 默认读取 package.json，但 Deno/JSR 包使用 deno.json 定义 exports。
 *
 * @param options - 插件选项
 * @returns esbuild 插件
 *
 * @example
 * ```typescript
 * import { buildBundle } from "@dreamer/esbuild";
 * import { createDenoResolverPlugin } from "@dreamer/esbuild/plugins/deno-resolver";
 *
 * const result = await buildBundle({
 *   entryPoint: "./src/client/mod.ts",
 *   plugins: [createDenoResolverPlugin()],
 * });
 * ```
 */
/**
 * 解析 Deno 协议路径（jsr: 或 npm:）
 * 通过动态导入让 Deno 下载和缓存模块，然后从缓存中读取
 *
 * @param protocolPath - Deno 协议路径（如 jsr:@dreamer/logger@^1.0.0-beta.4）
 * @param debug - 是否启用调试日志
 * @returns 解析结果
 */
async function resolveDenoProtocolPath(
  protocolPath: string,
  debug: boolean,
): Promise<esbuild.OnResolveResult | undefined> {
  if (debug) {
    console.log(`[deno-resolver] 解析 Deno 协议路径: ${protocolPath}`);
  }

  try {
    // 使用 import.meta.resolve 尝试解析路径
    const resolvedUrl = await import.meta.resolve(protocolPath);

    if (debug) {
      console.log(
        `[deno-resolver] import.meta.resolve 结果: ${protocolPath} -> ${resolvedUrl}`,
      );
    }

    // 如果返回的是 file:// URL，直接使用文件路径
    if (resolvedUrl.startsWith("file://")) {
      let filePath = resolvedUrl.slice(7);
      try {
        filePath = decodeURIComponent(filePath);
      } catch {
        // 忽略解码错误
      }

      if (existsSync(filePath)) {
        if (debug) {
          console.log(
            `[deno-resolver] 成功解析为文件路径: ${protocolPath} -> ${filePath}`,
          );
        }

        return {
          path: filePath,
          namespace: "file",
        };
      }
    } else if (
      resolvedUrl.startsWith("https://") ||
      resolvedUrl.startsWith("http://")
    ) {
      // 如果返回的是 HTTP URL（如 JSR 的网页 URL），不能直接使用
      // 因为 JSR 的 HTTP URL 返回的是 HTML 页面，不是源代码
      // 应该使用 deno-protocol namespace 让 Deno 通过动态导入来处理
      if (debug) {
        console.log(
          `[deno-resolver] 解析为 HTTP URL（可能是 JSR/NPM 网页），使用 deno-protocol namespace: ${resolvedUrl}`,
        );
      }

      // 使用 deno-protocol namespace，让 Deno 通过动态导入来下载和缓存模块
      return {
        path: protocolPath,
        namespace: "deno-protocol",
      };
    } else if (
      resolvedUrl.startsWith("jsr:") ||
      resolvedUrl.startsWith("npm:") ||
      resolvedUrl === protocolPath
    ) {
      // 如果返回的还是协议路径，说明 Deno 还没有下载/缓存这个模块
      // 这种情况下，我们需要使用 onLoad 钩子来触发下载并加载模块内容
      if (debug) {
        console.log(
          `[deno-resolver] 仍为协议路径，使用 onLoad 钩子触发下载: ${protocolPath}`,
        );
      }

      return {
        path: protocolPath,
        namespace: "deno-protocol",
      };
    }
  } catch (error) {
    if (debug) {
      console.log(
        `[deno-resolver] import.meta.resolve 失败:`,
        error,
      );
    }
    // 如果 resolve 失败，尝试使用 onLoad 钩子
    if (debug) {
      console.log(
        `[deno-resolver] resolve 失败，使用 onLoad 钩子作为后备: ${protocolPath}`,
      );
    }
    return {
      path: protocolPath,
      namespace: "deno-protocol",
    };
  }

  return undefined;
}

export function createDenoResolverPlugin(
  options: DenoResolverOptions = {},
): esbuild.Plugin {
  const { enabled = true, debug = false } = options;

  return {
    name: "deno-resolver",
    setup(build) {
      if (!enabled) {
        return;
      }

      // 1. 处理路径别名（通过 deno.json imports 配置）
      // 例如：import { x } from "@/utils.ts"
      // 例如：import { x } from "~/config.ts"
      // 这些别名需要在 deno.json 的 imports 中配置
      build.onResolve(
        { filter: /^(@\/|~\/|@[^/]+\/|~[^/]+\/)/ },
        (args): esbuild.OnResolveResult | undefined => {
          const path = args.path;

          if (debug) {
            console.log(`[deno-resolver] 检测到路径别名: ${path}`);
          }

          // 查找项目的 deno.json 文件
          const resolveDir = args.resolveDir || Deno.cwd();
          const projectDenoJsonPath = findProjectDenoJson(resolveDir);

          if (!projectDenoJsonPath) {
            if (debug) {
              console.log(`[deno-resolver] 未找到项目的 deno.json`);
            }
            return undefined;
          }

          // 从项目的 deno.json 的 imports 中查找路径别名
          try {
            const content = readTextFileSync(projectDenoJsonPath);
            const config: DenoConfig = JSON.parse(content);

            if (!config.imports) {
              if (debug) {
                console.log(`[deno-resolver] deno.json 中没有 imports 配置`);
              }
              return undefined;
            }

            // 查找匹配的别名
            // 优先匹配最长的前缀（如 @/lib/ 优先于 @/）
            const sortedKeys = Object.keys(config.imports).sort((a, b) =>
              b.length - a.length
            );

            for (const alias of sortedKeys) {
              if (path.startsWith(alias)) {
                const aliasValue = config.imports[alias];
                if (aliasValue) {
                  // 替换别名前缀
                  const remainingPath = path.slice(alias.length);
                  let resolvedPath: string;

                  // 如果别名值以 ./ 或 ../ 开头，是相对路径
                  if (
                    aliasValue.startsWith("./") || aliasValue.startsWith("../")
                  ) {
                    const denoJsonDir = dirname(projectDenoJsonPath);
                    resolvedPath = join(denoJsonDir, aliasValue, remainingPath);
                  } else {
                    // 如果别名值是绝对路径或其他格式
                    resolvedPath = aliasValue + remainingPath;
                  }

                  if (debug) {
                    console.log(
                      `[deno-resolver] 路径别名解析: ${path} -> ${resolvedPath} (别名: ${alias} -> ${aliasValue})`,
                    );
                  }

                  // 检查文件是否存在
                  if (existsSync(resolvedPath)) {
                    return {
                      path: resolvedPath,
                      namespace: "file",
                    };
                  } else {
                    // 尝试添加 .ts 扩展名
                    const withExt = resolvedPath + ".ts";
                    if (existsSync(withExt)) {
                      return {
                        path: withExt,
                        namespace: "file",
                      };
                    }
                  }
                }
              }
            }

            if (debug) {
              console.log(`[deno-resolver] 未找到匹配的路径别名: ${path}`);
            }
          } catch (error) {
            if (debug) {
              console.log(`[deno-resolver] 解析路径别名失败:`, error);
            }
          }

          return undefined;
        },
      );

      // 2. 处理直接的 jsr: 和 npm: 协议导入
      // 例如：import { x } from "jsr:@dreamer/logger@^1.0.0-beta.4"
      // 例如：import { x } from "npm:esbuild@^0.27.2"
      build.onResolve(
        { filter: /^(jsr|npm):/ },
        async (args): Promise<esbuild.OnResolveResult | undefined> => {
          const path = args.path;

          if (debug) {
            console.log(`[deno-resolver] 检测到 Deno 协议导入: ${path}`);
          }

          return await resolveDenoProtocolPath(path, debug);
        },
      );

      // 2. 匹配带有子路径的 @scope/package/subpath 模式
      // 例如：@dreamer/logger/client
      build.onResolve(
        { filter: /^@[^/]+\/[^/]+\/.+$/ },
        async (args): Promise<esbuild.OnResolveResult | undefined> => {
          const path = args.path;

          if (debug) {
            console.log(`[deno-resolver] 尝试解析: ${path}`);
          }

          // 解析包名和子路径
          // @dreamer/logger/client -> packageName: @dreamer/logger, subpath: client
          const parts = path.split("/");
          const packageName = `${parts[0]}/${parts[1]}`;
          const subpathParts = parts.slice(2); // ["client"] 或 ["client", "utils"] 等多级

          // 查找项目的 deno.json 文件
          const resolveDir = args.resolveDir || Deno.cwd();
          const projectDenoJsonPath = findProjectDenoJson(resolveDir);

          if (!projectDenoJsonPath) {
            if (debug) {
              console.log(`[deno-resolver] 未找到项目的 deno.json`);
            }
            return undefined;
          }

          // 从项目的 deno.json 的 imports 中获取包的导入映射
          const packageImport = getPackageImport(
            projectDenoJsonPath,
            packageName,
          );

          if (!packageImport) {
            if (debug) {
              console.log(
                `[deno-resolver] 未在 deno.json 的 imports 中找到: ${packageName}`,
              );
            }
            return undefined;
          }

          if (debug) {
            console.log(
              `[deno-resolver] 找到导入映射: ${packageName} -> ${packageImport}`,
            );
          }

          // 拼接子路径到导入路径
          // 例如：jsr:@dreamer/logger@^1.0.0-beta.4 + /client -> jsr:@dreamer/logger@^1.0.0-beta.4/client
          // 例如：npm:lodash@^4.17.21 + /map -> npm:lodash@^4.17.21/map
          const subpath = subpathParts.join("/");
          const fullProtocolPath = `${packageImport}/${subpath}`;

          if (debug) {
            console.log(
              `[deno-resolver] 拼接后的协议路径: ${fullProtocolPath}`,
            );
          }

          // 使用统一的协议路径解析函数
          return await resolveDenoProtocolPath(fullProtocolPath, debug);
        },
      );

      // 3. 添加 onLoad 钩子来处理 deno-protocol namespace 的模块加载
      // 统一处理 jsr: 和 npm: 协议的模块加载
      build.onLoad(
        { filter: /.*/, namespace: "deno-protocol" },
        async (args): Promise<esbuild.OnLoadResult | undefined> => {
          const protocolPath = args.path;

          if (debug) {
            console.log(
              `[deno-resolver] onLoad 加载 Deno 协议模块: ${protocolPath}`,
            );
          }

          try {
            // 步骤 1: 先使用动态导入触发 Deno 下载和缓存模块
            // 这会确保模块被下载到 Deno 缓存中（适用于 jsr: 和 npm:）
            await import(protocolPath);

            // 步骤 2: 等待一小段时间，确保文件系统操作完成
            await new Promise((resolve) => setTimeout(resolve, 100));

            // 步骤 3: 再次尝试使用 import.meta.resolve 获取文件路径
            // 动态导入后，Deno 应该已经缓存了模块，resolve 应该能返回文件路径
            let fileUrl: string | undefined;
            try {
              fileUrl = await import.meta.resolve(protocolPath);
              if (debug) {
                console.log(
                  `[deno-resolver] onLoad 中 resolve 结果: ${protocolPath} -> ${fileUrl}`,
                );
              }
            } catch (resolveError) {
              if (debug) {
                console.log(
                  `[deno-resolver] onLoad 中 resolve 失败:`,
                  resolveError,
                );
              }
            }

            // 步骤 4: 如果 resolve 返回 file:// URL，读取文件内容
            if (fileUrl && fileUrl.startsWith("file://")) {
              let filePath = fileUrl.slice(7);
              try {
                filePath = decodeURIComponent(filePath);
              } catch {
                // 忽略解码错误
              }

              if (existsSync(filePath)) {
                const contents = await readTextFile(filePath);

                // 根据文件扩展名确定 loader
                const loader = getLoaderFromPath(filePath);

                if (debug) {
                  console.log(
                    `[deno-resolver] 成功读取文件: ${filePath} (loader: ${loader})`,
                  );
                }

                return {
                  contents,
                  loader,
                };
              } else {
                if (debug) {
                  console.log(
                    `[deno-resolver] 文件不存在: ${filePath}`,
                  );
                }
              }
            } else if (
              fileUrl &&
              (fileUrl.startsWith("https://") || fileUrl.startsWith("http://"))
            ) {
              // 步骤 5: 如果 resolve 返回 HTTP URL，使用 fetch 获取内容
              // 这种情况可能发生在 Deno 还没有完全缓存模块时
              // 注意：对于 JSR/NPM 的 HTTP URL，通常返回的是 HTML 页面，不是源代码
              // 所以这里应该尽量避免使用
              if (debug) {
                console.log(
                  `[deno-resolver] resolve 返回 HTTP URL，尝试使用 fetch: ${fileUrl}`,
                );
              }
              try {
                const response = await fetch(fileUrl);
                if (response.ok) {
                  const contents = await response.text();
                  const loader = getLoaderFromPath(fileUrl);
                  return {
                    contents,
                    loader,
                  };
                }
              } catch (fetchError) {
                if (debug) {
                  console.log(
                    `[deno-resolver] fetch 失败:`,
                    fetchError,
                  );
                }
              }
            }

            // 如果所有方法都失败，返回错误
            if (debug) {
              console.log(
                `[deno-resolver] 无法获取 Deno 协议模块的文件内容: ${protocolPath}`,
              );
            }

            return undefined;
          } catch (error) {
            if (debug) {
              console.log(
                `[deno-resolver] 加载 Deno 协议模块失败: ${protocolPath}`,
                error,
              );
            }
            return undefined;
          }
        },
      );
    },
  };
}
