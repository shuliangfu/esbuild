/**
 * @module @dreamer/esbuild/plugins/resolver
 *
 * 统一模块解析插件（支持 Deno 和 Bun）
 *
 * 为 esbuild 提供跨运行时的模块解析，支持：
 * - 读取 deno.json 的 imports 配置（路径别名和包导入映射）
 * - 解析 JSR 包的子路径导出（如 @dreamer/logger/client）
 * - 支持 jsr: 协议的模块引用（如 jsr:@dreamer/logger@^1.0.0）
 * - 支持 npm: 协议的模块引用（如 npm:esbuild@^0.27.2）
 *
 * 与项目内 esbuild.ts 的 createImportReplacerPlugin 对比：
 * - 彼处将 jsr/npm 转为 CDN URL（esm.sh）并 external，浏览器运行时加载已编译产物。
 * - 本插件在 browserMode: false（打进 bundle）时，只用 Deno 在项目目录下 resolve 得到
 *   file://，再读本地文件参与编译；不猜路径（不硬编码 src/）、不 fetch CDN。
 * - 打进 bundle 必须用源码，故不走 esm.sh 等已编译 CDN。
 */

import {
  createCommand,
  cwd,
  dirname,
  existsSync,
  join,
  readTextFile,
  readTextFileSync,
} from "@dreamer/runtime-adapter";
import * as esbuild from "esbuild";

/** 调试开关：为 true 时在控制台输出 onLoad / fetchJsrSourceViaMeta 的调试日志 */
const DEBUG_RESOLVER = false;
const DEBUG_PREFIX = "[resolver-deno]";

/**
 * JSR 请求头：文档要求 Accept 不得含 text/html，否则会返回 HTML 页面。
 * - JSON：拉取 meta.json / _meta.json
 * - 源码：拉取模块 .ts/.js 时用 JSR_ACCEPT_SOURCE，可拿到原始源码
 */
const JSR_ACCEPT_JSON = "application/json";
const JSR_ACCEPT_SOURCE = "application/typescript, text/plain, */*";

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
 * deno.json 配置结构
 */
interface DenoConfig {
  imports?: Record<string, string>;
}

/** deno-protocol namespace，用于 onLoad 通过 fetch 取内容并打包 */
const NAMESPACE_DENO_PROTOCOL = "deno-protocol";

/**
 * 读取并解析 deno.json 配置
 *
 * @param denoJsonPath - deno.json 文件路径
 * @returns 解析后的配置，失败或文件不存在返回 undefined
 */
function getDenoConfig(denoJsonPath: string): DenoConfig | undefined {
  try {
    const content = readTextFileSync(denoJsonPath);
    return JSON.parse(content) as DenoConfig;
  } catch {
    return undefined;
  }
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
 * @returns 包的导入路径（如 jsr:@scope/package@^1.0.0-beta.1），如果未找到返回 undefined
 */
function getPackageImport(
  projectDenoJsonPath: string,
  packageName: string,
): string | undefined {
  const config = getDenoConfig(projectDenoJsonPath);
  if (!config?.imports) {
    return undefined;
  }
  return config.imports[packageName];
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
 * 从 URL 拉取 JSON 并解析（避免拿到 HTML 时误解析）
 *
 * @param url - 请求 URL
 * @returns 解析后的对象，失败或非 JSON 返回 null
 */
async function fetchJsonFromUrl(url: string): Promise<unknown | null> {
  try {
    const r = await fetch(url, { headers: { Accept: JSR_ACCEPT_JSON } });
    if (!r.ok) return null;
    const text = await r.text();
    if (!text || text.trimStart().startsWith("<")) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * 从 URL 拉取源码文本（避免拿到 HTML）
 *
 * @param url - 请求 URL
 * @returns 源码内容，失败或疑似 HTML 返回 null
 */
async function fetchSourceFromUrl(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { Accept: JSR_ACCEPT_SOURCE } });
    if (!r.ok) return null;
    const text = await r.text();
    if (!text || text.trimStart().startsWith("<")) return null;
    return text;
  } catch {
    return null;
  }
}

/**
 * 用 JSR version_meta.json 的 manifest/exports 解析子路径，再 fetch 源码 URL 取内容。
 * 不猜路径：manifest 里是包内真实路径（如 /src/encryption/encryption-manager.ts），exports 是子路径→文件映射。
 *
 * @param protocolPath - jsr: 协议路径（如 jsr:@dreamer/socket-io@^1.0.0-beta.2/encryption/encryption-manager.ts）
 * @returns 源码内容，失败返回 null
 */
async function fetchJsrSourceViaMeta(
  protocolPath: string,
): Promise<string | null> {
  if (DEBUG_RESOLVER) {
    console.log(
      `${DEBUG_PREFIX} fetchJsrSourceViaMeta 入参 protocolPath=${protocolPath}`,
    );
  }
  if (!protocolPath.startsWith("jsr:")) {
    if (DEBUG_RESOLVER) {
      console.log(
        `${DEBUG_PREFIX} fetchJsrSourceViaMeta 非 jsr: 协议，返回 null`,
      );
    }
    return null;
  }
  // 格式 jsr:@scope/name@version/path 或 jsr:@scope/name/path（无版本号时从包级 meta 取 latest）
  const after = protocolPath.slice(4);
  const lastAtIdx = after.lastIndexOf("@");
  let scopeAndName: string;
  let version: string;
  let subpath: string;
  if (lastAtIdx === -1) {
    // 无 @：解析为 @scope/name 与可选的 subpath，再从包级 meta.json 取最新非 yanked 版本
    const parts = after.split("/");
    if (parts.length < 2) {
      return null;
    }
    scopeAndName = `${parts[0]}/${parts[1]}`;
    subpath = parts.length > 2 ? parts.slice(2).join("/") : "";
    const pkgMetaUrl = `https://jsr.io/${scopeAndName}/meta.json`;
    const pkgMetaRaw = await fetchJsonFromUrl(pkgMetaUrl);
    if (DEBUG_RESOLVER) {
      console.log(
        `${DEBUG_PREFIX} fetchJsrSourceViaMeta 无版本号分支 pkgMetaUrl=${pkgMetaUrl} pkgMetaRaw=${
          pkgMetaRaw == null ? "null" : "ok"
        }`,
      );
    }
    const pkgMeta = pkgMetaRaw as {
      versions?: Record<string, { yanked?: boolean }>;
    } | null;
    if (!pkgMeta) return null;
    const versions = pkgMeta.versions ?? {};
    const nonYanked = Object.keys(versions).filter((k) => !versions[k]?.yanked)
      .sort();
    if (nonYanked.length === 0) {
      return null;
    }
    version = nonYanked[nonYanked.length - 1];
  } else {
    scopeAndName = after.slice(0, lastAtIdx);
    const versionAndPath = after.slice(lastAtIdx + 1);
    const slashInRest = versionAndPath.indexOf("/");
    version = slashInRest === -1
      ? versionAndPath
      : versionAndPath.slice(0, slashInRest);
    subpath = slashInRest === -1 ? "" : versionAndPath.slice(slashInRest + 1);
  }

  // JSR _meta.json URL 只接受具体版本，不接受 ^ 或 ~ 等范围；去掉前缀后用该版本请求
  const concreteVersion = version.replace(/^[\^~]/, "");
  const base = `https://jsr.io/${scopeAndName}/${concreteVersion}`;
  const metaUrl = `${base}_meta.json`;
  const metaRaw = await fetchJsonFromUrl(metaUrl);
  if (DEBUG_RESOLVER) {
    console.log(
      `${DEBUG_PREFIX} fetchJsrSourceViaMeta scopeAndName=${scopeAndName} version=${version} subpath=${subpath} metaUrl=${metaUrl} metaRaw=${
        metaRaw == null ? "null" : "ok"
      }`,
    );
  }
  const meta = metaRaw as {
    manifest?: Record<string, unknown>;
    exports?: Record<string, string>;
  } | null;
  if (!meta) return null;

  const manifest = meta.manifest ?? {};
  const exports = meta.exports ?? {};
  // 优先 exports："./client" -> "./src/client/mod.ts"，取掉 "./" 得 path
  const exportKey = subpath ? `./${subpath}` : ".";
  let pathFromExport = exports[exportKey];
  if (pathFromExport && typeof pathFromExport === "string") {
    pathFromExport = pathFromExport.replace(/^\.\//, "");
  }
  if (DEBUG_RESOLVER) {
    console.log(
      `${DEBUG_PREFIX} fetchJsrSourceViaMeta exportKey=${exportKey} pathFromExport=${pathFromExport} manifestHasPath=${
        pathFromExport ? typeof manifest[`/${pathFromExport}`] : "n/a"
      }`,
    );
  }
  if (pathFromExport && typeof manifest[`/${pathFromExport}`] === "object") {
    const fileUrl = `${base}/${pathFromExport}`;
    const code = await fetchSourceFromUrl(fileUrl);
    if (DEBUG_RESOLVER) {
      console.log(
        `${DEBUG_PREFIX} fetchJsrSourceViaMeta 第一路径 fileUrl=${fileUrl} code=${
          code != null ? `${code.length} chars` : "null"
        }`,
      );
    }
    if (code != null) return code;
  }
  // 主入口只认 meta 里的 exports["."]，可能是 mod.ts、index.ts、main.ts 等，不写死
  if (!subpath) {
    return null;
  }
  // 子路径：仅按 meta 里 manifest 的 key 匹配，不假设目录结构；统一去掉 .ts 再比较，避免 import 带不带扩展名不一致
  const subpathNoExt = subpath.endsWith(".ts") ? subpath.slice(0, -3) : subpath;
  const manifestKeys = Object.keys(manifest);
  const pathKey = manifestKeys.find(
    (k) => {
      if (typeof manifest[k] !== "object") return false;
      const kNoExt = k.endsWith(".ts") ? k.slice(0, -3) : k;
      return kNoExt === `/${subpathNoExt}` ||
        kNoExt.endsWith(`/${subpathNoExt}`);
    },
  );
  if (pathKey) {
    const pathSlice = pathKey.slice(1);
    const code = await fetchSourceFromUrl(`${base}/${pathSlice}`);
    if (DEBUG_RESOLVER) {
      console.log(
        `${DEBUG_PREFIX} fetchJsrSourceViaMeta 第二路径 pathKey=${pathKey} url=${base}/${pathSlice} code=${
          code != null ? `${code.length} chars` : "null"
        }`,
      );
    }
    if (code != null) return code;
  }
  if (DEBUG_RESOLVER) {
    console.log(`${DEBUG_PREFIX} fetchJsrSourceViaMeta 未取到源码，返回 null`);
  }
  return null;
}

/**
 * 解析 jsr: / npm: 协议路径：非浏览器模式一律走 deno-protocol，由 onLoad 用 https fetch 取内容并打包
 *
 * @param protocolPath - 协议路径（如 jsr:@scope/package@^1.0.0-beta.1）
 * @param browserMode - 为 true 时标记为 external，由浏览器从 CDN 加载
 * @returns 解析结果
 */
function resolveDenoProtocolPath(
  protocolPath: string,
  browserMode: boolean,
): esbuild.OnResolveResult | undefined {
  if (browserMode) {
    const browserUrl = convertSpecifierToBrowserUrl(protocolPath);
    if (browserUrl) {
      return { path: browserUrl, external: true };
    }
    return undefined;
  }
  // 服务端或需要打进 bundle 的客户端：统一走 deno-protocol，onLoad 里用 https URL fetch 后返回内容
  return { path: protocolPath, namespace: NAMESPACE_DENO_PROTOCOL };
}

/**
 * 创建统一模块解析插件
 *
 * 该插件解决 esbuild 在 Deno/Bun 环境下无法正确解析 JSR 包子路径导出的问题。
 * esbuild 默认读取 package.json，但 Deno/JSR 包使用 deno.json 定义 imports。
 *
 * @param options - 插件选项
 * @returns esbuild 插件
 *
 * @example
 * ```typescript
 * import { buildBundle } from "@dreamer/esbuild";
 * import { createResolverPlugin } from "@dreamer/esbuild/plugins/resolver";
 *
 * const result = await buildBundle({
 *   entryPoint: "./src/client/mod.ts",
 *   plugins: [createResolverPlugin()],
 * });
 * ```
 */
export function denoResolverPlugin(
  options: ResolverOptions = {},
): esbuild.Plugin {
  const { enabled = true, browserMode = false } = options;

  return {
    name: "resolver",
    setup(build) {
      if (!enabled) {
        return;
      }

      /**
       * JSR/协议模块的 protocolPath → resolveDir 缓存。
       * 在 onLoad 成功加载 deno-protocol 模块时写入；
       * 在相对路径 onResolve 中优先用此缓存把 ../encryption/... 等解析到磁盘文件，
       * 避免子路径走“协议路径 + onLoad”时返回空内容导致 "has no exports"。
       */
      const protocolResolveDirCache = new Map<string, string>();

      // 设置插件优先级，确保在其他解析器之前运行
      // 这样可以拦截 JSR 包和路径别名的解析

      // 1. 处理路径别名（通过 deno.json imports 配置）
      // 例如：import { x } from "@/utils.ts"
      // 例如：import { x } from "~/config.ts"
      // 这些别名需要在 deno.json 的 imports 中配置
      build.onResolve(
        { filter: /^(@\/|~\/|@[^/]+\/|~[^/]+\/)/ },
        (args): esbuild.OnResolveResult | undefined => {
          const path = args.path;

          // 查找项目的 deno.json 文件
          // 优先使用 importer 的目录，如果没有则使用 resolveDir，最后使用 cwd()
          const startDir = args.importer
            ? dirname(args.importer)
            : (args.resolveDir || cwd());
          const projectDenoJsonPath = findProjectDenoJson(startDir);

          if (!projectDenoJsonPath) {
            return undefined;
          }

          // 从项目的 deno.json 的 imports 中查找路径别名
          const config = getDenoConfig(projectDenoJsonPath);
          if (!config?.imports) {
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

                // 检查文件是否存在
                if (existsSync(resolvedPath)) {
                  return {
                    path: resolvedPath,
                    namespace: "file",
                  };
                }
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

          return undefined;
        },
      );

      // 2. 处理直接的 jsr: 和 npm: 协议导入
      // 例如：import { x } from "jsr:@scope/package@^1.0.0-beta.1"
      // 例如：import { x } from "npm:esbuild@^0.27.2"
      build.onResolve(
        { filter: /^(jsr|npm):/ },
        (args): esbuild.OnResolveResult | undefined =>
          resolveDenoProtocolPath(args.path, browserMode),
      );

      // 2.5 匹配不带子路径的 @scope/package 模式
      // 例如：@dreamer/config、@dreamer/service
      build.onResolve(
        { filter: /^@[^/]+\/[^/]+$/ },
        (args): esbuild.OnResolveResult | undefined => {
          const packageName = args.path;

          // 查找项目的 deno.json 文件
          const startDir = args.importer
            ? dirname(args.importer)
            : (args.resolveDir || cwd());
          const projectDenoJsonPath = findProjectDenoJson(startDir);

          if (!projectDenoJsonPath) {
            return undefined;
          }

          // 从项目的 deno.json 的 imports 中获取包的导入映射
          const packageImport = getPackageImport(
            projectDenoJsonPath,
            packageName,
          );

          if (!packageImport) {
            return undefined;
          }

          // 直接返回协议路径解析结果
          return resolveDenoProtocolPath(packageImport, browserMode);
        },
      );

      // 3. 匹配带有子路径的 @scope/package/subpath 模式
      // 例如：@dreamer/logger/client
      build.onResolve(
        { filter: /^@[^/]+\/[^/]+\/.+$/ },
        (args): esbuild.OnResolveResult | undefined => {
          const path = args.path;

          // 解析包名和子路径
          // @dreamer/logger/client -> packageName: @dreamer/logger, subpath: client
          const parts = path.split("/");
          const packageName = `${parts[0]}/${parts[1]}`;
          const subpathParts = parts.slice(2); // ["client"] 或 ["client", "utils"] 等多级

          // 查找项目的 deno.json 文件
          // 优先使用 importer 的目录，如果没有则使用 resolveDir，最后使用 cwd()
          const startDir = args.importer
            ? dirname(args.importer)
            : (args.resolveDir || cwd());
          const projectDenoJsonPath = findProjectDenoJson(startDir);

          if (!projectDenoJsonPath) {
            return undefined;
          }

          // 从项目的 deno.json 的 imports 中获取包的导入映射
          const packageImport = getPackageImport(
            projectDenoJsonPath,
            packageName,
          );

          if (!packageImport) {
            return undefined;
          }

          // 拼接子路径到导入路径
          // 例如：jsr:@scope/package@^1.0.0-beta.1 + /client -> jsr:@scope/package@^1.0.0-beta.1/client
          // 例如：npm:lodash@^4.17.21 + /map -> npm:lodash@^4.17.21/map
          const subpath = subpathParts.join("/");
          const fullProtocolPath = `${packageImport}/${subpath}`;
          return resolveDenoProtocolPath(fullProtocolPath, browserMode);
        },
      );

      // 3. 处理 deno-protocol namespace 中的相对路径导入
      // 当文件内部有相对路径导入（如 ../encryption/encryption-manager.ts）时，
      // 需要从文件的 resolveDir 解析这些相对路径
      build.onResolve(
        { filter: /^\.\.?\/.*/, namespace: NAMESPACE_DENO_PROTOCOL },
        async (args): Promise<esbuild.OnResolveResult | undefined> => {
          // 相对路径导入，需要从 importer 的目录解析
          // importer 可能是 deno-protocol:jsr:@dreamer/socket-io@^1.0.0-beta.2/client
          // 需要先提取协议路径（去掉 deno-protocol: 前缀），然后解析为实际文件路径
          const importer = args.importer;
          if (!importer) {
            return undefined;
          }

          try {
            // 提取协议路径（去掉 deno-protocol: 前缀）
            let protocolPath = importer;
            const protocolPrefix = `${NAMESPACE_DENO_PROTOCOL}:`;
            if (importer.startsWith(protocolPrefix)) {
              protocolPath = importer.slice(protocolPrefix.length);
            }

            // 优先用 onLoad 已缓存的 resolveDir 从磁盘解析，避免子路径走 deno-protocol onLoad 返回空内容导致 "has no exports"
            const cachedDir = protocolResolveDirCache.get(protocolPath);
            if (cachedDir) {
              const resolvedPath = join(cachedDir, args.path);
              if (existsSync(resolvedPath)) {
                return { path: resolvedPath, namespace: "file" };
              }
              // 无扩展名时尝试 .ts
              if (!resolvedPath.includes(".")) {
                const withTs = resolvedPath + ".ts";
                if (existsSync(withTs)) {
                  return { path: withTs, namespace: "file" };
                }
              }
            }

            // 在插件上下文中 import.meta.resolve 用的是 esbuild 的 deno.json，拿不到项目的 file://，只做一次
            let importerUrl: string | undefined;
            try {
              importerUrl = await import.meta.resolve(protocolPath);
            } catch {
              // 忽略
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
            } else if (
              importerUrl &&
              (importerUrl.startsWith("https://") ||
                importerUrl.startsWith("http://"))
            ) {
              // 如果 importer 是 HTTP URL，从 HTTP URL 解析相对路径
              // 例如：https://jsr.io/@dreamer/socket-io/1.0.0-beta.2/src/client/mod.ts
              // + ../encryption/encryption-manager.ts
              // -> https://jsr.io/@dreamer/socket-io/1.0.0-beta.2/src/encryption/encryption-manager.ts
              try {
                const importerUrlObj = new URL(importerUrl);
                const importerPathname = importerUrlObj.pathname;
                const importerDir = importerPathname.substring(
                  0,
                  importerPathname.lastIndexOf("/"),
                );
                const resolvedPathname = new URL(
                  args.path,
                  `${importerUrlObj.protocol}//${importerUrlObj.host}${importerDir}/`,
                ).pathname;

                // 返回一个 deno-protocol namespace 的结果，让 onLoad 钩子来处理
                // 但是，我们需要构建一个协议路径，而不是直接使用 HTTP URL
                // 尝试从 HTTP URL 推断协议路径
                // 例如：https://jsr.io/@dreamer/socket-io/1.0.0-beta.2/src/encryption/encryption-manager.ts
                // -> jsr:@dreamer/socket-io@^1.0.0-beta.2/encryption/encryption-manager.ts
                const match = importerPathname.match(
                  /\/@dreamer\/([^\/]+)\/([^\/]+)\/(.+)/,
                );
                if (match) {
                  const [, packageName, version] = match;
                  // 从 importer 路径推断相对路径的协议路径
                  const relativeMatch = resolvedPathname.match(
                    /\/@dreamer\/([^\/]+)\/([^\/]+)\/(.+)/,
                  );
                  if (relativeMatch) {
                    const [, , , relativePath] = relativeMatch;
                    // 移除 src/ 前缀（如果存在）
                    const normalizedPath = relativePath.replace(/^src\//, "");
                    const fullProtocolPath =
                      `jsr:@dreamer/${packageName}@${version}/${normalizedPath}`;
                    // 返回 deno-protocol namespace，让 onLoad 钩子来处理
                    return {
                      path: fullProtocolPath,
                      namespace: NAMESPACE_DENO_PROTOCOL,
                    };
                  }
                }
              } catch {
                // 忽略错误
              }
            }

            // 如果无法通过文件路径解析，尝试构建完整的协议路径
            // 例如：jsr:@dreamer/socket-io@^1.0.0-beta.2/client + ./socket.ts -> .../client/socket.ts
            // 例如：jsr:@dreamer/socket-io@^1.0.0-beta.2/client + ../encryption/encryption-manager.ts -> .../encryption/encryption-manager.ts
            try {
              // 从 importer 路径构建相对路径的协议路径
              // importer 可能是 deno-protocol:jsr:@dreamer/socket-io@^1.0.0-beta.2/client（子路径即“目录”）
              let importerProtocolPath = importer;
              const prefix = `${NAMESPACE_DENO_PROTOCOL}:`;
              if (importerProtocolPath.startsWith(prefix)) {
                importerProtocolPath = importerProtocolPath.slice(
                  prefix.length,
                );
              }
              // 基准路径：若 importer 为文件（最后一段含扩展名如 .ts），则用其所在目录；否则用完整路径（子路径如 client 对应 mod 所在目录）
              const lastSegment = importerProtocolPath.replace(/.*\//, "");
              const isFile = lastSegment.includes(".");
              let currentBasePath = isFile
                ? importerProtocolPath.replace(/\/[^/]+$/, "")
                : importerProtocolPath;
              const relativePath = args.path;

              // 规范化相对路径（处理 ../ 和 ./）
              let normalizedPath = relativePath;
              let depth = 0;
              while (normalizedPath.startsWith("../")) {
                normalizedPath = normalizedPath.slice(3);
                depth++;
              }
              if (normalizedPath.startsWith("./")) {
                normalizedPath = normalizedPath.slice(2);
              }

              // 仅对 ../ 向上回退：每层 ../ 从 currentBasePath 去掉最后一段
              // 例如 jsr:.../client，depth=1 -> jsr:...@1.0.0-beta.2
              for (let i = 0; i < depth; i++) {
                currentBasePath = currentBasePath.replace(/\/[^/]+$/, "");
              }

              const fullProtocolPath = `${currentBasePath}/${normalizedPath}`;

              // 在插件上下文中只做一次 resolve，拿不到 file:// 就返回 deno-protocol 交给 onLoad（含 fetchJsrSourceViaMeta）
              try {
                let resolvedProtocolUrl: string | undefined;
                try {
                  resolvedProtocolUrl = await import.meta.resolve(
                    fullProtocolPath,
                  );
                } catch {
                  // 忽略
                }

                if (
                  resolvedProtocolUrl &&
                  resolvedProtocolUrl.startsWith("file://")
                ) {
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
                // 未得到 file:// 或本地文件不存在时，一律返回 deno-protocol，由 onLoad 用 fetchJsrSourceViaMeta 等拉取
                return {
                  path: fullProtocolPath,
                  namespace: NAMESPACE_DENO_PROTOCOL,
                };
              } catch {
                // 若上述流程抛错，仍返回 deno-protocol，让 onLoad 尝试拉取
                return {
                  path: fullProtocolPath,
                  namespace: NAMESPACE_DENO_PROTOCOL,
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

      // 4. 添加 onLoad 钩子来处理 deno-protocol namespace 的模块加载
      // 统一处理 jsr: 和 npm: 协议的模块加载
      build.onLoad(
        { filter: /.*/, namespace: NAMESPACE_DENO_PROTOCOL },
        async (args): Promise<esbuild.OnLoadResult | undefined> => {
          const protocolPath = args.path;
          if (DEBUG_RESOLVER) {
            console.log(
              `${DEBUG_PREFIX} onLoad 入参 protocolPath=${protocolPath}`,
            );
          }

          try {
            // 步骤 1: 先使用动态导入触发 Deno 下载和缓存模块
            // 这会确保模块被下载到 Deno 缓存中（适用于 jsr: 和 npm:）
            try {
              await import(protocolPath);
            } catch {
              // 忽略导入错误，可能模块已经加载
            }

            // 步骤 2～3: 在插件上下文中 import.meta.resolve 用的是 esbuild 的 deno.json，拿不到项目的 file://，
            // 只做一次 resolve，拿不到就交给步骤 3.5 子进程在项目目录下解析
            let fileUrl: string | undefined;
            try {
              fileUrl = await import.meta.resolve(protocolPath);
              if (DEBUG_RESOLVER) {
                console.log(
                  `${DEBUG_PREFIX} onLoad import.meta.resolve 结果 fileUrl=${
                    fileUrl ?? "undefined"
                  }`,
                );
              }
            } catch {
              // 忽略
            }

            // 步骤 3.5: 插件里 import.meta.resolve 用的是 esbuild 的上下文，拿不到项目的 deno.json；
            // 若未得到 file://，在项目目录下起子进程做 resolve，用项目的 deno.json 得到真实 file://
            if (!fileUrl || !fileUrl.startsWith("file://")) {
              if (DEBUG_RESOLVER) {
                console.log(
                  `${DEBUG_PREFIX} onLoad 未得到 file://，尝试子进程 resolve`,
                );
              }
              try {
                const projectDir =
                  (build.initialOptions.absWorkingDir as string | undefined) ||
                  cwd();
                const projectDenoJson = findProjectDenoJson(projectDir);
                const proc = createCommand("deno", {
                  args: [
                    "eval",
                    ...(projectDenoJson ? ["--config", projectDenoJson] : []),
                    "const u=await import.meta.resolve(Deno.args[0]);console.log(u);",
                    protocolPath,
                  ],
                  cwd: projectDir,
                  stdout: "piped",
                  stderr: "piped",
                });
                const out = await proc.output();
                if (out.success && out.stdout && out.stdout.length > 0) {
                  const line = new TextDecoder().decode(out.stdout).trim();
                  if (line.startsWith("file://")) {
                    fileUrl = line;
                    if (DEBUG_RESOLVER) {
                      console.log(
                        `${DEBUG_PREFIX} onLoad 子进程 resolve 得到 fileUrl=${fileUrl}`,
                      );
                    }
                  }
                }
              } catch {
                // 忽略
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
              // 即使文件不存在，也要设置 resolveDir，这样 esbuild 才能正确解析相对路径
              const resolveDir = dirname(filePath);
              protocolResolveDirCache.set(protocolPath, resolveDir);

              if (existsSync(filePath)) {
                const contents = await readTextFile(filePath);
                if (DEBUG_RESOLVER) {
                  console.log(
                    `${DEBUG_PREFIX} onLoad 分支 file:// 文件存在 path=${filePath} contentsLen=${contents.length}`,
                  );
                }
                // 根据文件扩展名确定 loader
                const loader = getLoaderFromPath(filePath);
                return {
                  contents,
                  loader,
                  resolveDir,
                };
              }
              if (DEBUG_RESOLVER) {
                console.log(
                  `${DEBUG_PREFIX} onLoad 分支 file:// 文件不存在 path=${filePath}，对 jsr: 尝试 fetchJsrSourceViaMeta`,
                );
              }
              // 文件不存在（如缓存路径在另一台机器或已清理）：对 jsr: 回退到 fetchJsrSourceViaMeta，避免返回空内容导致 "No matching export"
              if (protocolPath.startsWith("jsr:")) {
                const contents = await fetchJsrSourceViaMeta(protocolPath);
                if (contents != null) {
                  const loader = getLoaderFromPath(protocolPath);
                  return { contents, loader, resolveDir };
                }
              } else {
                // 非 jsr: 且文件不存在时仍设置 resolveDir，返回空内容
                const loader = getLoaderFromPath(filePath);
                return {
                  contents: "",
                  loader,
                  resolveDir,
                };
              }
            } else if (
              fileUrl &&
              (fileUrl.startsWith("https://") || fileUrl.startsWith("http://"))
            ) {
              if (DEBUG_RESOLVER) {
                console.log(
                  `${DEBUG_PREFIX} onLoad 分支 https fileUrl=${fileUrl}`,
                );
              }
              // 步骤 5: 如果 resolve 返回 HTTP URL
              // 对 jsr: 优先用 fetchJsrSourceViaMeta（内部带 Accept: JSR_ACCEPT_SOURCE），避免运行时自动加 Sec-Fetch-Dest: document 导致 JSR 仍回 HTML
              if (protocolPath.startsWith("jsr:")) {
                const contents = await fetchJsrSourceViaMeta(protocolPath);
                if (DEBUG_RESOLVER) {
                  console.log(
                    `${DEBUG_PREFIX} onLoad 步骤5(https+jsr) fetchJsrSourceViaMeta 结果 contents=${
                      contents != null ? `${contents.length} chars` : "null"
                    }`,
                  );
                }
                if (contents != null) {
                  const loader = getLoaderFromPath(protocolPath);
                  // 不设 resolveDir：否则 esbuild 会把模块内 "./socket" 等解析为 cwd()/socket，加载到项目文件导致 "No matching export"
                  return { contents, loader };
                }
              }
              // 非 jsr: 或 fetchJsr 失败时：直接 fetch，带 Accept 避免 JSR 回 HTML
              try {
                const response = await fetch(fileUrl, {
                  headers: { Accept: JSR_ACCEPT_SOURCE },
                });
                if (response.ok) {
                  const contents = await response.text();
                  if (!contents.trimStart().startsWith("<")) {
                    const loader = getLoaderFromPath(fileUrl);
                    const resolveDir = cwd();
                    return {
                      contents,
                      loader,
                      resolveDir,
                    };
                  }
                }
              } catch {
                // 忽略 fetch 错误
              }
            } else if (
              fileUrl &&
              (fileUrl.startsWith("jsr:") || fileUrl.startsWith("npm:"))
            ) {
              if (DEBUG_RESOLVER) {
                console.log(
                  `${DEBUG_PREFIX} onLoad 分支 fileUrl=jsr/npm fileUrl=${fileUrl}`,
                );
              }
              // 步骤 6: 子进程也未得到 file:// 时，用 JSR _meta.json 的 manifest/exports 解析真实路径再 fetch 源码（非 CDN）
              if (protocolPath.startsWith("jsr:")) {
                const contents = await fetchJsrSourceViaMeta(protocolPath);
                if (DEBUG_RESOLVER) {
                  console.log(
                    `${DEBUG_PREFIX} onLoad 步骤6 fetchJsrSourceViaMeta 结果 contents=${
                      contents != null ? `${contents.length} chars` : "null"
                    }`,
                  );
                }
                if (contents != null) {
                  const loader = getLoaderFromPath(protocolPath);
                  // 不设 resolveDir，相对导入走 deno-protocol onResolve
                  return { contents, loader };
                }
              }
              if (DEBUG_RESOLVER) {
                console.log(
                  `${DEBUG_PREFIX} onLoad 步骤6 返回空内容 (fileUrl=jsr/npm 且 fetchJsr 为 null)`,
                );
              }
              const loader = getLoaderFromPath(protocolPath);
              return { contents: "", loader };
            }

            // 如果所有方法都失败，至少设置 resolveDir
            if (DEBUG_RESOLVER) {
              console.log(
                `${DEBUG_PREFIX} onLoad 落入最终分支 返回空内容 fileUrl=${
                  fileUrl ?? "undefined"
                }`,
              );
            }
            // 这样 esbuild 才能正确解析文件内部的相对路径导入
            const resolveDir = cwd();
            protocolResolveDirCache.set(protocolPath, resolveDir);
            const loader = getLoaderFromPath(protocolPath);
            return {
              contents: "",
              loader,
              resolveDir,
            };
          } catch {
            return undefined;
          }
        },
      );
    },
  };
}
