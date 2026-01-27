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

/** JSR 请求用 Accept 避免拿到 HTML 页面 */
const JSR_ACCEPT_JSON = "application/json";
const JSR_ACCEPT_SOURCE = "application/typescript, text/plain, */*";

/**
 * 同一 build 内 JSR _meta.json 缓存：key = base（https://jsr.io/scope/name/version），value = { manifest, exports }
 */
const _jsrMetaCache = new Map<string, { manifest: Record<string, unknown>; exports: Record<string, string> }>();

/**
 * 无版本号时包级 meta 缓存：key = scopeAndName，value = 最新非 yanked 版本号
 */
const _jsrPkgMetaCache = new Map<string, string>();

/**
 * 已 fetch 的 JSR 源码缓存：key = fullUrl（如 https://jsr.io/.../path.ts），value = 源码内容
 */
const _jsrSourceCache = new Map<string, string>();

/**
 * 用 JSR version_meta.json 的 manifest/exports 解析子路径，再 fetch 源码 URL 取内容。
 * 不猜路径：manifest 里是包内真实路径（如 /src/encryption/encryption-manager.ts），exports 是子路径→文件映射。
 * 同一包同版本的 _meta、包级 meta、源码会做内存缓存，减少重复请求。
 *
 * @param protocolPath - jsr: 协议路径（如 jsr:@dreamer/socket-io@1.0.0-beta.2/encryption/encryption-manager.ts）
 * @returns 源码内容，失败返回 null
 */
async function fetchJsrSourceViaMeta(protocolPath: string): Promise<string | null> {
  if (!protocolPath.startsWith("jsr:")) {
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
    const cachedVersion = _jsrPkgMetaCache.get(scopeAndName);
    if (cachedVersion != null) {
      version = cachedVersion;
    } else {
      const pkgMetaUrl = `https://jsr.io/${scopeAndName}/meta.json`;
      let pkgMeta: { versions?: Record<string, { yanked?: boolean }> };
      try {
        const pr = await fetch(pkgMetaUrl, { headers: { Accept: JSR_ACCEPT_JSON } });
        if (!pr.ok) {
          return null;
        }
        const pkgText = await pr.text();
        if (!pkgText || pkgText.trimStart().startsWith("<")) {
          return null;
        }
        pkgMeta = JSON.parse(pkgText) as { versions?: Record<string, { yanked?: boolean }> };
      } catch {
        return null;
      }
      const versions = pkgMeta.versions ?? {};
      const nonYanked = Object.keys(versions).filter((k) => !versions[k]?.yanked).sort();
      if (nonYanked.length === 0) {
        return null;
      }
      version = nonYanked[nonYanked.length - 1];
      _jsrPkgMetaCache.set(scopeAndName, version);
    }
  } else {
    scopeAndName = after.slice(0, lastAtIdx);
    const versionAndPath = after.slice(lastAtIdx + 1);
    const slashInRest = versionAndPath.indexOf("/");
    version = slashInRest === -1 ? versionAndPath : versionAndPath.slice(0, slashInRest);
    subpath = slashInRest === -1 ? "" : versionAndPath.slice(slashInRest + 1);
  }

  const base = `https://jsr.io/${scopeAndName}/${version}`;
  let meta = _jsrMetaCache.get(base);
  if (meta == null) {
    const metaUrl = `${base}_meta.json`;
    try {
      const r = await fetch(metaUrl, { headers: { Accept: JSR_ACCEPT_JSON } });
      if (!r.ok) {
        return null;
      }
      const text = await r.text();
      if (!text || text.trimStart().startsWith("<")) {
        return null;
      }
      const parsed = JSON.parse(text) as { manifest?: Record<string, unknown>; exports?: Record<string, string> };
      meta = { manifest: parsed.manifest ?? {}, exports: parsed.exports ?? {} };
      _jsrMetaCache.set(base, meta);
    } catch {
      return null;
    }
  }

  const manifest = meta.manifest;
  const exports = meta.exports;
  // 优先 exports："./client" -> "./src/client/mod.ts"，取掉 "./" 得 path
  const exportKey = subpath ? `./${subpath}` : ".";
  let pathFromExport = exports[exportKey];
  if (pathFromExport && typeof pathFromExport === "string") {
    pathFromExport = pathFromExport.replace(/^\.\//, "");
  }
  if (pathFromExport && typeof manifest[`/${pathFromExport}`] === "object") {
    const fileUrl = `${base}/${pathFromExport}`;
    const cached = _jsrSourceCache.get(fileUrl);
    if (cached != null) {
      return cached;
    }
    try {
      const fr = await fetch(fileUrl, { headers: { Accept: JSR_ACCEPT_SOURCE } });
      if (!fr.ok) {
        // 不缓存失败结果
      } else {
        const code = await fr.text();
        if (code && !code.trimStart().startsWith("<")) {
          _jsrSourceCache.set(fileUrl, code);
          return code;
        }
      }
    } catch {
      // 忽略
    }
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
      return kNoExt === `/${subpathNoExt}` || kNoExt.endsWith(`/${subpathNoExt}`);
    },
  );
  if (pathKey) {
    const pathSlice = pathKey.slice(1);
    const fileUrl = `${base}/${pathSlice}`;
    const cached = _jsrSourceCache.get(fileUrl);
    if (cached != null) {
      return cached;
    }
    try {
      const fr = await fetch(fileUrl, { headers: { Accept: JSR_ACCEPT_SOURCE } });
      if (!fr.ok) {
        // 不缓存失败结果
      } else {
        const code = await fr.text();
        if (code && !code.trimStart().startsWith("<")) {
          _jsrSourceCache.set(fileUrl, code);
          return code;
        }
      }
    } catch {
      // 忽略
    }
  }
  return null;
}

/**
 * 解析 jsr: / npm: 协议路径：非浏览器模式一律走 deno-protocol，由 onLoad 用 https fetch 取内容并打包
 *
 * @param protocolPath - 协议路径（如 jsr:@dreamer/logger@1.0.0-beta.4）
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
  return { path: protocolPath, namespace: "deno-protocol" };
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
       * 在相对路径 onResolve 中优先用此缓存把 ../encryption/... 等解析到磁盘文件。
       */
      const protocolResolveDirCache = new Map<string, string>();

      /** 同一 build 内 protocolPath → file:// URL 缓存，避免重复 resolve/子进程 */
      const protocolPathToFileUrlCache = new Map<string, string>();

      /** relative onResolve 内 protocolPath → import.meta.resolve 结果缓存 */
      const protocolPathToImporterUrlCache = new Map<string, string | null>();

      /** deno.json 解析结果缓存，避免同一文件重复读盘 */
      const configCache = new Map<string, DenoConfig>();
      const getConfig = (jsonPath: string): DenoConfig | undefined => {
        let c = configCache.get(jsonPath);
        if (c !== undefined) return c;
        try {
          c = JSON.parse(readTextFileSync(jsonPath)) as DenoConfig;
          configCache.set(jsonPath, c);
          return c;
        } catch {
          return undefined;
        }
      };

      // 1. 处理路径别名（通过 deno.json imports 配置）
      build.onResolve(
        { filter: /^(@\/|~\/|@[^/]+\/|~[^/]+\/)/ },
        (args): esbuild.OnResolveResult | undefined => {
          const path = args.path;
          const startDir = args.importer
            ? dirname(args.importer)
            : (args.resolveDir || cwd());
          const projectDenoJsonPath = findProjectDenoJson(startDir);
          if (!projectDenoJsonPath) return undefined;
          const config = getConfig(projectDenoJsonPath);
          if (!config?.imports) return undefined;
          const sortedKeys = Object.keys(config.imports).sort(
            (a, b) => b.length - a.length,
          );
          for (const alias of sortedKeys) {
            if (!path.startsWith(alias)) continue;
            const aliasValue = config.imports[alias];
            if (!aliasValue) continue;
            const remainingPath = path.slice(alias.length);
            const resolvedPath = aliasValue.startsWith("./") ||
                aliasValue.startsWith("../")
              ? join(dirname(projectDenoJsonPath), aliasValue, remainingPath)
              : aliasValue + remainingPath;
            if (existsSync(resolvedPath)) {
              return { path: resolvedPath, namespace: "file" };
            }
            if (!resolvedPath.includes(".")) {
              const withTs = resolvedPath + ".ts";
              if (existsSync(withTs)) {
                return { path: withTs, namespace: "file" };
              }
            }
          }
          return undefined;
        },
      );

      // 2. 处理直接的 jsr: 和 npm: 协议导入
      // 例如：import { x } from "jsr:@dreamer/logger@1.0.0-beta.4"
      // 例如：import { x } from "npm:esbuild@^0.27.2"
      build.onResolve(
        { filter: /^(jsr|npm):/ },
        (args): esbuild.OnResolveResult | undefined =>
          resolveDenoProtocolPath(args.path, browserMode),
      );

      // 2. 匹配带有子路径的 @scope/package/subpath 模式
      // 例如：@dreamer/logger/client
      build.onResolve(
        { filter: /^@[^/]+\/[^/]+\/.+$/ },
        (args): esbuild.OnResolveResult | undefined => {
          const path = args.path;
          const parts = path.split("/");
          const packageName = `${parts[0]}/${parts[1]}`;
          const subpath = parts.slice(2).join("/");
          const startDir = args.importer
            ? dirname(args.importer)
            : (args.resolveDir || cwd());
          const projectDenoJsonPath = findProjectDenoJson(startDir);
          if (!projectDenoJsonPath) return undefined;
          const packageImport = getConfig(projectDenoJsonPath)?.imports?.[
            packageName
          ];
          if (!packageImport) return undefined;
          return resolveDenoProtocolPath(
            `${packageImport}/${subpath}`,
            browserMode,
          );
        },
      );

      // 3. 处理 deno-protocol namespace 中的相对路径导入
      // 当文件内部有相对路径导入（如 ../encryption/encryption-manager.ts）时，
      // 需要从文件的 resolveDir 解析这些相对路径
      build.onResolve(
        { filter: /^\.\.?\/.*/, namespace: "deno-protocol" },
        async (args): Promise<esbuild.OnResolveResult | undefined> => {
          // 相对路径导入，需要从 importer 的目录解析
          // importer 可能是 deno-protocol:jsr:@dreamer/socket-io@1.0.0-beta.2/client
          // 需要先提取协议路径（去掉 deno-protocol: 前缀），然后解析为实际文件路径
          const importer = args.importer;
          if (!importer) {
            return undefined;
          }

          try {
            // 提取协议路径（去掉 deno-protocol: 前缀）
            let protocolPath = importer;
            if (importer.startsWith("deno-protocol:")) {
              protocolPath = importer.slice("deno-protocol:".length);
            }

            // 优先用 onLoad 已缓存的 resolveDir 从磁盘解析
            const cachedDir = protocolResolveDirCache.get(protocolPath);
            if (cachedDir) {
              const resolvedPath = join(cachedDir, args.path);
              if (existsSync(resolvedPath)) {
                return { path: resolvedPath, namespace: "file" };
              }
              if (!resolvedPath.includes(".")) {
                const withTs = resolvedPath + ".ts";
                if (existsSync(withTs)) {
                  return { path: withTs, namespace: "file" };
                }
              }
            }

            // 复用同一 protocolPath 的 resolve 结果，避免重复 import.meta.resolve
            let importerUrl: string | undefined;
            if (protocolPathToImporterUrlCache.has(protocolPath)) {
              const v = protocolPathToImporterUrlCache.get(protocolPath)!;
              importerUrl = v === null ? undefined : v;
            } else {
              try {
                importerUrl = await import.meta.resolve(protocolPath) as string;
              } catch {
                importerUrl = undefined;
              }
              protocolPathToImporterUrlCache.set(
                protocolPath,
                importerUrl ?? null,
              );
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
            } else if (importerUrl && (importerUrl.startsWith("https://") || importerUrl.startsWith("http://"))) {
              // 如果 importer 是 HTTP URL，从 HTTP URL 解析相对路径
              // 例如：https://jsr.io/@dreamer/socket-io/1.0.0-beta.2/src/client/mod.ts
              // + ../encryption/encryption-manager.ts
              // -> https://jsr.io/@dreamer/socket-io/1.0.0-beta.2/src/encryption/encryption-manager.ts
              try {
                const importerUrlObj = new URL(importerUrl);
                const importerPathname = importerUrlObj.pathname;
                const importerDir = importerPathname.substring(0, importerPathname.lastIndexOf("/"));
                const resolvedPathname = new URL(args.path, `${importerUrlObj.protocol}//${importerUrlObj.host}${importerDir}/`).pathname;
                // 尝试从 HTTP URL 推断协议路径
                // 例如：https://jsr.io/@dreamer/socket-io/1.0.0-beta.2/src/encryption/encryption-manager.ts
                // -> jsr:@dreamer/socket-io@1.0.0-beta.2/encryption/encryption-manager.ts
                const match = importerPathname.match(/\/@dreamer\/([^\/]+)\/([^\/]+)\/(.+)/);
                if (match) {
                  const [, packageName, version] = match;
                  const relativeMatch = resolvedPathname.match(/\/@dreamer\/([^\/]+)\/([^\/]+)\/(.+)/);
                  if (relativeMatch) {
                    const [, , , relativePath] = relativeMatch;
                    const normalizedPath = relativePath.replace(/^src\//, "");
                    const fullProtocolPath = `jsr:@dreamer/${packageName}@${version}/${normalizedPath}`;
                    return {
                      path: fullProtocolPath,
                      namespace: "deno-protocol",
                    };
                  }
                }
              } catch {
                // 忽略错误
              }
            }

            // 如果无法通过文件路径解析，尝试构建完整的协议路径
            // 例如：jsr:@dreamer/socket-io@1.0.0-beta.2/client + ../encryption/encryption-manager.ts
            // -> jsr:@dreamer/socket-io@1.0.0-beta.2/encryption/encryption-manager.ts
            try {
              // 从 importer 路径构建相对路径的协议路径
              // importer 可能是 deno-protocol:jsr:@dreamer/socket-io@1.0.0-beta.2/client
              // 需要先去掉 deno-protocol: 前缀
              let importerProtocolPath = importer;
              if (importerProtocolPath.startsWith("deno-protocol:")) {
                importerProtocolPath = importerProtocolPath.slice("deno-protocol:".length);
              }
              // 移除最后一个路径段（如 /client）
              const baseProtocolPath = importerProtocolPath.replace(
                /\/[^/]+$/,
                "",
              );
              const relativePath = args.path;

              // 规范化相对路径（处理 ../ 和 ./）
              // 处理多个 ../ 的情况，例如 ../../encryption/encryption-manager.ts
              let normalizedPath = relativePath;
              let depth = 0;
              while (normalizedPath.startsWith("../")) {
                normalizedPath = normalizedPath.slice(3);
                depth++;
              }
              if (normalizedPath.startsWith("./")) {
                normalizedPath = normalizedPath.slice(2);
              }

              // 根据深度移除对应的路径段，但不能越过包根（jsr:@scope/name@version 只有 2 段）
              // 例如：jsr:@dreamer/socket-io@1.0.0-beta.2/client，depth=1 时 base 已是包根，不应再 strip
              const segments = baseProtocolPath.split("/");
              const maxDepth = Math.max(0, segments.length - 2);
              const actualDepth = Math.min(depth, maxDepth);
              let currentBasePath = baseProtocolPath;
              for (let i = 0; i < actualDepth; i++) {
                currentBasePath = currentBasePath.replace(/\/[^/]+$/, "");
              }

              const fullProtocolPath = `${currentBasePath}/${normalizedPath}`;

              // 在插件上下文中只做一次 resolve，拿不到 file:// 就返回 deno-protocol 交给 onLoad（含 fetchJsrSourceViaMeta）
              try {
                let resolvedProtocolUrl: string | undefined;
                try {
                  resolvedProtocolUrl = await import.meta.resolve(fullProtocolPath);
                } catch {
                  // 忽略
                }

                if (resolvedProtocolUrl && resolvedProtocolUrl.startsWith("file://")) {
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
                  namespace: "deno-protocol",
                };
              } catch {
                return {
                  path: fullProtocolPath,
                  namespace: "deno-protocol",
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
        { filter: /.*/, namespace: "deno-protocol" },
        async (args): Promise<esbuild.OnLoadResult | undefined> => {
          const protocolPath = args.path;

          try {
            // 复用同一 protocolPath 的 resolve 结果，避免重复 resolve/子进程
            let fileUrl = protocolPathToFileUrlCache.get(protocolPath);

            if (fileUrl === undefined) {
              // 在插件上下文中 import.meta.resolve 用 esbuild 的 deno.json，拿不到项目的 file://
              try {
                fileUrl = await import.meta.resolve(protocolPath) as string;
              } catch {
                fileUrl = undefined;
              }
              if (!fileUrl?.startsWith("file://")) {
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
                    if (line.startsWith("file://")) fileUrl = line;
                  }
                } catch {
                  // 忽略
                }
              }
              if (fileUrl?.startsWith("file://")) {
                protocolPathToFileUrlCache.set(protocolPath, fileUrl);
              }
            }

            // 如果 resolve 得到 file:// URL，读取文件内容
            if (fileUrl && fileUrl.startsWith("file://")) {
              let filePath = fileUrl.slice(7);
              try {
                filePath = decodeURIComponent(filePath);
              } catch {
                // 忽略解码错误
              }

              // 设置 resolveDir 为文件所在目录，以便 esbuild 能解析文件内部的相对路径导入
              const resolveDir = dirname(filePath);
              protocolResolveDirCache.set(protocolPath, resolveDir);

              if (existsSync(filePath)) {
                const contents = await readTextFile(filePath);
                const loader = getLoaderFromPath(filePath);
                return {
                  contents,
                  loader,
                  resolveDir,
                };
              }
              // 文件不存在时仍设置 resolveDir，返回空内容
              const loader = getLoaderFromPath(filePath);
              return {
                contents: "",
                loader,
                resolveDir,
              };
            }
            if (
              fileUrl &&
              (fileUrl.startsWith("https://") || fileUrl.startsWith("http://"))
            ) {
              // 步骤 5: 如果 resolve 返回 HTTP URL，使用 fetch 获取内容
              try {
                const response = await fetch(fileUrl);
                if (response.ok) {
                  const contents = await response.text();
                  const loader = getLoaderFromPath(fileUrl);
                  const resolveDir = cwd();
                  return {
                    contents,
                    loader,
                    resolveDir,
                  };
                }
              } catch {
                // 忽略 fetch 错误
              }
            }
            if (
              fileUrl &&
              (fileUrl.startsWith("jsr:") || fileUrl.startsWith("npm:"))
            ) {
              // 步骤 6: 子进程也未得到 file:// 时，用 JSR _meta.json 的 manifest/exports 解析真实路径再 fetch 源码（含缓存）
              if (protocolPath.startsWith("jsr:")) {
                const contents = await fetchJsrSourceViaMeta(protocolPath);
                if (contents != null) {
                  const loader = getLoaderFromPath(protocolPath);
                  const resolveDir = cwd();
                  return { contents, loader, resolveDir };
                }
              }
              const resolveDir = cwd();
              const loader = getLoaderFromPath(protocolPath);
              return { contents: "", loader, resolveDir };
            }

            // 所有方法都失败时，至少设置 resolveDir
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
