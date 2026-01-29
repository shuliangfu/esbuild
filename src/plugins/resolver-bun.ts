/**
 * @module @dreamer/esbuild/plugins/resolver-bun
 *
 * Bun 环境下的模块解析插件（用于 bun + esbuild）
 *
 * 为 esbuild 在 Bun 环境下提供模块解析，支持：
 * - 读取 package.json 的 imports 配置（路径别名和包导入映射）
 * - 读取 tsconfig.json 的 paths 配置（路径别名，作为后备）
 * - 解析 JSR 包的子路径导出（如 @dreamer/logger/client）
 *   - 注意：Bun 不支持直接使用 jsr: 协议，需要通过 package.json imports 映射
 *   - 例如：package.json 中配置 "@dreamer/logger": "jsr:@scope/package@^1.0.0-beta.1"
 *   - 然后代码中使用：import { x } from "@dreamer/logger/client"
 * - 支持 npm: 协议的模块引用（如 npm:esbuild@^0.27.2）
 *
 * 重要：Bun 不支持直接使用 jsr: 协议导入，必须通过 package.json 的 imports 字段映射
 */

import {
  cwd,
  dirname,
  existsSync,
  join,
  readTextFile,
  readTextFileSync,
} from "@dreamer/runtime-adapter";
import * as esbuild from "esbuild";

/**
 * 解析器选项
 */
export interface ResolverOptions {
  /** 是否启用插件（默认：true） */
  enabled?: boolean;
  /** 浏览器模式：将 jsr: 和 npm: 依赖转换为 CDN URL（如 esm.sh） */
  browserMode?: boolean;
}

/**
 * 将 npm: 或 jsr: specifier 转换为浏览器可用的 URL (esm.sh)
 * @param specifier npm: 或 jsr: specifier
 * @returns 浏览器可用的 URL
 */
function convertSpecifierToBrowserUrl(specifier: string): string | null {
  // 处理 npm: 前缀
  if (specifier.startsWith("npm:")) {
    const pkg = specifier.slice(4);
    return `https://esm.sh/${pkg}`;
  }

  // 处理 jsr: 前缀
  if (specifier.startsWith("jsr:")) {
    // jsr:@scope/pkg -> https://esm.sh/jsr/@scope/pkg
    const pkg = specifier.slice(4);
    return `https://esm.sh/jsr/${pkg}`;
  }

  // 如果已经是 http/https URL，直接返回
  if (specifier.startsWith("http:") || specifier.startsWith("https:")) {
    return specifier;
  }

  return null;
}

/**
 * package.json 配置结构
 */
interface PackageJsonConfig {
  imports?: Record<string, string>;
}

/**
 * tsconfig.json 配置结构
 */
interface TsconfigConfig {
  compilerOptions?: {
    baseUrl?: string;
    paths?: Record<string, string[]>;
  };
}

/**
 * 查找项目的 package.json 文件
 *
 * @param startDir - 起始目录
 * @returns package.json 文件路径，如果未找到返回 undefined
 */
function findProjectPackageJson(startDir: string): string | undefined {
  let currentDir = startDir;
  const maxDepth = 10;
  let depth = 0;

  while (depth < maxDepth) {
    const packageJsonPath = join(currentDir, "package.json");
    if (existsSync(packageJsonPath)) {
      return packageJsonPath;
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
 * 查找项目的 tsconfig.json 文件
 *
 * @param startDir - 起始目录
 * @returns tsconfig.json 文件路径，如果未找到返回 undefined
 */
function findProjectTsconfig(startDir: string): string | undefined {
  let currentDir = startDir;
  const maxDepth = 10;
  let depth = 0;

  while (depth < maxDepth) {
    const tsconfigPath = join(currentDir, "tsconfig.json");
    if (existsSync(tsconfigPath)) {
      return tsconfigPath;
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
 * 从项目的 package.json 中获取包的导入映射
 *
 * @param projectPackageJsonPath - 项目的 package.json 路径
 * @param packageName - 包名（如 @dreamer/logger）
 * @returns 包的导入路径（如 jsr:@scope/package@^1.0.0-beta.1），如果未找到返回 undefined
 */
function getPackageImport(
  projectPackageJsonPath: string,
  packageName: string,
): string | undefined {
  try {
    const content = readTextFileSync(projectPackageJsonPath);
    const config: PackageJsonConfig = JSON.parse(content);

    if (!config.imports) {
      return undefined;
    }

    return config.imports[packageName];
  } catch {
    return undefined;
  }
}

/**
 * 解析路径别名（从 package.json imports 或 tsconfig.json paths）
 *
 * @param path - 路径别名（如 @/utils.ts 或 ~/config.ts）
 * @param startDir - 起始目录
 * @returns 解析后的文件路径，如果未找到返回 undefined
 */
function resolvePathAlias(
  path: string,
  startDir: string,
): string | undefined {
  // 1. 优先尝试 package.json 的 imports
  const packageJsonPath = findProjectPackageJson(startDir);
  if (packageJsonPath) {
    try {
      const content = readTextFileSync(packageJsonPath);
      const config: PackageJsonConfig = JSON.parse(content);

      if (config.imports) {
        // 查找匹配的别名，优先匹配最长的前缀
        const sortedKeys = Object.keys(config.imports).sort((a, b) =>
          b.length - a.length
        );

        for (const alias of sortedKeys) {
          if (path.startsWith(alias)) {
            const aliasValue = config.imports[alias];
            if (aliasValue) {
              const remainingPath = path.slice(alias.length);
              let resolvedPath: string;

              // 如果别名值以 ./ 或 ../ 开头，是相对路径
              if (
                aliasValue.startsWith("./") || aliasValue.startsWith("../")
              ) {
                const packageJsonDir = dirname(packageJsonPath);
                resolvedPath = join(packageJsonDir, aliasValue, remainingPath);
              } else {
                // 如果别名值是绝对路径或其他格式
                resolvedPath = aliasValue + remainingPath;
              }

              // 检查文件是否存在
              if (existsSync(resolvedPath)) {
                return resolvedPath;
              } else {
                // 尝试添加 .ts 扩展名
                const withExt = resolvedPath + ".ts";
                if (existsSync(withExt)) {
                  return withExt;
                }
              }
            }
          }
        }
      }
    } catch {
      // 忽略错误
    }
  }

  // 2. 后备：尝试 tsconfig.json 的 paths
  const tsconfigPath = findProjectTsconfig(startDir);
  if (tsconfigPath) {
    try {
      const content = readTextFileSync(tsconfigPath);
      const config: TsconfigConfig = JSON.parse(content);

      if (config.compilerOptions?.paths) {
        const baseUrl = config.compilerOptions.baseUrl
          ? join(dirname(tsconfigPath), config.compilerOptions.baseUrl)
          : dirname(tsconfigPath);

        // 查找匹配的路径别名
        for (
          const [pattern, paths] of Object.entries(
            config.compilerOptions.paths,
          )
        ) {
          // 处理通配符模式，如 "@/*" -> ["src/*"]
          if (pattern.endsWith("/*")) {
            const prefix = pattern.slice(0, -2);
            if (path.startsWith(prefix + "/")) {
              const remainingPath = path.slice(prefix.length + 1);
              for (const mappedPath of paths) {
                if (mappedPath.endsWith("/*")) {
                  const mappedPrefix = mappedPath.slice(0, -2);
                  const resolvedPath = join(
                    baseUrl,
                    mappedPrefix,
                    remainingPath,
                  );
                  if (existsSync(resolvedPath)) {
                    return resolvedPath;
                  } else {
                    // 尝试添加 .ts 扩展名
                    const withExt = resolvedPath + ".ts";
                    if (existsSync(withExt)) {
                      return withExt;
                    }
                  }
                }
              }
            }
          } else if (path === pattern || path.startsWith(pattern + "/")) {
            // 精确匹配或前缀匹配
            for (const mappedPath of paths) {
              const remainingPath = path.slice(pattern.length);
              const resolvedPath = join(baseUrl, mappedPath, remainingPath);
              if (existsSync(resolvedPath)) {
                return resolvedPath;
              } else {
                // 尝试添加 .ts 扩展名
                const withExt = resolvedPath + ".ts";
                if (existsSync(withExt)) {
                  return withExt;
                }
              }
            }
          }
        }
      }
    } catch {
      // 忽略错误
    }
  }

  return undefined;
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
  // 默认返回 ts
  return "ts";
}

/**
 * 解析 Bun 协议路径（仅支持 npm:）
 * Bun 原生支持 npm: 协议，可以直接使用 import.meta.resolve
 * 注意：Bun 不支持 jsr: 协议，此函数不应被用于 jsr: 协议
 *
 * @param protocolPath - 协议路径（如 npm:esbuild@^0.27.2）
 * @returns 解析结果
 */
async function resolveBunProtocolPath(
  protocolPath: string,
): Promise<esbuild.OnResolveResult | undefined> {
  try {
    // Bun 原生支持 npm: 协议，可以直接解析
    // 注意：Bun 不支持 jsr: 协议，如果传入 jsr: 协议，resolve 会失败
    const resolvedUrl = await import.meta.resolve(protocolPath);

    // 如果返回的是 file:// URL，直接使用文件路径
    if (resolvedUrl.startsWith("file://")) {
      let filePath = resolvedUrl.slice(7);
      try {
        filePath = decodeURIComponent(filePath);
      } catch {
        // 忽略解码错误
      }

      if (filePath && existsSync(filePath)) {
        // 返回文件路径，esbuild 会自动从文件路径推断 resolveDir
        return {
          path: filePath,
          namespace: "file",
        };
      } else if (filePath) {
        // 文件路径存在但文件不存在，使用 bun-protocol namespace
        return {
          path: protocolPath,
          namespace: "bun-protocol",
        };
      }
    }

    // 如果返回的是其他格式（如协议路径本身），使用 bun-protocol namespace
    return {
      path: protocolPath,
      namespace: "bun-protocol",
    };
  } catch {
    // 如果 resolve 失败，使用 bun-protocol namespace
    return {
      path: protocolPath,
      namespace: "bun-protocol",
    };
  }
}

/**
 * 创建 Bun 模块解析插件
 *
 * 该插件解决 esbuild 在 Bun 环境下无法正确解析路径别名和 JSR 包子路径导出的问题。
 * 使用 package.json 的 imports 和 tsconfig.json 的 paths 来处理路径别名。
 *
 * @param options - 插件选项
 * @returns esbuild 插件
 *
 * @example
 * ```typescript
 * import { buildBundle } from "@dreamer/esbuild";
 * import { bunResolverPlugin } from "@dreamer/esbuild/plugins/resolver-bun";
 *
 * const result = await buildBundle({
 *   entryPoint: "./src/client/mod.ts",
 *   plugins: [bunResolverPlugin()],
 * });
 * ```
 */
export function bunResolverPlugin(
  options: ResolverOptions = {},
): esbuild.Plugin {
  const { enabled = true, browserMode = false } = options;

  return {
    name: "bun-resolver",
    setup(build) {
      if (!enabled) {
        return;
      }

      // 1. 处理路径别名（通过 package.json imports 或 tsconfig.json paths 配置）
      // 例如：import { x } from "@/utils.ts"
      // 例如：import { x } from "~/config.ts"
      build.onResolve(
        { filter: /^(@\/|~\/|@[^/]+\/|~[^/]+\/)/ },
        (args): esbuild.OnResolveResult | undefined => {
          const path = args.path;

          // 优先使用 importer 的目录，如果没有则使用 resolveDir，最后使用 cwd()
          const startDir = args.importer
            ? dirname(args.importer)
            : (args.resolveDir || cwd());

          const resolvedPath = resolvePathAlias(path, startDir);
          if (resolvedPath) {
            return {
              path: resolvedPath,
              namespace: "file",
            };
          }

          return undefined;
        },
      );

      // 2. 处理直接的 npm: 协议导入
      // 例如：import { x } from "npm:esbuild@^0.27.2"
      // 注意：Bun 原生支持 npm: 协议，但 esbuild 可能无法直接解析，所以需要插件帮助
      // 重要：Bun 不支持直接使用 jsr: 协议，必须通过 package.json imports 映射
      build.onResolve(
        { filter: /^npm:/ },
        async (args): Promise<esbuild.OnResolveResult | undefined> => {
          const path = args.path;

          // 浏览器模式：将依赖标记为 external，让浏览器从 CDN 加载
          if (browserMode) {
            const browserUrl = convertSpecifierToBrowserUrl(path);
            if (browserUrl) {
              // 返回 external，让 esbuild 不打包这个依赖
              // 浏览器会在运行时从 CDN 加载
              return {
                path: browserUrl,
                external: true,
              };
            }
          }

          return await resolveBunProtocolPath(path);
        },
      );

      // 2.5. 处理直接的 jsr: 协议导入（Bun 不支持，但为了兼容性，转换为错误提示或跳过）
      // 注意：Bun 不支持直接使用 jsr: 协议，应该通过 package.json imports 映射
      // 这里返回 undefined，让 esbuild 使用默认解析（会失败，但至少不会崩溃）
      build.onResolve(
        { filter: /^jsr:/ },
        (args): esbuild.OnResolveResult | undefined => {
          // Bun 不支持直接使用 jsr: 协议
          // 建议用户通过 package.json imports 映射来使用 JSR 包
          // 然后代码中使用：import { x } from "@dreamer/logger/client"
          console.warn(
            `[bun-resolver] Bun 不支持直接使用 jsr: 协议导入 "${args.path}"。` +
              `请通过 package.json 的 imports 字段映射 JSR 包，然后使用不带 jsr: 前缀的导入。`,
          );
          // 返回 undefined，让 esbuild 使用默认解析（会失败，但至少不会崩溃）
          return undefined;
        },
      );

      // 3. 匹配带有子路径的 @scope/package/subpath 模式
      // 例如：@dreamer/logger/client
      build.onResolve(
        { filter: /^@[^/]+\/[^/]+\/.+$/ },
        async (args): Promise<esbuild.OnResolveResult | undefined> => {
          const path = args.path;

          // 解析包名和子路径
          // @dreamer/logger/client -> packageName: @dreamer/logger, subpath: client
          const parts = path.split("/");
          const packageName = `${parts[0]}/${parts[1]}`;
          const subpathParts = parts.slice(2); // ["client"] 或 ["client", "utils"] 等多级

          // 查找项目的 package.json 文件
          // 优先使用 importer 的目录，如果没有则使用 resolveDir，最后使用 cwd()
          const startDir = args.importer
            ? dirname(args.importer)
            : (args.resolveDir || cwd());
          const projectPackageJsonPath = findProjectPackageJson(startDir);

          let packageImport: string | undefined;

          if (projectPackageJsonPath) {
            // 从项目的 package.json 的 imports 中获取包的导入映射
            packageImport = getPackageImport(
              projectPackageJsonPath,
              packageName,
            );
          }

          // 如果没有找到 package.json 或导入映射，尝试从 Bun 缓存读取
          // Bun 可以从缓存读取之前安装过的依赖，即使没有 package.json
          if (!packageImport) {
            try {
              // 尝试直接解析包路径，看看 Bun 是否能从缓存中解析
              // 这对于 npm 包特别有用，因为 Bun 会缓存已安装的 npm 包
              const resolvedUrl = await import.meta.resolve(path);

              // 如果成功解析为 file:// URL，说明 Bun 从缓存中找到了这个包
              if (resolvedUrl && resolvedUrl.startsWith("file://")) {
                let filePath = resolvedUrl.slice(7);
                try {
                  filePath = decodeURIComponent(filePath);
                } catch {
                  // 忽略解码错误
                }

                if (filePath && existsSync(filePath)) {
                  return {
                    path: filePath,
                    namespace: "file",
                  };
                }
              }
            } catch {
              // 如果 resolve 失败，说明缓存中也没有，继续后续处理
            }

            // 如果无法从缓存读取，让 esbuild 使用默认解析
            // 注意：对于 JSR 包，如果没有 package.json 的映射，Bun 无法解析
            return undefined;
          }

          // 拼接子路径到导入路径
          // 例如：jsr:@scope/package@^1.0.0-beta.1 + /client -> jsr:@scope/package@^1.0.0-beta.1/client
          // 例如：npm:lodash@^4.17.21 + /map -> npm:lodash@^4.17.21/map
          const subpath = subpathParts.join("/");
          const fullProtocolPath = `${packageImport}/${subpath}`;

          // 浏览器模式：将依赖标记为 external，让浏览器从 CDN 加载
          if (browserMode) {
            const browserUrl = convertSpecifierToBrowserUrl(fullProtocolPath);
            if (browserUrl) {
              // 返回 external，让 esbuild 不打包这个依赖
              // 浏览器会在运行时从 CDN 加载
              return {
                path: browserUrl,
                external: true,
              };
            }
          }

          // 如果 packageImport 是 jsr: 协议，Bun 不支持直接解析
          // 需要通过 package.json imports 映射，然后使用不带 jsr: 前缀的导入
          if (packageImport.startsWith("jsr:")) {
            console.warn(
              `[bun-resolver] Bun 不支持直接使用 jsr: 协议 "${fullProtocolPath}"。` +
                `请确保 package.json 的 imports 字段正确配置了 JSR 包映射。`,
            );
            // 返回 undefined，让 esbuild 使用默认解析（会失败，但至少不会崩溃）
            return undefined;
          }

          // 使用统一的协议路径解析函数（仅支持 npm: 协议）
          return await resolveBunProtocolPath(fullProtocolPath);
        },
      );

      // 4. 处理 bun-protocol namespace 中的相对路径导入
      // 当 npm 包内部有相对路径导入时，需要从文件的 resolveDir 解析这些相对路径
      // 注意：Bun 不支持 jsr: 协议，所以这里主要处理 npm: 包的内部相对路径
      build.onResolve(
        { filter: /^\.\.?\/.*/, namespace: "bun-protocol" },
        async (args): Promise<esbuild.OnResolveResult | undefined> => {
          // 相对路径导入，需要从 importer 的目录解析
          // importer 是协议路径（如 npm:lodash@^4.17.21/map）
          const importer = args.importer;
          if (!importer) {
            return undefined;
          }

          try {
            // 先尝试直接解析 importer 为实际文件路径
            let importerUrl: string | undefined;
            try {
              importerUrl = await import.meta.resolve(importer);
            } catch {
              // 如果 resolve 失败，尝试通过动态导入触发模块下载和缓存
              try {
                await import(importer);
                // 等待一小段时间，确保文件系统操作完成
                await new Promise((resolve) => setTimeout(resolve, 100));
                // 再次尝试 resolve
                importerUrl = await import.meta.resolve(importer);
              } catch {
                // 忽略错误
              }
            }

            if (importerUrl && importerUrl.startsWith("file://")) {
              let importerPath = importerUrl.slice(7);
              try {
                importerPath = decodeURIComponent(importerPath);
              } catch {
                // 忽略解码错误
              }

              if (existsSync(importerPath)) {
                // 从 importer 的目录解析相对路径
                const importerDir = dirname(importerPath);
                const resolvedPath = join(importerDir, args.path);

                if (existsSync(resolvedPath)) {
                  return {
                    path: resolvedPath,
                    namespace: "file",
                  };
                }
              }
            }

            // 如果无法通过文件路径解析，尝试构建完整的协议路径
            // 例如：npm:lodash@^4.17.21/map + ../utils.ts
            // -> npm:lodash@^4.17.21/utils.ts
            // 注意：Bun 不支持 jsr: 协议，这里主要处理 npm: 包
            try {
              const importerProtocolPath = importer;
              // 移除最后一个路径段（如 /client）
              const baseProtocolPath = importerProtocolPath.replace(
                /\/[^/]+$/,
                "",
              );
              const relativePath = args.path;

              // 规范化相对路径（处理 ../ 和 ./）
              let normalizedPath = relativePath;
              if (normalizedPath.startsWith("../")) {
                normalizedPath = normalizedPath.slice(3);
              } else if (normalizedPath.startsWith("./")) {
                normalizedPath = normalizedPath.slice(2);
              }

              const fullProtocolPath = `${baseProtocolPath}/${normalizedPath}`;

              // 尝试解析这个协议路径
              try {
                const resolvedProtocolUrl = await import.meta.resolve(
                  fullProtocolPath,
                );
                if (resolvedProtocolUrl.startsWith("file://")) {
                  let resolvedProtocolPath = resolvedProtocolUrl.slice(7);
                  try {
                    resolvedProtocolPath = decodeURIComponent(
                      resolvedProtocolPath,
                    );
                  } catch {
                    // 忽略解码错误
                  }

                  if (existsSync(resolvedProtocolPath)) {
                    return {
                      path: resolvedProtocolPath,
                      namespace: "file",
                    };
                  }
                }
              } catch {
                // 如果解析失败，返回一个 bun-protocol namespace 的结果
                return {
                  path: fullProtocolPath,
                  namespace: "bun-protocol",
                };
              }
            } catch {
              // 忽略错误
            }
          } catch {
            // 忽略错误
          }

          return undefined;
        },
      );

      // 5. 添加 onLoad 钩子来处理 bun-protocol namespace 的模块加载
      // 注意：Bun 不支持 jsr: 协议，这里主要处理 npm: 包的加载
      build.onLoad(
        { filter: /.*/, namespace: "bun-protocol" },
        async (args): Promise<esbuild.OnLoadResult | undefined> => {
          const protocolPath = args.path;

          // 如果协议路径是 jsr:，Bun 不支持，返回 undefined
          if (protocolPath.startsWith("jsr:")) {
            console.warn(
              `[bun-resolver] Bun 不支持直接使用 jsr: 协议 "${protocolPath}"。` +
                `请通过 package.json 的 imports 字段映射 JSR 包。`,
            );
            return undefined;
          }

          try {
            // 步骤 1: 先使用动态导入触发 Bun 下载和缓存模块（仅支持 npm: 协议）
            try {
              await import(protocolPath);
            } catch (_importError) {
              // 忽略导入错误，可能模块已经加载
            }

            // 步骤 2: 等待一小段时间，确保文件系统操作完成
            await new Promise((resolve) => setTimeout(resolve, 200));

            // 步骤 3: 多次尝试使用 import.meta.resolve 获取文件路径
            let fileUrl: string | undefined;
            let retries = 3;
            while (retries > 0 && !fileUrl) {
              try {
                fileUrl = await import.meta.resolve(protocolPath);
                // 如果返回的是 file:// URL，说明成功
                if (fileUrl && fileUrl.startsWith("file://")) {
                  break;
                }
              } catch (_resolveError) {
                // 忽略 resolve 错误
              }
              // 如果 resolve 失败或返回协议路径，等待后重试
              // 注意：Bun 不支持 jsr: 协议，这里主要处理 npm: 协议
              if (
                !fileUrl || fileUrl.startsWith("npm:")
              ) {
                await new Promise((resolve) => setTimeout(resolve, 100));
                retries--;
              } else {
                break;
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

              // 设置 resolveDir 为文件所在目录，以便 esbuild 能解析文件内部的相对路径导入
              const resolveDir = dirname(filePath);

              if (existsSync(filePath)) {
                const contents = await readTextFile(filePath);
                const loader = getLoaderFromPath(filePath);

                return {
                  contents,
                  loader,
                  resolveDir,
                };
              } else {
                // 文件不存在，但仍然需要设置 resolveDir
                const loader = getLoaderFromPath(filePath);
                return {
                  contents: "",
                  loader,
                  resolveDir,
                };
              }
            }

            // 如果所有方法都失败，至少设置 resolveDir
            const resolveDir = cwd();
            const loader = getLoaderFromPath(protocolPath);
            return {
              contents: "",
              loader,
              resolveDir,
            };
          } catch (_error) {
            // 忽略错误，返回 undefined
            return undefined;
          }
        },
      );
    },
  };
}
