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
 * 从项目的 deno.json 中获取包的导入映射
 *
 * @param projectDenoJsonPath - 项目的 deno.json 路径
 * @param packageName - 包名（如 @dreamer/logger）
 * @returns 包的导入路径（如 jsr:@dreamer/logger@1.0.0-beta.4），如果未找到返回 undefined
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

/** 调试日志前缀，便于过滤 fetchJsrSourceViaMeta 相关输出 */
const LOG_PREFIX_JSR_META = "[resolver:jsrMeta]";

/**
 * 用 JSR version_meta.json 的 manifest/exports 解析子路径，再 fetch 源码 URL 取内容。
 * 不猜路径：manifest 里是包内真实路径（如 /src/encryption/encryption-manager.ts），exports 是子路径→文件映射。
 *
 * @param protocolPath - jsr: 协议路径（如 jsr:@dreamer/socket-io@1.0.0-beta.2/encryption/encryption-manager.ts）
 * @returns 源码内容，失败返回 null
 */
async function fetchJsrSourceViaMeta(protocolPath: string): Promise<string | null> {
  if (!protocolPath.startsWith("jsr:")) {
    console.log(`${LOG_PREFIX_JSR_META} 非 jsr: 协议，返回 null protocolPath=${protocolPath.slice(0, 60)}...`);
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
      console.log(`${LOG_PREFIX_JSR_META} 无 @ 且不足两段(scope/name)，返回 null protocolPath=${protocolPath.slice(0, 60)}...`);
      return null;
    }
    scopeAndName = `${parts[0]}/${parts[1]}`;
    subpath = parts.length > 2 ? parts.slice(2).join("/") : "";
    const pkgMetaUrl = `https://jsr.io/${scopeAndName}/meta.json`;
    let pkgMeta: { versions?: Record<string, { yanked?: boolean }> };
    try {
      const pr = await fetch(pkgMetaUrl, { headers: { Accept: JSR_ACCEPT_JSON } });
      if (!pr.ok) {
        console.log(`${LOG_PREFIX_JSR_META} 无版本号时包级 meta 请求非 ok status=${pr.status} url=${pkgMetaUrl}`);
        return null;
      }
      const pkgText = await pr.text();
      if (!pkgText || pkgText.trimStart().startsWith("<")) {
        console.log(`${LOG_PREFIX_JSR_META} 无版本号时包级 meta 内容为空或 HTML url=${pkgMetaUrl}`);
        return null;
      }
      pkgMeta = JSON.parse(pkgText) as { versions?: Record<string, { yanked?: boolean }> };
    } catch (e) {
      console.log(`${LOG_PREFIX_JSR_META} 无版本号时包级 meta 请求或解析异常 url=${pkgMetaUrl} error=${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
    const versions = pkgMeta.versions ?? {};
    const nonYanked = Object.keys(versions).filter((k) => !versions[k]?.yanked).sort();
    if (nonYanked.length === 0) {
      console.log(`${LOG_PREFIX_JSR_META} 无版本号且无可用版本 scopeAndName=${scopeAndName}`);
      return null;
    }
    version = nonYanked[nonYanked.length - 1];
    console.log(`${LOG_PREFIX_JSR_META} 无 @，从包级 meta 取最新版本 scopeAndName=${scopeAndName} version=${version} subpath=${subpath || "(主入口)"}`);
  } else {
    scopeAndName = after.slice(0, lastAtIdx);
    const versionAndPath = after.slice(lastAtIdx + 1);
    const slashInRest = versionAndPath.indexOf("/");
    version = slashInRest === -1 ? versionAndPath : versionAndPath.slice(0, slashInRest);
    subpath = slashInRest === -1 ? "" : versionAndPath.slice(slashInRest + 1);
    console.log(`${LOG_PREFIX_JSR_META} 解析 protocolPath scopeAndName=${scopeAndName} version=${version} subpath=${subpath || "(主入口)"}`);
  }

  const base = `https://jsr.io/${scopeAndName}/${version}`;
  const metaUrl = `${base}_meta.json`;
  let meta: { manifest?: Record<string, unknown>; exports?: Record<string, string> };
  try {
    const r = await fetch(metaUrl, { headers: { Accept: JSR_ACCEPT_JSON } });
    if (!r.ok) {
      console.log(`${LOG_PREFIX_JSR_META} _meta.json 请求非 ok status=${r.status} url=${metaUrl}`);
      return null;
    }
    const text = await r.text();
    if (!text || text.trimStart().startsWith("<")) {
      console.log(`${LOG_PREFIX_JSR_META} _meta.json 内容为空或为 HTML len=${text?.length ?? 0} startsWith=<`);
      return null;
    }
    meta = JSON.parse(text) as { manifest?: Record<string, unknown>; exports?: Record<string, string> };
    console.log(`${LOG_PREFIX_JSR_META} _meta.json 解析成功 manifestKeys=${Object.keys(meta.manifest ?? {}).length} exportKeys=${Object.keys(meta.exports ?? {}).length}`);
  } catch (e) {
    console.log(`${LOG_PREFIX_JSR_META} _meta.json 请求或解析异常 url=${metaUrl} error=${e instanceof Error ? e.message : String(e)}`);
    return null;
  }

  const manifest = meta.manifest ?? {};
  const exports = meta.exports ?? {};
  // 优先 exports："./client" -> "./src/client/mod.ts"，取掉 "./" 得 path
  const exportKey = subpath ? `./${subpath}` : ".";
  let pathFromExport = exports[exportKey];
  if (pathFromExport && typeof pathFromExport === "string") {
    pathFromExport = pathFromExport.replace(/^\.\//, "");
  }
  if (pathFromExport && typeof manifest[`/${pathFromExport}`] === "object") {
    const fileUrl = `${base}/${pathFromExport}`;
    try {
      const fr = await fetch(fileUrl, { headers: { Accept: JSR_ACCEPT_SOURCE } });
      if (!fr.ok) {
        console.log(`${LOG_PREFIX_JSR_META} exports 分支 fetch 非 ok status=${fr.status} pathFromExport=${pathFromExport}`);
      } else {
        const code = await fr.text();
        if (code && !code.trimStart().startsWith("<")) {
          console.log(`${LOG_PREFIX_JSR_META} exports 分支 返回源码 len=${code.length} exportKey=${exportKey}`);
          return code;
        }
        console.log(`${LOG_PREFIX_JSR_META} exports 分支 响应为 HTML 或空 pathFromExport=${pathFromExport}`);
      }
    } catch (e) {
      console.log(`${LOG_PREFIX_JSR_META} exports 分支 fetch 异常 pathFromExport=${pathFromExport} error=${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    console.log(`${LOG_PREFIX_JSR_META} exports 未命中或 manifest 无该 path exportKey=${exportKey} pathFromExport=${pathFromExport ?? "(无)"}`);
  }
  // 主入口只认 meta 里的 exports["."]，可能是 mod.ts、index.ts、main.ts 等，不写死
  if (!subpath) {
    console.log(`${LOG_PREFIX_JSR_META} 主入口且 exports 未命中，返回 null`);
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
    try {
      const fr = await fetch(`${base}/${pathSlice}`, { headers: { Accept: JSR_ACCEPT_SOURCE } });
      if (!fr.ok) {
        console.log(`${LOG_PREFIX_JSR_META} manifest 分支 fetch 非 ok status=${fr.status} pathKey=${pathKey}`);
      } else {
        const code = await fr.text();
        if (code && !code.trimStart().startsWith("<")) {
          console.log(`${LOG_PREFIX_JSR_META} manifest 分支 返回源码 len=${code.length} subpathNoExt=${subpathNoExt} pathKey=${pathKey}`);
          return code;
        }
        console.log(`${LOG_PREFIX_JSR_META} manifest 分支 响应为 HTML 或空 pathKey=${pathKey}`);
      }
    } catch (e) {
      console.log(`${LOG_PREFIX_JSR_META} manifest 分支 fetch 异常 pathKey=${pathKey} error=${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    console.log(`${LOG_PREFIX_JSR_META} manifest 未匹配到 key subpathNoExt=${subpathNoExt} manifestKeysSample=${manifestKeys.slice(0, 5).join(",")}`);
  }
  console.log(`${LOG_PREFIX_JSR_META} 全部未命中，返回 null protocolPath=${protocolPath.slice(0, 80)}...`);
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
          try {
            const content = readTextFileSync(projectDenoJsonPath);
            const config: DenoConfig = JSON.parse(content);

            if (!config.imports) {
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
          } catch (_error) {
            // 忽略错误，返回 undefined
          }

          return undefined;
        },
      );

      // 2. 处理直接的 jsr: 和 npm: 协议导入
      // 例如：import { x } from "jsr:@dreamer/logger@1.0.0-beta.4"
      // 例如：import { x } from "npm:esbuild@^0.27.2"
      build.onResolve(
        { filter: /^(jsr|npm):/ },
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

          return resolveDenoProtocolPath(path, browserMode);
        },
      );

      // 2. 匹配带有子路径的 @scope/package/subpath 模式
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
          // 例如：jsr:@dreamer/logger@1.0.0-beta.4 + /client -> jsr:@dreamer/logger@1.0.0-beta.4/client
          // 例如：npm:lodash@^4.17.21 + /map -> npm:lodash@^4.17.21/map
          const subpath = subpathParts.join("/");
          const fullProtocolPath = `${packageImport}/${subpath}`;

          // 浏览器模式：将依赖转换为 CDN URL 并标记为 external
          if (browserMode) {
            const browserUrl = convertSpecifierToBrowserUrl(fullProtocolPath);
            if (browserUrl) {
              return {
                path: browserUrl,
                external: true,
              };
            }
          }

          return resolveDenoProtocolPath(fullProtocolPath, browserMode);
        },
      );

      /** 调试日志前缀，便于过滤 */
      const LOG_PREFIX_REL = "[resolver:relPath]";
      const LOG_PREFIX_LOAD = "[resolver:onLoad]";

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
          console.log(`${LOG_PREFIX_REL} 进入 relative onResolve importer=${importer ?? "(null)"} path=${args.path}`);
          if (!importer) {
            console.log(`${LOG_PREFIX_REL} 无 importer，返回 undefined`);
            return undefined;
          }

          try {
            // 提取协议路径（去掉 deno-protocol: 前缀）
            let protocolPath = importer;
            if (importer.startsWith("deno-protocol:")) {
              protocolPath = importer.slice("deno-protocol:".length);
            }
            console.log(`${LOG_PREFIX_REL} 提取 protocolPath=${protocolPath}`);

            // 优先用 onLoad 已缓存的 resolveDir 从磁盘解析，避免子路径走 deno-protocol onLoad 返回空内容导致 "has no exports"
            const cachedDir = protocolResolveDirCache.get(protocolPath);
            console.log(`${LOG_PREFIX_REL} 查缓存 protocolPath=${protocolPath} cachedDir=${cachedDir ?? "(未命中)"}`);
            if (cachedDir) {
              const resolvedPath = join(cachedDir, args.path);
              if (existsSync(resolvedPath)) {
                console.log(`${LOG_PREFIX_REL} 缓存命中→file path=${resolvedPath}`);
                return { path: resolvedPath, namespace: "file" };
              }
              // 无扩展名时尝试 .ts
              if (!resolvedPath.includes(".")) {
                const withTs = resolvedPath + ".ts";
                if (existsSync(withTs)) {
                  console.log(`${LOG_PREFIX_REL} 缓存命中→file path=${withTs} (.ts)`);
                  return { path: withTs, namespace: "file" };
                }
              }
              console.log(`${LOG_PREFIX_REL} 缓存命中但路径不存在 resolvedPath=${resolvedPath} withTs 也不存在`);
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
              console.log(`${LOG_PREFIX_REL} import.meta.resolve 得到 file:// importerPath=${importerPath}`);

              if (existsSync(importerPath)) {
                // 从 importer 的目录解析相对路径
                const importerDir = dirname(importerPath);
                const resolvedPath = join(importerDir, args.path);

                if (existsSync(resolvedPath)) {
                  console.log(`${LOG_PREFIX_REL} 从 file importer 解析成功 path=${resolvedPath}`);
                  return {
                    path: resolvedPath,
                    namespace: "file",
                  };
                }
                console.log(`${LOG_PREFIX_REL} 从 file importer 解析失败 resolvedPath 不存在=${resolvedPath}`);
              } else {
                console.log(`${LOG_PREFIX_REL} importerPath 不存在=${importerPath}`);
              }
            } else if (importerUrl && (importerUrl.startsWith("https://") || importerUrl.startsWith("http://"))) {
              console.log(`${LOG_PREFIX_REL} import.meta.resolve 得到 http(s) importerUrl=${importerUrl?.slice(0, 80)}...`);
              // 如果 importer 是 HTTP URL，从 HTTP URL 解析相对路径
              // 例如：https://jsr.io/@dreamer/socket-io/1.0.0-beta.2/src/client/mod.ts
              // + ../encryption/encryption-manager.ts
              // -> https://jsr.io/@dreamer/socket-io/1.0.0-beta.2/src/encryption/encryption-manager.ts
              try {
                const importerUrlObj = new URL(importerUrl);
                const importerPathname = importerUrlObj.pathname;
                const importerDir = importerPathname.substring(0, importerPathname.lastIndexOf("/"));
                const resolvedPathname = new URL(args.path, `${importerUrlObj.protocol}//${importerUrlObj.host}${importerDir}/`).pathname;
                const resolvedUrl = `${importerUrlObj.protocol}//${importerUrlObj.host}${resolvedPathname}`;
                
                // 返回一个 deno-protocol namespace 的结果，让 onLoad 钩子来处理
                // 但是，我们需要构建一个协议路径，而不是直接使用 HTTP URL
                // 尝试从 HTTP URL 推断协议路径
                // 例如：https://jsr.io/@dreamer/socket-io/1.0.0-beta.2/src/encryption/encryption-manager.ts
                // -> jsr:@dreamer/socket-io@1.0.0-beta.2/encryption/encryption-manager.ts
                const match = importerPathname.match(/\/@dreamer\/([^\/]+)\/([^\/]+)\/(.+)/);
                if (match) {
                  const [, packageName, version, path] = match;
                  // 从 importer 路径推断相对路径的协议路径
                  const relativeMatch = resolvedPathname.match(/\/@dreamer\/([^\/]+)\/([^\/]+)\/(.+)/);
                  if (relativeMatch) {
                    const [, , , relativePath] = relativeMatch;
                    // 移除 src/ 前缀（如果存在）
                    const normalizedPath = relativePath.replace(/^src\//, "");
                    const fullProtocolPath = `jsr:@dreamer/${packageName}@${version}/${normalizedPath}`;
                    // 返回 deno-protocol namespace，让 onLoad 钩子来处理
                    console.log(`${LOG_PREFIX_REL} 从 http importer 推断协议路径 fullProtocolPath=${fullProtocolPath} → deno-protocol`);
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

            console.log(`${LOG_PREFIX_REL} 进入“构建完整协议路径”分支 protocolPath=${protocolPath} args.path=${args.path}`);

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

              // 根据深度移除对应的路径段
              // 例如：jsr:@dreamer/socket-io@1.0.0-beta.2/client，depth=1 -> jsr:@dreamer/socket-io@1.0.0-beta.2
              let currentBasePath = baseProtocolPath;
              for (let i = 0; i < depth; i++) {
                currentBasePath = currentBasePath.replace(/\/[^/]+$/, "");
              }

              const fullProtocolPath = `${currentBasePath}/${normalizedPath}`;

              // 在插件上下文中只做一次 resolve，拿不到 file:// 就返回 deno-protocol 交给 onLoad（含子进程 resolve）
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
                    console.log(`${LOG_PREFIX_REL} 从 fullProtocolPath 解析成功 path=${resolvedProtocolPath}`);
                    return {
                      path: resolvedProtocolPath,
                      namespace: "file",
                    };
                  }
                }
              } catch {
                // 如果解析失败，返回一个 deno-protocol namespace 的结果
                // 让 onLoad 钩子来处理
                console.log(`${LOG_PREFIX_REL} fullProtocolPath 解析失败，返回 deno-protocol fullProtocolPath=${fullProtocolPath}`);
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

          console.log(`${LOG_PREFIX_REL} 所有分支未命中，返回 undefined importer=${importer} path=${args.path}`);
          return undefined;
        },
      );

      // 4. 添加 onLoad 钩子来处理 deno-protocol namespace 的模块加载
      // 统一处理 jsr: 和 npm: 协议的模块加载
      build.onLoad(
        { filter: /.*/, namespace: "deno-protocol" },
        async (args): Promise<esbuild.OnLoadResult | undefined> => {
          const protocolPath = args.path;
          console.log(`${LOG_PREFIX_LOAD} 进入 onLoad protocolPath=${protocolPath}`);

          try {
            // 步骤 1: 先使用动态导入触发 Deno 下载和缓存模块
            // 这会确保模块被下载到 Deno 缓存中（适用于 jsr: 和 npm:）
            try {
              await import(protocolPath);
              console.log(`${LOG_PREFIX_LOAD} 动态 import 成功 protocolPath=${protocolPath}`);
            } catch (_importError) {
              console.log(`${LOG_PREFIX_LOAD} 动态 import 失败或忽略 protocolPath=${protocolPath}`);
              // 忽略导入错误，可能模块已经加载
            }

            // 步骤 2～3: 在插件上下文中 import.meta.resolve 用的是 esbuild 的 deno.json，拿不到项目的 file://，
            // 只做一次 resolve，拿不到就交给步骤 3.5 子进程在项目目录下解析
            let fileUrl: string | undefined;
            try {
              fileUrl = await import.meta.resolve(protocolPath);
            } catch {
              // 忽略
            }

            console.log(`${LOG_PREFIX_LOAD} resolve 一次结束 protocolPath=${protocolPath} fileUrl=${fileUrl ? (fileUrl.startsWith("file://") ? fileUrl.slice(0, 80) + "..." : fileUrl.slice(0, 80) + "...") : "(undefined)"}`);

            // 步骤 3.5: 插件里 import.meta.resolve 用的是 esbuild 的上下文，拿不到项目的 deno.json；
            // 若未得到 file://，在项目目录下起子进程做 resolve，用项目的 deno.json 得到真实 file://
            if (!fileUrl || !fileUrl.startsWith("file://")) {
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
                    console.log(`${LOG_PREFIX_LOAD} 子进程 resolve 得到 file:// protocolPath=${protocolPath}`);
                  }
                }
              } catch (_e) {
                console.log(`${LOG_PREFIX_LOAD} 子进程 resolve 失败 protocolPath=${protocolPath}`);
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
              console.log(`${LOG_PREFIX_LOAD} file:// 分支 写入缓存 protocolPath=${protocolPath} resolveDir=${resolveDir}`);

              if (existsSync(filePath)) {
                const contents = await readTextFile(filePath);
                console.log(`${LOG_PREFIX_LOAD} file:// 分支 返回内容 filePath=${filePath} len=${contents.length}`);

                // 根据文件扩展名确定 loader
                const loader = getLoaderFromPath(filePath);

                return {
                  contents,
                  loader,
                  resolveDir,
                };
              } else {
                // 文件不存在，但仍然需要设置 resolveDir
                // 这样 esbuild 才能正确解析文件内部的相对路径导入
                // 返回一个空内容，让 esbuild 知道这个文件存在但为空
                console.log(`${LOG_PREFIX_LOAD} file:// 分支 文件不存在，返回空内容 filePath=${filePath}`);
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
              console.log(`${LOG_PREFIX_LOAD} 进入 https/http 分支 protocolPath=${protocolPath} fileUrl=${fileUrl.slice(0, 60)}...`);
              // 步骤 5: 如果 resolve 返回 HTTP URL，使用 fetch 获取内容
              // 这种情况可能发生在 Deno 还没有完全缓存模块时
              // 注意：对于 JSR/NPM 的 HTTP URL，通常返回的是 HTML 页面，不是源代码
              // 所以这里应该尽量避免使用
              try {
                const response = await fetch(fileUrl);
                if (response.ok) {
                  const contents = await response.text();
                  const loader = getLoaderFromPath(fileUrl);
                  const resolveDir = cwd();
                  // 不写入缓存：https 下 resolveDir 用的是 cwd()，会污染相对路径解析（如 ../encryption/ 被算成项目根/../encryption/）
                  // 相对导入交由 relative onResolve 的「从 http importer 推断协议路径」处理
                  console.log(`${LOG_PREFIX_LOAD} https 分支 返回内容 len=${contents.length} 不写缓存`);
                  return {
                    contents,
                    loader,
                    resolveDir,
                  };
                }
                console.log(`${LOG_PREFIX_LOAD} https 分支 fetch 非 ok status=${response.status}`);
              } catch (_fetchError) {
                  // 忽略 fetch 错误
                  console.log(`${LOG_PREFIX_LOAD} https 分支 fetch 异常`);
              }
            } else if (
              fileUrl &&
              (fileUrl.startsWith("jsr:") || fileUrl.startsWith("npm:"))
            ) {
              // 步骤 6: 子进程也未得到 file:// 时，用 JSR _meta.json 的 manifest/exports 解析真实路径再 fetch 源码（非 CDN）
              if (protocolPath.startsWith("jsr:")) {
                const contents = await fetchJsrSourceViaMeta(protocolPath);
                if (contents != null) {
                  const loader = getLoaderFromPath(protocolPath);
                  const resolveDir = cwd();
                  console.log(`${LOG_PREFIX_LOAD} jsr 分支 通过 _meta.json fetch 源码 len=${contents.length} 不写缓存`);
                  return { contents, loader, resolveDir };
                }
              }
              const resolveDir = cwd();
              const loader = getLoaderFromPath(protocolPath);
              console.log(`${LOG_PREFIX_LOAD} jsr/npm 分支 无 file:// 且 jsr fetch 失败，返回空内容 不写缓存`);
              return { contents: "", loader, resolveDir };
            }

            // 如果所有方法都失败，至少设置 resolveDir
            // 这样 esbuild 才能正确解析文件内部的相对路径导入
            const resolveDir = cwd();
            protocolResolveDirCache.set(protocolPath, resolveDir);
            const loader = getLoaderFromPath(protocolPath);
            console.log(`${LOG_PREFIX_LOAD} 最终回退 返回空内容 protocolPath=${protocolPath} resolveDir=cwd()=${resolveDir}`);
            return {
              contents: "",
              loader,
              resolveDir,
            };
          } catch (_error) {
            // 忽略错误，返回 undefined
            console.log(`${LOG_PREFIX_LOAD} onLoad 异常 protocolPath=${protocolPath} error=${_error instanceof Error ? _error.message : String(_error)}`);
            return undefined;
          }
        },
      );
    },
  };
}
