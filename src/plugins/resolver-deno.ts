/**
 * @module @dreamer/esbuild/plugins/resolver
 *
 * 统一模块解析插件（Deno）：仅用本项目 deno.json 依赖图 + 本地缓存，不走网络。
 * - 路径别名、bare specifier 从项目 deno.json 解析
 * - jsr:/npm 从预构建 moduleCache 查找（先精确 get，未命中则正则匹配 key）
 * - npm: 在 cache 未收录时（常见于 JSR 传递依赖内的 `npm:包@版本`）回退为 `deno eval` + import.meta.resolve 解析到磁盘路径再交给 esbuild
 * - 相对路径：importer 在 cache 则 base = dirname(pathWithinPackage)，再 cacheLookup 目标
 */

import {
  basename,
  createCommand,
  cwd,
  dirname,
  ensureDir,
  existsSync,
  getEnv,
  join,
  readTextFileSync,
  relative,
  remove,
  resolve,
  statSync,
  walk,
  writeTextFile,
} from "@dreamer/runtime-adapter";
import * as esbuild from "esbuild";
import { $tr } from "../i18n.ts";
import type { BuildLogger } from "../types.ts";
import {
  computeDenoLockFingerprint,
  resolveDreamerProjectRootForCache,
  saveDenoModuleCacheToDisk,
  tryLoadDenoModuleCacheFromDisk,
} from "./deno-module-cache-disk.ts";

const PREFIX = "[resolver-deno]";

/** 将 file:// URL 转为本地文件系统路径 */
function fileUrlToPath(fileUrl: string): string {
  let path = fileUrl.slice(7);
  try {
    path = decodeURIComponent(path);
  } catch {
    /* ignore */
  }
  if (path.length >= 3 && /^\/[A-Za-z]:[/\\]/.test(path)) {
    path = path.slice(1);
  }
  return path;
}

/** 路径转为正斜杠，便于在 Windows 下传给 deno 子进程时避免反斜杠转义问题 */
function toForwardSlash(path: string): string {
  return path.replace(/\\/g, "/");
}

const NOOP_LOGGER: BuildLogger = {
  debug: () => {},
  info: () => {},
};

/** 模块缓存：specifier → 本地绝对路径（仅本项目依赖图内的模块） */
export type ModuleCache = Map<string, string>;

interface DenoInfoModule {
  kind: string;
  specifier: string;
  local?: string;
  dependencies?: Array<
    {
      specifier: string;
      code?: { specifier: string };
      type?: { specifier: string };
    }
  >;
}

export interface DenoInfoOutput {
  version: number;
  roots: string[];
  modules: DenoInfoModule[];
  redirects?: Record<string, string>;
}

/** 去掉 ANSI 颜色码，便于解析 `deno info` 文本输出。 */
function stripAnsi(text: string): string {
  return text.replace(
    new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g"),
    "",
  );
}

function fileOrLocalToPath(local: string): string {
  return local.startsWith("file://") ? fileUrlToPath(local) : local;
}

/** `https://jsr.io/@scope/name/1.2.3/path` → `jsr:@scope/name@1.2.3/path` */
function jsrSpecifierFromHttps(specifier: string): string | undefined {
  const jsrMatch = specifier.match(
    /^https:\/\/jsr\.io\/(@[^/]+\/[^/]+)\/([^/]+)\/(.+)$/,
  );
  if (!jsrMatch) return undefined;
  const [, scopeAndName, version, path] = jsrMatch;
  return `jsr:${scopeAndName}@${version}/${path}`;
}

/**
 * 从 `deno info --json` 取说明符对应的本地文件路径（跟随 redirects）。
 */
function localPathFromDenoInfoJson(
  info: DenoInfoOutput,
  specifier: string,
): string | undefined {
  const redirects = info.redirects ?? {};
  const target = redirects[specifier] ??
    (info.roots?.[0] ? (redirects[info.roots[0]] ?? info.roots[0]) : specifier);
  const bySpec = new Map<string, string>();
  for (const mod of info.modules) {
    if (!mod.specifier || !mod.local) continue;
    const localPath = fileOrLocalToPath(mod.local);
    bySpec.set(mod.specifier, localPath);
    const jsrKey = jsrSpecifierFromHttps(mod.specifier);
    if (jsrKey) bySpec.set(jsrKey, localPath);
  }
  return bySpec.get(target) ?? bySpec.get(specifier);
}

/** 解析 `deno info` 文本里的 `local:` 路径（兼容彩色输出）。 */
function parseDenoInfoLocalPath(text: string): string | undefined {
  const match = stripAnsi(text).match(/^local:\s+(.+)$/m);
  if (!match) return undefined;
  const localPath = match[1].trim();
  return localPath || undefined;
}

/**
 * 使用项目 deno.json 通过 Deno 将 `npm:` 说明符解析为本地文件绝对路径。
 * 与 `buildModuleCache` 内对 npm 的补全逻辑一致；供 cache 未收录传递依赖时使用。
 *
 * @param spec - 完整 npm 说明符，例如 `npm:tailwind-merge@^2.6.1`
 * @param denoJsonPath - 项目 `deno.json` 的绝对路径
 * @returns 存在的本地文件路径，失败则 `undefined`
 */
async function resolveNpmSpecifierToFilePath(
  spec: string,
  denoJsonPath: string,
): Promise<string | undefined> {
  const normalized = spec.replace(/^npm:\/+/, "npm:");
  if (!normalized.startsWith("npm:")) return undefined;
  const workDir = dirname(denoJsonPath);
  try {
    const proc = createCommand("deno", {
      args: [
        "eval",
        "--config",
        toForwardSlash(denoJsonPath),
        "const u=await import.meta.resolve(Deno.args[0]);console.log(u);",
        normalized,
      ],
      cwd: workDir,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    });
    const out = await proc.output();
    if (!out.success || !out.stdout) return undefined;
    const line = new TextDecoder().decode(out.stdout).trim();
    if (!line.startsWith("file://")) return undefined;
    const localPath = fileUrlToPath(line);
    if (existsSync(localPath)) return localPath;
  } catch {
    /* 与 buildModuleCache 一致：解析失败则忽略 */
  }
  return undefined;
}

/**
 * 使用项目 deno.json 通过 Deno 将 `jsr:` 说明符解析为本地文件绝对路径。
 * 与 `resolveNpmSpecifierToFilePath` 对称；供 moduleCache 未收录（常见于动态 import 的传递依赖）时回退解析。
 *
 * **Why**：`buildModuleCache` 以入口做 `deno info`，动态 `import()` 的传递依赖可能不进 cache；
 * jsr: 说明符在 cache miss 时无回退会直接报错，与 npm: 行为不对称。
 *
 * **注意**：`deno eval` + `import.meta.resolve` 对 `jsr:` 说明符只返回说明符自身（不解析到 file://），
 * 因此改用 `deno info --json` 跟随 redirects 取模块 `local` 路径；JSON 不可用时再回落文本 `local:`（先去掉 ANSI）。
 *
 * @param spec - 完整 jsr 说明符，例如 `jsr:@dreamer/web3@^1.1.1/client`
 * @param denoJsonPath - 项目 `deno.json` 的绝对路径
 * @returns 存在的本地文件路径，失败则 `undefined`
 */
/** Deno 远程缓存文件常无扩展名（内容哈希），不能当普通 file 交给 esbuild 按 JS 解析。 */
function isDenoExtensionlessCachePath(filePath: string): boolean {
  if (/\.(tsx?|jsx?|mts|mjs|cjs|json|css|wasm)$/i.test(filePath)) {
    return false;
  }
  const n = filePath.replace(/\\/g, "/");
  return n.includes("/remote/https/") ||
    n.includes("/deps/https/") ||
    n.includes("/Caches/deno/") ||
    n.includes("/.cache/deno/");
}

/** 从 deno info 模块里挑出带扩展名的 jsr: 缓存键，供 loader 与相对路径解析。 */
function cacheKeyFromDenoInfoModule(
  info: DenoInfoOutput,
  localPath: string,
  fallbackSpec: string,
): string {
  let found: string | undefined;
  for (const mod of info.modules) {
    if (!mod.specifier || !mod.local) continue;
    if (fileOrLocalToPath(mod.local) !== localPath) continue;
    const jsrKey = jsrSpecifierFromHttps(mod.specifier) ??
      (mod.specifier.startsWith("jsr:") ? mod.specifier : undefined);
    if (!jsrKey) continue;
    found = jsrKey;
    if (/\.(tsx?|jsx?|mts|mjs)$/i.test(jsrKey)) return jsrKey;
  }
  return found ?? fallbackSpec;
}

/**
 * cache miss 时把 jsr 说明符解析为本地路径，并尽量带上真实文件键。
 * 若传入 cache，会把本次 `deno info --json` 的模块图合并进去，供相对导入继续命中。
 */
async function resolveJsrSpecifierToCachedModule(
  spec: string,
  denoJsonPath: string,
  cache?: ModuleCache,
): Promise<{ localPath: string; cacheKey: string } | undefined> {
  const normalized = spec.replace(/^jsr:\/+/, "jsr:");
  if (!normalized.startsWith("jsr:")) return undefined;
  const workDir = dirname(denoJsonPath);
  try {
    const proc = createCommand("deno", {
      args: [
        "info",
        "--json",
        "--config",
        toForwardSlash(denoJsonPath),
        normalized,
      ],
      cwd: workDir,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    });
    const out = await proc.output();
    if (!out.success || !out.stdout) return undefined;
    const text = new TextDecoder().decode(out.stdout);
    try {
      const info = JSON.parse(text) as DenoInfoOutput;
      if (cache) {
        mergeDenoInfoModules(info, cache, new Set(), () => {});
      }
      const localPath = localPathFromDenoInfoJson(info, normalized);
      if (localPath && existsSync(localPath)) {
        return {
          localPath,
          cacheKey: cacheKeyFromDenoInfoModule(info, localPath, normalized),
        };
      }
    } catch {
      /* JSON 不可用时回落文本 */
    }
    const localPath = parseDenoInfoLocalPath(text);
    if (!localPath || !existsSync(localPath)) return undefined;
    return { localPath, cacheKey: normalized };
  } catch {
    /* 与 resolveNpmSpecifierToFilePath 一致：解析失败则忽略 */
  }
  return undefined;
}

/**
 * jsr cache miss 命中本地文件后的 onResolve 结果。
 * 无扩展名的 Deno 哈希缓存必须走 deno-protocol，否则 esbuild 按 JS 解析，
 * `import type` 与 JSX 都会失败，包内相对导入也找不到。
 */
function jsrCacheMissResolveResult(
  cache: ModuleCache,
  requestSpec: string,
  resolved: { localPath: string; cacheKey: string },
): { path: string; namespace: string } {
  cacheSet(cache, requestSpec, resolved.localPath);
  if (resolved.cacheKey !== requestSpec) {
    cacheSet(cache, resolved.cacheKey, resolved.localPath);
  }
  if (isDenoExtensionlessCachePath(resolved.localPath)) {
    return { path: resolved.cacheKey, namespace: NAMESPACE_DENO_PROTOCOL };
  }
  return { path: resolved.localPath, namespace: "file" };
}

/** .ts 里也可能有 JSX（如 view DevTools overlay）；用内容判断是否升级为 tsx。 */
function looksLikeJsx(contents: string): boolean {
  return /<[A-Za-z][\w:.]*(\s[^>]*>|>|\/>)/.test(contents) &&
    (/<\/[A-Za-z]/.test(contents) || /\sclass(Name)?=/.test(contents));
}

function inferEsbuildLoader(
  key: string,
  localPath: string,
  contents: string,
): "ts" | "tsx" | "js" | "jsx" | "json" {
  const loader = /\.(tsx?|jsx?|mts|mjs|json)$/i.test(key)
    ? getLoaderFromPath(key)
    : getLoaderFromPath(localPath);
  if (loader === "ts" && looksLikeJsx(contents)) return "tsx";
  if (loader === "js" && looksLikeJsx(contents)) return "jsx";
  return loader;
}

/**
 * 从入口所在端出发，只收集该端及其实际用到的本地依赖源文件。
 *
 * **Why**：`deno info` 以单入口为起点时，动态 `import()` 目标里的静态导入可能因无扩展名解析失败。
 * 聚合入口用来补这些传递依赖，但必须按「哪端打包就跑哪端」收窄：例如入口在
 * `src/backend` 时只扫 backend，再跟随 `@common/` 等本地 import map，
 * 绝不能把同仓的 `src/api`、`src/frontend`、`src/mobile` 一并塞进去。
 *
 * @param projectDir - 项目根目录（含 deno.json）
 * @param entryPoint - 本次构建入口（绝对或相对路径）
 * @param projectDenoJson - 项目 deno.json 绝对路径，用于解析本地 import map
 * @returns 源文件绝对路径数组（可能为空）
 */
async function collectProjectSourceFiles(
  projectDir: string,
  entryPoint: string,
  projectDenoJson?: string,
): Promise<string[]> {
  const projectRoot = resolve(projectDir);
  const entryAbs = resolve(projectRoot, entryPoint);
  const denoJsonDir = projectDenoJson ? dirname(projectDenoJson) : projectRoot;
  const config = projectDenoJson ? getDenoConfig(projectDenoJson) : undefined;

  const roots = new Set<string>();
  const seed = sourceRootForEntry(projectRoot, entryAbs);
  if (seed) addSourceRoot(roots, projectRoot, seed);
  if (existsSync(entryAbs)) {
    addSourceRoot(roots, projectRoot, dirname(entryAbs));
  }
  if (roots.size === 0) return [];

  const files = new Set<string>();
  try {
    let grew = true;
    while (grew) {
      grew = false;
      for (const root of [...roots]) {
        for (const file of await listSourceFilesInRoot(root)) {
          if (files.has(file)) continue;
          files.add(file);
          grew = true;
        }
      }
      for (const file of [...files]) {
        let source: string;
        try {
          source = readTextFileSync(file);
        } catch {
          continue;
        }
        for (const spec of extractModuleSpecifiers(source)) {
          const localRoot = resolveSpecifierToLocalRoot(
            file,
            spec,
            denoJsonDir,
            projectRoot,
            config,
          );
          if (localRoot && addSourceRoot(roots, projectRoot, localRoot)) {
            grew = true;
          }
        }
      }
    }
  } catch {
    /* 扫描失败则忽略，回退为仅入口 deno info */
  }
  return [...files];
}

/** 入口若在 `src/<端>/...`，该端目录即为种子根（如 `src/backend`）。 */
function sourceRootForEntry(
  projectRoot: string,
  entryAbs: string,
): string | undefined {
  const srcDir = join(projectRoot, "src");
  const rel = toForwardSlash(relative(srcDir, entryAbs));
  if (!rel || rel === ".." || rel.startsWith("../")) {
    return existsSync(entryAbs) ? dirname(entryAbs) : undefined;
  }
  const first = rel.split("/")[0];
  if (!first || first === ".") return srcDir;
  const candidate = join(srcDir, first);
  if (isExistingDir(candidate)) return candidate;
  return dirname(entryAbs);
}

function isPathInside(parent: string, child: string): boolean {
  const rel = toForwardSlash(relative(resolve(parent), resolve(child)));
  return rel === "" || (rel !== ".." && !rel.startsWith("../"));
}

/**
 * 只把项目根之内、且不是整个项目根的目录收进扫描根。
 * 避免相对路径走到 `src/` 或仓根时又把各端全部扫进去。
 * @returns 是否新增了根
 */
function addSourceRoot(
  roots: Set<string>,
  projectRoot: string,
  dir: string,
): boolean {
  const abs = resolve(dir);
  if (!isExistingDir(abs)) return false;
  if (!isPathInside(projectRoot, abs)) return false;
  if (abs === resolve(projectRoot)) return false;
  const srcDir = resolve(projectRoot, "src");
  if (abs === srcDir) return false;
  if (roots.has(abs)) return false;
  roots.add(abs);
  return true;
}

function isSkippableSourcePath(path: string): boolean {
  return toForwardSlash(path).split("/").some((part) =>
    part === "node_modules" ||
    part === "dist" ||
    part === "coverage" ||
    part === ".git" ||
    (part.startsWith(".") && part !== "." && part !== "..")
  );
}

async function listSourceFilesInRoot(root: string): Promise<string[]> {
  const files: string[] = [];
  if (!isExistingDir(root)) return files;
  for await (
    const path of walk(root, { includeFiles: true, includeDirs: false })
  ) {
    if (isSkippableSourcePath(path)) continue;
    if (/\.(tsx?|jsx?)$/i.test(path)) files.push(resolve(path));
  }
  return files;
}

/** 抽出静态／动态 import、export from 的模块说明符（去掉注释）。 */
function extractModuleSpecifiers(source: string): string[] {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:\\])\/\/.*$/gm, "$1");
  const specs: string[] = [];
  const re =
    /(?:import|export)(?:\s+type)?(?:[\s\S]*?\sfrom\s*|\s*)['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped))) {
    const spec = m[1] ?? m[2];
    if (spec) specs.push(spec);
  }
  return specs;
}

/**
 * 将说明符解析为应扫描的本地目录：相对路径落到的 `src/<端>`，
 * 或 import map 里指向项目内的目录（如 `@common/` → `src/common`）。
 * jsr:／npm:／项目外路径一律忽略。
 */
function resolveSpecifierToLocalRoot(
  importerFile: string,
  specifier: string,
  denoJsonDir: string,
  projectRoot: string,
  config: DenoConfig | undefined,
): string | undefined {
  if (
    specifier.startsWith("npm:") ||
    specifier.startsWith("jsr:") ||
    specifier.startsWith("http:") ||
    specifier.startsWith("https:") ||
    specifier.startsWith("node:") ||
    specifier.startsWith("data:")
  ) {
    return undefined;
  }

  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const abs = resolve(dirname(importerFile), specifier);
    const file = pickExistingScript(abs);
    const target = file ?? (isExistingDir(abs) ? abs : abs);
    return localScanRootForPath(projectRoot, target);
  }

  const mapped = resolveImportMapLocalDir(denoJsonDir, specifier, config);
  if (mapped) return mapped;

  return undefined;
}

/** 路径若在 `src/<端>/...`，返回该端目录；否则返回其所在目录（仍须在项目内）。 */
function localScanRootForPath(
  projectRoot: string,
  target: string,
): string | undefined {
  const abs = resolve(target);
  const srcDir = join(projectRoot, "src");
  if (isPathInside(srcDir, abs) && resolve(abs) !== resolve(srcDir)) {
    const rel = toForwardSlash(relative(srcDir, abs));
    const first = rel.split("/")[0];
    if (first && first !== ".." && first !== ".") {
      const root = join(srcDir, first);
      if (isExistingDir(root)) return root;
    }
  }
  const dir = isExistingFile(abs) ? dirname(abs) : abs;
  if (isPathInside(projectRoot, dir) && resolve(dir) !== resolve(projectRoot)) {
    return isExistingDir(dir) ? dir : dirname(dir);
  }
  return undefined;
}

/** 最长前缀匹配 deno.json imports，仅返回项目内的本地目录。 */
function resolveImportMapLocalDir(
  denoJsonDir: string,
  specifier: string,
  config: DenoConfig | undefined,
): string | undefined {
  if (!config?.imports) return undefined;
  const hit = matchImportMapEntry(config.imports, specifier);
  const baseVal = hit?.value;
  if (!baseVal || !isLocalImportMapTarget(baseVal)) return undefined;
  const abs = localTargetToAbsPath(denoJsonDir, baseVal);
  const dir = isExistingFile(abs) ? dirname(abs) : abs;
  return isExistingDir(dir) ? dir : undefined;
}

/**
 * 将模块解析结果合并到 cache（jsr: 转为 jsr:key，npm: 收集待补全）。
 * 与 buildModuleCache 主循环逻辑一致，抽出来供聚合入口复用。
 *
 * @param info - deno info --json 输出
 * @param cache - 目标 cache（原地修改）
 * @param npmToResolve - npm: 说明符收集集合（原地修改）
 * @param debugLog - 调试日志函数
 */
function mergeDenoInfoModules(
  info: DenoInfoOutput,
  cache: ModuleCache,
  npmToResolve: Set<string>,
  debugLog: (msg: string) => void,
): void {
  for (const mod of info.modules) {
    if (!mod.specifier) continue;
    const localPath = mod.local
      ? (mod.local.startsWith("file://") ? fileUrlToPath(mod.local) : mod.local)
      : undefined;
    if (localPath) cacheSet(cache, mod.specifier, localPath);

    const jsrMatch = mod.specifier.match(
      /^https:\/\/jsr\.io\/(@[^/]+\/[^/]+)\/([^/]+)\/(.+)$/,
    );
    if (jsrMatch) {
      const [, scopeAndName, version, path] = jsrMatch;
      const jsrKey = `jsr:${scopeAndName}@${version}/${path}`;
      if (localPath) {
        cacheSet(cache, jsrKey, localPath);
        debugLog(
          $tr("log.esbuild.resolverDeno.buildModuleCacheAdd", {
            jsrKey,
            localPath,
          }),
        );
      }
    } else if (mod.specifier.startsWith("npm:")) {
      const spec = mod.specifier.replace(/^npm:\/+/, "npm:");
      npmToResolve.add(spec);
      if (localPath) cacheSet(cache, spec, localPath);
    }
  }
  applyDenoInfoRedirects(info, cache, debugLog);
}

/**
 * 把 `deno info --json` 的 redirects 记进 cache。
 * 例如 `jsr:@dreamer/ui-view@^1.3.12/charts` → `src/desktop/charts/mod.ts`，
 * 否则 cacheLookup 只找 `.../charts`，打不到真实导出路径。
 */
function applyDenoInfoRedirects(
  info: DenoInfoOutput,
  cache: ModuleCache,
  debugLog: (msg: string) => void,
): void {
  const redirects = info.redirects;
  if (!redirects) return;
  for (const [from, to] of Object.entries(redirects)) {
    const fromKey = normalizeProtocolSpecifier(from);
    const localPath = cacheGet(cache, to) ??
      (jsrSpecifierFromHttps(to)
        ? cacheGet(cache, jsrSpecifierFromHttps(to)!)
        : undefined);
    if (!localPath) continue;
    cacheSet(cache, fromKey, localPath);
    if (!fromKey.startsWith("jsr:")) continue;
    const jsrTarget = jsrSpecifierFromHttps(to);
    if (!jsrTarget) continue;
    const at = fromKey.lastIndexOf("@");
    if (at <= 4) continue;
    const name = fromKey.slice(4, at);
    const versionAndPath = fromKey.slice(at + 1);
    const slash = versionAndPath.indexOf("/");
    const sub = slash === -1 ? "" : versionAndPath.slice(slash);
    const toMatch = to.match(
      /^https:\/\/jsr\.io\/(@[^/]+\/[^/]+)\/([^/]+)\//,
    );
    const version = toMatch?.[2];
    if (!version) continue;
    const pinned = `jsr:${name}@${version}${sub}`;
    if (pinned !== fromKey) cacheSet(cache, pinned, localPath);
    debugLog(
      `jsr redirect cache: ${from} -> ${pinned} -> ${localPath}`,
    );
  }
}

/**
 * 生成临时聚合入口文件，对所有源文件做一次 `deno info`，将传递依赖补入 cache。
 *
 * **Why**：`deno info` 以单入口为起点时，动态 `import()` 的目标文件（如路由组件）内的静态导入
 * 可能因无扩展名等原因解析失败，导致传递依赖（如 jsr: 包）不进 moduleCache。
 * 生成一个临时 `.ts` 文件，静态 import 所有源文件作为 roots，一次性补全。
 *
 * **Invariant**：临时文件写入 `~/.dreamer/<项目名>/esbuild-deno-cache/` 下，不污染用户项目；
 * 用完即删；任何阶段失败均忽略（回退为主入口 deno info 结果 + 方向 A 运行时回退）。
 *
 * @param sourceFiles - 项目 src 下所有 .ts/.tsx 文件绝对路径
 * @param projectRootAbs - 项目根绝对路径
 * @param workDir - deno info 子进程工作目录
 * @param configArgs - deno info 的 --config 参数（可能为空数组）
 * @param cache - 目标 cache（原地修改）
 * @param npmToResolve - npm: 说明符收集集合（原地修改）
 * @param debugLog - 调试日志函数
 */
async function runDenoInfoOnAggregate(
  sourceFiles: string[],
  projectRootAbs: string,
  workDir: string,
  configArgs: string[],
  cache: ModuleCache,
  npmToResolve: Set<string>,
  debugLog: (msg: string) => void,
): Promise<void> {
  // 临时聚合入口写入 ~/.dreamer/<项目名>/esbuild-deno-cache/
  const home = getEnv("HOME") ?? getEnv("USERPROFILE") ??
    getEnv("LOCALAPPDATA");
  if (!home) return;
  const segment = basename(resolve(projectRootAbs)).replace(/[/:*?"<>|]/g, "-")
    .slice(0, 120) || "project";
  const cacheDir = join(home, ".dreamer", segment, "esbuild-deno-cache");
  const tmpFile = join(cacheDir, `_aggregate-roots-${Date.now()}.ts`);
  // 生成聚合入口：静态 import 所有源文件，让 deno info 一次性覆盖全部依赖图
  const importLines = sourceFiles.map((f) =>
    `import ${JSON.stringify(toForwardSlash(f))};`
  ).join("\n");
  const content =
    `// @ts-nocheck\n// 自动生成的聚合入口，用于 deno info 补全动态 import 的传递依赖\n${importLines}\n`;
  try {
    await ensureDir(cacheDir);
    await writeTextFile(tmpFile, content);
    const proc = createCommand("deno", {
      args: ["info", "--json", ...configArgs, toForwardSlash(tmpFile)],
      cwd: workDir,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    });
    const out = await proc.output();
    if (!out.success || !out.stdout) {
      debugLog(
        `aggregate deno info failed: ${
          new TextDecoder().decode(out.stderr).slice(0, 200)
        }`,
      );
      return;
    }
    const stdout = new TextDecoder().decode(out.stdout);
    if (!stdout.trim()) return;
    const aggInfo = JSON.parse(stdout) as DenoInfoOutput;
    const before = cache.size;
    mergeDenoInfoModules(aggInfo, cache, npmToResolve, () => {});
    debugLog(
      `aggregate deno info merged: ${
        String(cache.size - before)
      } new entries from ${String(sourceFiles.length)} source files`,
    );
  } catch (e) {
    debugLog(`aggregate deno info error: ${String(e)}`);
  } finally {
    try {
      if (existsSync(tmpFile)) await remove(tmpFile);
    } catch {
      /* 删除失败不阻断 */
    }
  }
}

/**
 * 在项目目录、项目 deno.json 下执行 deno info，仅将本依赖图内的模块写入 cache。
 * 不扫全局缓存；npm 无 local 时仅在此时用子进程 import.meta.resolve 补全。
 *
 * **性能**：按 `deno.json` 与 `package.json` 文件哈希从 `~/.dreamer/<项目名>/esbuild-deno-cache/deno-module-map-<指纹>.json`
 * 预载。磁盘缓存已有条目时**跳过** `deno info`（含聚合扫描），由解析期 miss 回退补洞并在构建后写回；
 * 缓存未命中时只对本次入口所在端做一次聚合 `deno info`（不再先对入口再对聚合跑两遍）。
 * 同仓其它端（api／frontend／mobile 等）不进入聚合。临时文件写入
 * `~/.dreamer/<项目名>/esbuild-deno-cache/` 下，不污染用户项目目录。
 */
export interface BuildModuleCacheStats {
  skippedDenoInfo: boolean;
  diskEntries: number;
  cacheEntries: number;
}

/** 构建结束后把解析期新补的条目写回磁盘缓存。 */
const moduleCachePersist = new WeakMap<ModuleCache, {
  projectRoot: string;
  lockFingerprint: string;
  dirty: boolean;
}>();

export async function flushModuleCacheToDisk(
  cache: ModuleCache,
): Promise<void> {
  const meta = moduleCachePersist.get(cache);
  if (!meta?.dirty) return;
  await saveDenoModuleCacheToDisk(
    meta.projectRoot,
    meta.lockFingerprint,
    cache,
  );
  meta.dirty = false;
}

export async function buildModuleCache(
  entryPoint: string,
  projectDir?: string,
  debug = false,
  logger?: BuildLogger,
  stats?: BuildModuleCacheStats,
): Promise<ModuleCache> {
  const cache: ModuleCache = new Map();
  const workDir = projectDir ?? cwd();
  const log = logger ?? NOOP_LOGGER;
  const debugLog = (msg: string) => {
    if (debug) log.debug(`${PREFIX} ${msg}`);
  };
  debugLog(
    $tr("log.esbuild.resolverDeno.buildModuleCacheStart", {
      entryPoint,
      workDir,
    }),
  );

  const projectDenoJson = findProjectDenoJson(workDir);
  const configArgs = projectDenoJson
    ? ["--config", toForwardSlash(projectDenoJson)]
    : [];
  // 使用相对于 workDir 的入口路径，避免 Windows 上绝对路径格式导致 deno info 解析失败
  const entryRelative = relative(workDir, entryPoint);
  const entryForDeno = entryRelative.startsWith("..")
    ? toForwardSlash(entryPoint)
    : toForwardSlash(entryRelative);

  const projectRootForCache = resolveDreamerProjectRootForCache(
    workDir,
    projectDenoJson,
  );
  const lockFingerprint = await computeDenoLockFingerprint(projectDenoJson);
  const diskPreload = await tryLoadDenoModuleCacheFromDisk(
    projectRootForCache,
    lockFingerprint,
  );
  if (diskPreload) {
    for (const [k, v] of diskPreload) cacheSet(cache, k, v);
    debugLog(
      `deno module cache disk preload (${String(diskPreload.size)} entries)`,
    );
  }

  moduleCachePersist.set(cache, {
    projectRoot: projectRootForCache,
    lockFingerprint,
    dirty: false,
  });
  if (stats) {
    stats.skippedDenoInfo = false;
    stats.diskEntries = diskPreload?.size ?? 0;
    stats.cacheEntries = cache.size;
  }

  // 磁盘缓存已是完整快照时跳过 deno info；新说明符在解析期 miss 回退里补。
  if (diskPreload && diskPreload.size > 0) {
    debugLog(
      `deno module cache disk hit (${
        String(diskPreload.size)
      } entries), skip deno info`,
    );
    if (stats) stats.skippedDenoInfo = true;
    return cache;
  }

  try {
    const npmToResolve = new Set<string>();
    const projectRootAbs = projectDenoJson ? dirname(projectDenoJson) : workDir;
    const sourceFiles = await collectProjectSourceFiles(
      projectRootAbs,
      entryPoint,
      projectDenoJson,
    );
    if (sourceFiles.length > 0) {
      // 聚合入口已含本次入口所在端，不必再对入口单独跑一遍 deno info。
      await runDenoInfoOnAggregate(
        sourceFiles,
        projectRootAbs,
        workDir,
        configArgs,
        cache,
        npmToResolve,
        debugLog,
      );
    } else {
      // stdin: "null" 避免 CI 无 TTY 时 deno info 子进程阻塞（见 view 仓库 Deno Mac CI build 超时）
      const proc = createCommand("deno", {
        args: ["info", "--json", ...configArgs, entryForDeno],
        cwd: workDir,
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      });
      const output = await proc.output();
      if (!output.success) {
        const stderr = new TextDecoder().decode(output.stderr);
        debugLog(
          $tr("log.esbuild.resolverDeno.buildModuleCacheDenoInfoFailed", {
            stderr,
          }),
        );
        return cache;
      }
      const stdout = new TextDecoder().decode(output.stdout);
      if (!stdout.trim()) return cache;
      const info = JSON.parse(stdout) as DenoInfoOutput;
      mergeDenoInfoModules(info, cache, npmToResolve, debugLog);
    }

    for (const spec of npmToResolve) {
      if (cache.has(spec)) continue;
      if (!projectDenoJson) {
        debugLog(
          $tr("log.esbuild.resolverDeno.buildModuleCacheNpmResolveFailed", {
            spec,
          }),
        );
        continue;
      }
      const localPath = await resolveNpmSpecifierToFilePath(
        spec,
        projectDenoJson,
      );
      if (localPath) {
        cacheSet(cache, spec, localPath);
        debugLog(
          $tr("log.esbuild.resolverDeno.buildModuleCacheNpm", {
            spec,
            localPath,
          }),
        );
      } else {
        debugLog(
          $tr("log.esbuild.resolverDeno.buildModuleCacheNpmResolveFailed", {
            spec,
          }),
        );
      }
    }

    debugLog(
      $tr("log.esbuild.resolverDeno.buildModuleCacheDone", {
        count: String(cache.size),
      }),
    );
    if (cache.size > 0) {
      await saveDenoModuleCacheToDisk(
        projectRootForCache,
        lockFingerprint,
        cache,
      );
      const persist = moduleCachePersist.get(cache);
      if (persist) persist.dirty = false;
    }
    if (stats) stats.cacheEntries = cache.size;
  } catch (e) {
    debugLog(
      $tr("log.esbuild.resolverDeno.buildModuleCacheError", {
        error: String(e),
      }),
    );
  }
  if (stats) stats.cacheEntries = cache.size;
  return cache;
}

export interface ResolverOptions {
  enabled?: boolean;
  browserMode?: boolean;
  isServerBuild?: boolean;
  moduleCache?: ModuleCache;
  excludePaths?: string[];
  projectDir?: string;
  debug?: boolean;
  logger?: BuildLogger;
  forceRuntimeExternal?: boolean;
  resolveOverrides?: Record<string, string>;
}

interface DenoConfig {
  imports?: Record<string, string>;
}

const NAMESPACE_DENO_PROTOCOL = "deno-protocol";

/** 是否为 SSR/水合相关的运行时包（客户端必须打包进 bundle，不能 external，否则与 SSR 实例不一致） */
function isClientRuntimeSpec(specifier: string): boolean {
  return (
    /^npm:(preact|react)(@|\/|$)/.test(specifier) ||
    /^(npm|jsr):@dreamer\/view(@|\/|$)/.test(specifier)
  );
}

const denoConfigCache = new Map<string, DenoConfig | undefined>();
const projectDenoJsonCache = new Map<string, string | undefined>();

/**
 * 按路径段向上查 imports 最长前缀（含 `foo/` 前缀键），O(段数) 次对象键访问。
 */
function matchImportMapEntry(
  imports: Record<string, string>,
  specifier: string,
): { key: string; value: string } | undefined {
  let cur = specifier;
  while (cur) {
    const exact = imports[cur];
    if (typeof exact === "string") return { key: cur, value: exact };
    const slashKey = `${cur}/`;
    if (slashKey !== cur) {
      const prefix = imports[slashKey];
      if (typeof prefix === "string") return { key: slashKey, value: prefix };
    }
    const i = cur.lastIndexOf("/");
    if (i <= 0) return undefined;
    cur = cur.slice(0, i);
  }
  return undefined;
}

function getDenoConfig(denoJsonPath: string): DenoConfig | undefined {
  if (denoConfigCache.has(denoJsonPath)) {
    return denoConfigCache.get(denoJsonPath);
  }
  let cfg: DenoConfig | undefined;
  try {
    cfg = JSON.parse(readTextFileSync(denoJsonPath)) as DenoConfig;
  } catch {
    cfg = undefined;
  }
  denoConfigCache.set(denoJsonPath, cfg);
  return cfg;
}

/** 剥除 Deno HTTP 缓存文件中的 `// denoCacheMetadata={...}`（否则 JSON loader 会报 comments）。
 * 常见为文件末尾行；偶发文件开头仅有该元数据行时，跳过首行保留正文，勿整文件清空。
 */
function stripDenoCacheMetadata(contents: string): string {
  const marker = "\n// denoCacheMetadata=";
  const idx = contents.lastIndexOf(marker);
  if (idx >= 0) return contents.slice(0, idx);
  if (contents.startsWith("// denoCacheMetadata=")) {
    const nl = contents.indexOf("\n");
    if (nl < 0) return ""; // 仅元数据、无正文
    return contents.slice(nl + 1);
  }
  return contents;
}

/** @internal 供单测断言 stripDenoCacheMetadata 行为。 */
export function stripDenoCacheMetadataForTests(contents: string): string {
  return stripDenoCacheMetadata(contents);
}

/** 根据文件路径或 cache key（含扩展名）确定 esbuild loader。.tsx 用 tsx，.jsx 用 jsx，.json 用 json。 */
function getLoaderFromPath(
  filePathOrKey: string,
): "ts" | "tsx" | "js" | "jsx" | "json" {
  if (filePathOrKey.endsWith(".tsx")) return "tsx";
  if (filePathOrKey.endsWith(".jsx")) return "jsx";
  if (filePathOrKey.endsWith(".ts") || filePathOrKey.endsWith(".mts")) {
    return "ts";
  }
  if (filePathOrKey.endsWith(".js") || filePathOrKey.endsWith(".mjs")) {
    return "js";
  }
  if (filePathOrKey.endsWith(".json")) return "json";
  return "ts";
}

function findProjectDenoJson(startDir: string): string | undefined {
  const start = resolve(startDir);
  if (projectDenoJsonCache.has(start)) return projectDenoJsonCache.get(start);
  const trail: string[] = [];
  let currentDir = start;
  let found: string | undefined;
  for (let i = 0; i < 10; i++) {
    if (projectDenoJsonCache.has(currentDir)) {
      found = projectDenoJsonCache.get(currentDir);
      break;
    }
    trail.push(currentDir);
    const p = join(currentDir, "deno.json");
    if (existsSync(p)) {
      found = p;
      break;
    }
    const parent = dirname(currentDir);
    if (parent === currentDir) break;
    currentDir = parent;
  }
  for (const d of trail) projectDenoJsonCache.set(d, found);
  if (!projectDenoJsonCache.has(start)) projectDenoJsonCache.set(start, found);
  return found;
}

/**
 * 从项目 deno.json 的 imports 解析 bare 包名或带子路径。
 * 子路径从右往左一层一层试：先试 @dreamer/render/client/react 整键，再试 base=@dreamer/render/client/subpath=react，
 * 再试 base=@dreamer/render、subpath=client/react，命中 base 即拼成 jsr:.../subpath。
 */
function getPackageImport(
  projectDenoJsonPath: string,
  packageName: string,
  config?: DenoConfig,
): string | undefined {
  const c = config ?? getDenoConfig(projectDenoJsonPath);
  if (!c?.imports) return undefined;
  const hit = matchImportMapEntry(c.imports, packageName);
  if (!hit) return undefined;
  if (packageName === hit.key) return normalizeProtocolSpecifier(hit.value);
  const rest = hit.key.endsWith("/")
    ? packageName.slice(hit.key.length)
    : packageName.slice(hit.key.length).replace(/^\/+/, "");
  return normalizeProtocolSpecifier(
    hit.key.endsWith("/") ? `${hit.value}${rest}` : `${hit.value}/${rest}`,
  );
}

/** 规范 jsr:/npm: 后的多余前导斜杠，避免出现 npm:/react-dom@x/client 这种非法格式 */
function normalizeProtocolSpecifier(s: string): string {
  return s.replace(/^(npm|jsr):\/+(?!\/)/, "$1:");
}

/** 兼容磁盘缓存里残留的 `jsr:/@scope` 写法。 */
function protocolSpecifierAliases(specifier: string): string[] {
  const n = normalizeProtocolSpecifier(specifier);
  const aliases = [specifier, n];
  if (n.startsWith("jsr:@")) aliases.push(`jsr:/${n.slice(4)}`);
  if (n.startsWith("npm:") && !n.startsWith("npm:/")) {
    aliases.push(`npm:/${n.slice(4)}`);
  }
  return [...new Set(aliases)];
}

function cacheGet(
  cache: ModuleCache,
  specifier: string,
): string | undefined {
  for (const key of protocolSpecifierAliases(specifier)) {
    const hit = cache.get(key);
    if (hit) return hit;
  }
  return undefined;
}

function cacheSet(
  cache: ModuleCache,
  specifier: string,
  localPath: string,
): void {
  const key = normalizeProtocolSpecifier(specifier);
  cache.set(key, localPath);
  const persist = moduleCachePersist.get(cache);
  if (persist) persist.dirty = true;
  const idx = moduleCacheIndex.get(cache);
  if (idx) indexCacheEntry(idx, key, localPath);
}

/** 是否为本地依赖目标（相对路径／file:／绝对路径），非 jsr:／npm: */
function isLocalImportMapTarget(val: string): boolean {
  if (val.startsWith("jsr:") || val.startsWith("npm:")) return false;
  return (
    val.startsWith("./") ||
    val.startsWith("../") ||
    val.startsWith("file:") ||
    val.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(val)
  );
}

function localTargetToAbsPath(denoJsonDir: string, baseVal: string): string {
  if (baseVal.startsWith("file:")) return fileUrlToPath(baseVal);
  if (baseVal.startsWith("./") || baseVal.startsWith("../")) {
    return resolve(denoJsonDir, baseVal);
  }
  return baseVal;
}

function isExistingDir(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory;
  } catch {
    return false;
  }
}

function isExistingFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile;
  } catch {
    return false;
  }
}

const localPackageRootCache = new Map<string, string>();
const packageJsonByRoot = new Map<
  string,
  { exports?: Record<string, unknown> } | undefined
>();

/** 向上查找含 package.json（或 deno.json）的包根 */
function findLocalPackageRoot(startPath: string): string {
  const start = resolve(startPath);
  const cached = localPackageRootCache.get(start);
  if (cached) return cached;
  let dir = isExistingFile(start) ? dirname(start) : start;
  let found: string | undefined;
  for (let i = 0; i < 8; i++) {
    if (
      existsSync(join(dir, "package.json")) ||
      existsSync(join(dir, "deno.json"))
    ) {
      found = dir;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (!found) found = isExistingDir(start) ? start : dirname(start);
  localPackageRootCache.set(start, found);
  return found;
}

function pickExistingScript(base: string): string | undefined {
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.jsx`,
    join(base, "mod.ts"),
    join(base, "mod.js"),
    join(base, "index.ts"),
    join(base, "index.js"),
  ];
  for (const c of candidates) {
    if (isExistingFile(c)) return c;
  }
  return undefined;
}

function readPackageJson(
  pkgRoot: string,
): { exports?: Record<string, unknown> } | undefined {
  if (packageJsonByRoot.has(pkgRoot)) return packageJsonByRoot.get(pkgRoot);
  const pkgJsonPath = join(pkgRoot, "package.json");
  let pkg: { exports?: Record<string, unknown> } | undefined;
  if (existsSync(pkgJsonPath)) {
    try {
      pkg = JSON.parse(readTextFileSync(pkgJsonPath)) as {
        exports?: Record<string, unknown>;
      };
    } catch {
      pkg = undefined;
    }
  }
  packageJsonByRoot.set(pkgRoot, pkg);
  return pkg;
}

function readPackageExportTarget(
  pkgRoot: string,
  subpath: string,
): string | undefined {
  try {
    const pkg = readPackageJson(pkgRoot);
    if (!pkg) return undefined;
    const entry = pkg.exports?.[`./${subpath}`] ?? pkg.exports?.[subpath];
    if (typeof entry === "string") return entry;
    if (entry && typeof entry === "object") {
      const obj = entry as {
        import?: unknown;
        default?: unknown;
        require?: unknown;
      };
      for (const key of ["import", "default", "require"] as const) {
        const v = obj[key];
        if (typeof v === "string") return v;
        if (v && typeof v === "object") {
          const nested = v as { default?: unknown };
          if (typeof nested.default === "string") return nested.default;
        }
      }
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

/**
 * 将 deno.json imports 中的本地依赖 + 子路径解析为磁盘文件。
 * 对齐 jsr／npm 子路径能力：优先 package.json exports，再回落 src／根目录候选。
 */
function resolveLocalImportMapSubpath(
  denoJsonDir: string,
  baseVal: string,
  subpath: string,
): string | undefined {
  const absBase = localTargetToAbsPath(denoJsonDir, baseVal);
  const pkgRoot = findLocalPackageRoot(absBase);
  const cleanSub = subpath.replace(/^\/+/, "");
  if (!cleanSub) {
    return pickExistingScript(absBase) ??
      pickExistingScript(join(pkgRoot, "mod")) ??
      pickExistingScript(join(pkgRoot, "src", "mod")) ??
      pickExistingScript(join(pkgRoot, "index"));
  }

  const exportTarget = readPackageExportTarget(pkgRoot, cleanSub);
  if (exportTarget) {
    const abs = resolve(pkgRoot, exportTarget);
    if (isExistingFile(abs)) return abs;
    const hit = pickExistingScript(abs);
    if (hit) return hit;
  }

  const searchBases = [pkgRoot];
  if (isExistingDir(absBase) && absBase !== pkgRoot) {
    searchBases.unshift(absBase);
  }
  if (isExistingFile(absBase)) {
    const parent = dirname(absBase);
    if (!searchBases.includes(parent)) searchBases.unshift(parent);
  }

  for (const root of searchBases) {
    for (const mid of ["", "src", "lib", "dist"]) {
      const base = mid ? join(root, mid, cleanSub) : join(root, cleanSub);
      const hit = pickExistingScript(base);
      if (hit) return hit;
    }
  }
  return undefined;
}

function convertSpecifierToBrowserUrl(specifier: string): string | null {
  if (specifier.startsWith("npm:")) {
    return `https://esm.sh/${specifier.slice(4)}`;
  }
  if (specifier.startsWith("jsr:")) {
    return `https://esm.sh/jsr/${specifier.slice(4)}`;
  }
  if (specifier.startsWith("http:")) {
    return specifier;
  }
  return null;
}

/**
 * 解析 jsr: 协议路径为 packageBase + pathWithinPackage
 */
function parseJsrPackageBaseAndPath(
  protocolPath: string,
): { packageBase: string; pathWithinPackage: string } | null {
  if (!protocolPath.startsWith("jsr:")) return null;
  const after = protocolPath.slice(4);
  const match = after.match(/^(@[^/]+\/[^/]+\@[^/]+)(?:\/(.*))?$/);
  if (!match) return null;
  return {
    packageBase: "jsr:" + match[1],
    pathWithinPackage: match[2] ?? "",
  };
}

/**
 * 解析 npm: 协议路径为 packageBase + pathWithinPackage（如 npm:preact@10.28.3/jsx-runtime）
 * 用于 preact/hooks、preact/jsx-runtime 等子路径中的 ../ 解析到主包，保证单例
 */
function parseNpmPackageBaseAndPath(
  protocolPath: string,
): { packageBase: string; pathWithinPackage: string } | null {
  if (!protocolPath.startsWith("npm:")) return null;
  const after = protocolPath.slice(4);
  const firstSlash = after.indexOf("/");
  if (firstSlash === -1) {
    return { packageBase: "npm:" + after, pathWithinPackage: "" };
  }
  return {
    packageBase: "npm:" + after.slice(0, firstSlash),
    pathWithinPackage: after.slice(firstSlash + 1),
  };
}

/** 统一解析 jsr: 或 npm: 为 packageBase + pathWithinPackage */
function parseProtocolPackageBaseAndPath(
  protocolPath: string,
): { packageBase: string; pathWithinPackage: string } | null {
  return parseJsrPackageBaseAndPath(protocolPath) ??
    parseNpmPackageBaseAndPath(protocolPath);
}

/**
 * 从 jsr: 或 npm: 的完整 specifier 解析出 deno.json imports 的 key 与子路径。
 * 用于「以项目版本为准」：用 project 的 imports 覆盖依赖包内声明的版本。
 * 例：jsr:@dreamer/view@^1.0.2/jsx-runtime -> { packageKey: "@dreamer/view", pathWithinPackage: "jsx-runtime" }
 *     npm:react@18.0.0/jsx-runtime -> { packageKey: "react", pathWithinPackage: "jsx-runtime" }
 */
function getPackageKeyAndSubpathFromSpecifier(
  specifier: string,
): { packageKey: string; pathWithinPackage: string } | null {
  const jsr = parseJsrPackageBaseAndPath(specifier);
  if (jsr) {
    const after = specifier.slice(4);
    const match = after.match(/^(@[^/]+\/[^/]+)\@/);
    if (!match) return null;
    return { packageKey: match[1], pathWithinPackage: jsr.pathWithinPackage };
  }
  const npm = parseNpmPackageBaseAndPath(specifier);
  if (npm) {
    const after = specifier.slice(4);
    const match = after.match(/^([^@/]+)/);
    if (!match) return null;
    return { packageKey: match[1], pathWithinPackage: npm.pathWithinPackage };
  }
  return null;
}

/** 将 specifier 中用于正则的片段转义 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** cacheLookup 返回：本地路径 + 匹配到的 cache key（用于 loader，因 Deno 缓存路径常无扩展名） */
export type CacheLookupResult = { path: string; key: string };

/**
 * 缓存查找：先精确 get；未命中则对 jsr 用正则匹配 cache key；对 npm 支持子路径回退（如 npm:react-dom@x/client）。
 * 子路径允许多段间有额外目录（如 client/preact 匹配 src/client/adapters/preact.ts）。
 */
/**
 * 模块缓存旁路索引：避免每次 cacheLookup / canonical 都扫一遍整表（热构建可达数千次）。
 */
interface ModuleCacheIndex {
  /** 同一本地文件对应的最短带扩展名 jsr key */
  canonicalByPath: Map<string, string>;
  /** `@scope/name/subpath`（不含版本）-> 条目；同 path 优先带扩展名、更短的 key */
  jsrByPkgSubpath: Map<string, { key: string; path: string }>;
  /** 同一 jsr 包（不含版本）下的全部条目，模糊回退只扫本包 */
  jsrByScopeName: Map<
    string,
    Array<{ key: string; path: string; subpath: string }>
  >;
  /** npm 包根（无子路径）按包名索引 */
  npmRootByName: Map<string, { key: string; path: string }>;
}

const moduleCacheIndex = new WeakMap<ModuleCache, ModuleCacheIndex>();

function createCacheIndex(): ModuleCacheIndex {
  return {
    canonicalByPath: new Map(),
    jsrByPkgSubpath: new Map(),
    jsrByScopeName: new Map(),
    npmRootByName: new Map(),
  };
}

function preferJsrKey(a: string, b: string): boolean {
  const aExt = /\.(tsx?|jsx?|mts|mjs)$/i.test(a);
  const bExt = /\.(tsx?|jsx?|mts|mjs)$/i.test(b);
  if (aExt !== bExt) return aExt;
  return a.length < b.length;
}

function jsrPkgSubpathId(
  key: string,
): { id: string; scopeAndName: string; subpath: string } | undefined {
  const k = normalizeProtocolSpecifier(key);
  if (!k.startsWith("jsr:")) return undefined;
  const after = k.slice(4);
  const lastAt = after.lastIndexOf("@");
  if (lastAt <= 0) return undefined;
  const scopeAndName = after.slice(0, lastAt);
  const versionAndPath = after.slice(lastAt + 1);
  const slashIdx = versionAndPath.indexOf("/");
  const subpath = slashIdx === -1 ? "" : versionAndPath.slice(slashIdx + 1);
  return { id: `${scopeAndName}/${subpath}`, scopeAndName, subpath };
}

function indexCacheEntry(
  idx: ModuleCacheIndex,
  key: string,
  localPath: string,
): void {
  const k = normalizeProtocolSpecifier(key);
  if (k.startsWith("jsr:") && /\.(tsx?|jsx?|mts|mjs)$/i.test(k)) {
    const prev = idx.canonicalByPath.get(localPath);
    if (!prev || k.length < prev.length) idx.canonicalByPath.set(localPath, k);
  }
  if (k.startsWith("npm:")) {
    const after = k.slice(4).replace(/^\/+/, "");
    if (!after.includes("/")) {
      const pkgName = after.split("@")[0];
      if (pkgName && !idx.npmRootByName.has(pkgName)) {
        idx.npmRootByName.set(pkgName, { key: k, path: localPath });
      }
    }
  }
  const parsed = jsrPkgSubpathId(k);
  if (!parsed) return;
  let list = idx.jsrByScopeName.get(parsed.scopeAndName);
  if (!list) {
    list = [];
    idx.jsrByScopeName.set(parsed.scopeAndName, list);
  }
  list.push({ key: k, path: localPath, subpath: parsed.subpath });
  const storedKey = idx.canonicalByPath.get(localPath) ?? k;
  const prev = idx.jsrByPkgSubpath.get(parsed.id);
  if (!prev || preferJsrKey(storedKey, prev.key)) {
    idx.jsrByPkgSubpath.set(parsed.id, { key: storedKey, path: localPath });
  }
  if (parsed.subpath && /\.(tsx?|jsx?|mts|mjs)$/i.test(parsed.subpath)) {
    const noExt = parsed.subpath.replace(/\.(tsx?|jsx?|mts|mjs)$/i, "");
    const id2 = `${parsed.scopeAndName}/${noExt}`;
    const prev2 = idx.jsrByPkgSubpath.get(id2);
    if (!prev2 || preferJsrKey(storedKey, prev2.key)) {
      idx.jsrByPkgSubpath.set(id2, { key: storedKey, path: localPath });
    }
  }
}

function getCacheIndex(cache: ModuleCache): ModuleCacheIndex {
  let idx = moduleCacheIndex.get(cache);
  if (!idx) {
    idx = createCacheIndex();
    for (const [k, p] of cache) indexCacheEntry(idx, k, p);
    moduleCacheIndex.set(cache, idx);
  }
  return idx;
}

/**
 * 精确命中导出别名（如 `jsr:@pkg@^1.3.0/jsx-runtime`）时，改用同文件带扩展名的
 * canonical key（`.../src/jsx-runtime.ts`），否则相对导入会按 `jsx-runtime/` 拼接，
 * onLoad 也选不对 loader。
 */
function canonicalJsrCacheKey(
  moduleCache: ModuleCache,
  specifier: string,
  localPath: string,
  _existsCheck?: (p: string) => boolean,
): string {
  if (/\.(tsx?|jsx?|mts|mjs)$/i.test(specifier)) return specifier;
  return getCacheIndex(moduleCache).canonicalByPath.get(localPath) ?? specifier;
}

function cacheLookup(
  specifier: string,
  moduleCache: ModuleCache,
  existsCheck: (p: string) => boolean,
): CacheLookupResult | undefined {
  const normalized = normalizeProtocolSpecifier(specifier);
  const exact = cacheGet(moduleCache, normalized);
  if (exact && existsCheck(exact)) {
    return {
      path: exact,
      key: normalized.startsWith("jsr:")
        ? canonicalJsrCacheKey(moduleCache, normalized, exact, existsCheck)
        : normalized,
    };
  }

  specifier = normalized;

  // O(1) 子路径索引：版本范围（^3.1.0）与短导出别名（jsx-runtime）不必再扫整表。
  if (specifier.startsWith("jsr:")) {
    const parsed = jsrPkgSubpathId(specifier);
    if (parsed) {
      const hit = getCacheIndex(moduleCache).jsrByPkgSubpath.get(parsed.id);
      if (hit && existsCheck(hit.path)) {
        return {
          path: hit.path,
          key: canonicalJsrCacheKey(moduleCache, hit.key, hit.path),
        };
      }
    }
  }

  // 无扩展名的 jsr specifier：O(1) 试 specifier + 脚本扩展名，保证 onLoad 拿到带扩展名的 key 以选对 loader。
  if (
    specifier.startsWith("jsr:") &&
    !/\.(tsx?|jsx?|mts|mjs)$/i.test(specifier)
  ) {
    for (const ext of [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs"]) {
      const localPath = cacheGet(moduleCache, specifier + ext);
      if (localPath && existsCheck(localPath)) {
        return {
          path: localPath,
          key: canonicalJsrCacheKey(
            moduleCache,
            specifier + ext,
            localPath,
            existsCheck,
          ),
        };
      }
    }
  }

  if (specifier.startsWith("jsr:")) {
    const after = specifier.slice(4);
    const lastAt = after.lastIndexOf("@");
    if (lastAt <= 0) return undefined;
    const scopeAndName = after.slice(0, lastAt);
    const versionAndPath = after.slice(lastAt + 1);
    const slashIdx = versionAndPath.indexOf("/");
    const subpath = slashIdx === -1 ? "" : versionAndPath.slice(slashIdx + 1);
    const scopeEscaped = escapeRegex(scopeAndName);
    // 版本范围（deno.json 的 ^1.2.8）被剥掉 ^ 后会变成 1.2.8，而 lock / moduleCache
    // 可能已解析到 1.2.9。同版本精确+扩展名匹配会全部落空。先按「任意版本 +
    // 相同子路径」匹配，避免宽松正则把 src/desktop/mod 误判为
    // src/desktop/basic/icons/mod.ts（第一处命中），进而把 Link 等导出丢掉。
    if (subpath !== "") {
      const ext = /\.(tsx?|jsx?|mts|mjs)$/i.test(subpath)
        ? ""
        : "(\\.(tsx?|jsx?|mts|mjs))?";
      const exactSubpathRe = new RegExp(
        `^jsr:${scopeEscaped}@[^/]+/${escapeRegex(subpath)}${ext}$`,
        "i",
      );
      const pkgEntries = getCacheIndex(moduleCache).jsrByScopeName.get(
        scopeAndName,
      ) ?? [];
      for (const entry of pkgEntries) {
        const keyN = normalizeProtocolSpecifier(entry.key);
        if (exactSubpathRe.test(keyN) && existsCheck(entry.path)) {
          return {
            path: entry.path,
            key: canonicalJsrCacheKey(
              moduleCache,
              keyN,
              entry.path,
              existsCheck,
            ),
          };
        }
      }
    }
    const segments = subpath
      ? subpath.split("/").map((s) => escapeRegex(s))
      : ["mod"];
    // 无子路径（包根）：匹配主入口 mod、index 及 src 下对应文件（mod.ts、index.ts），不匹配 mod-hybrid
    const pathPart = subpath === "" ? "(src/)?(mod|index)(/mod)?" : (() => {
      // 首段后必须为「路径结束 / 子目录 / 扩展名」，禁止 router 匹配到 router-mount、foo 匹配到 foobar
      const first = `(src/)?([a-z]*-)?${segments[0]}(?=[./]|$)`;
      const rest = segments.length > 1
        ? `(\\/[^/]+)*\\/${segments.slice(1).join("(\\/[^/]+)*\\/")}`
        : "";
      return first + rest + "(/mod)?";
    })();
    // 后缀限定为脚本扩展名，避免匹配到 .json、.d.ts 等
    const pattern = new RegExp(
      `^jsr:${scopeEscaped}@[^/]+/${pathPart}(\\.(tsx?|jsx?|mts|mjs))?$`,
      "i",
    );
    // 宽松回退若有多个命中，取包内路径最短者，避免 desktop/mod 落到 desktop/**/mod.ts
    let best: CacheLookupResult | undefined;
    let bestSegments = Infinity;
    const pkgEntries = getCacheIndex(moduleCache).jsrByScopeName.get(
      scopeAndName,
    ) ?? [];
    for (const entry of pkgEntries) {
      if (pattern.test(entry.key) && existsCheck(entry.path)) {
        const segs = pathWithinPackageFromKey(entry.key).split("/").filter(
          Boolean,
        ).length;
        if (segs < bestSegments) {
          bestSegments = segs;
          best = { path: entry.path, key: entry.key };
        }
      }
    }
    if (best) {
      return {
        path: best.path,
        key: canonicalJsrCacheKey(
          moduleCache,
          best.key,
          best.path,
          existsCheck,
        ),
      };
    }
  }

  // npm 子路径通用回退：用 baseSpec 或包名匹配 cache 中的主包，再拼接子路径（不写死包名、不起子进程）
  if (specifier.startsWith("npm:") && specifier.includes("/")) {
    const after = specifier.slice(4).replace(/^\/+/, "");
    const slashIdx = after.indexOf("/");
    if (slashIdx > 0) {
      const baseSpec = "npm:" + after.slice(0, slashIdx);
      const subpath = after.slice(slashIdx + 1);
      let baseLocal = moduleCache.get(baseSpec);
      if (!baseLocal) {
        const pkgName = after.slice(0, slashIdx).split("@")[0];
        const root = getCacheIndex(moduleCache).npmRootByName.get(pkgName);
        if (root && existsCheck(root.path)) baseLocal = root.path;
      }
      if (baseLocal && existsCheck(baseLocal)) {
        const baseDir = dirname(baseLocal);
        const candidates = [
          join(baseDir, subpath),
          join(baseDir, subpath + ".js"),
          join(baseDir, subpath + ".mjs"),
          join(baseDir, subpath, "index.js"),
          join(baseDir, "build", subpath + ".js"),
          join(baseDir, "build", subpath + ".mjs"),
        ];
        for (const p of candidates) {
          if (existsCheck(p)) {
            return { path: p, key: specifier };
          }
        }
      }
    }
  }

  return undefined;
}

/** 从 cache key 取出包内路径，如 jsr:@x@1.0.0/src/client/foo.ts -> src/client/foo.ts */
function pathWithinPackageFromKey(key: string): string {
  const afterAt = key.slice(key.lastIndexOf("@") + 1);
  const slash = afterAt.indexOf("/");
  return slash === -1 ? "" : afterAt.slice(slash + 1);
}

/**
 * 包内相对路径解析：importer 在 cache 则 base 取自 importerResolvedKey 的路径（匹配到的 key）；
 * 否则用请求的 pathWithinPackage。支持 jsr: 与 npm:，保证 preact/jsx-runtime、preact/hooks 的 ../ 解析到主包单例。
 */
function resolveRelative(
  importerProtocolPath: string,
  relativePath: string,
  cacheLookupFn: (s: string) => string | undefined,
  importerResolvedKey?: string,
): string | undefined {
  const parsed = parseProtocolPackageBaseAndPath(importerProtocolPath);
  if (!parsed) return undefined;

  const inCache = !!cacheLookupFn(importerProtocolPath);
  let basePath =
    (importerResolvedKey
      ? pathWithinPackageFromKey(importerResolvedKey)
      : parsed.pathWithinPackage || "").replace(/\/$/, "");
  if (inCache) {
    basePath = basePath.replace(/\/[^/]+$/, "") || basePath;
  } else if (!importerResolvedKey && /\.(tsx?|jsx?|mts|mjs)$/i.test(basePath)) {
    basePath = basePath.replace(/\/[^/]+$/, "");
  } else if (/\/mod$/i.test(basePath)) {
    basePath = basePath.replace(/\/mod$/i, "");
  }

  const baseUrl = "file:///" + basePath + "/";
  let resolvedWithin: string;
  try {
    resolvedWithin = new URL(relativePath, baseUrl).pathname
      .replace(/^\/+/, "")
      .replace(/\/$/, "") ||
      "";
  } catch {
    resolvedWithin = relativePath.replace(/^\.\//, "").replace(/\.\.\//g, "");
  }
  const pathForProtocol = /\.(tsx?|jsx?|mts|mjs)$/i.test(resolvedWithin)
    ? resolvedWithin.replace(/\.(tsx?|jsx?|mts|mjs)$/i, "")
    : resolvedWithin;
  // 协议路径必须用 cache 命中的精确版本（1.2.9），不能把 ^1.2.8 只剥掉 ^ 变成 1.2.8。
  const resolvedBase = importerResolvedKey
    ? parseProtocolPackageBaseAndPath(importerResolvedKey)?.packageBase
    : undefined;
  const baseForProtocol = (resolvedBase ?? parsed.packageBase).replace(
    /@([\^~])([^/]+)/,
    "@$2",
  );
  const targetSpecifier = pathForProtocol
    ? `${baseForProtocol}/${pathForProtocol}`
    : baseForProtocol;
  return cacheLookupFn(targetSpecifier) ? targetSpecifier : undefined;
}

/**
 * Deno 解析插件：以预构建 moduleCache 为主；对未收录的 `npm:` 说明符可回退执行一次 `deno eval`（与 buildModuleCache 一致），不访问网络。
 */
export function denoResolverPlugin(
  options: ResolverOptions = {},
): esbuild.Plugin {
  const {
    enabled = true,
    browserMode = false,
    isServerBuild = true,
    moduleCache,
    projectDir,
    debug = false,
    logger: optionsLogger,
    forceRuntimeExternal: _forceRuntimeExternal = false,
    resolveOverrides = {},
  } = options;

  const log = optionsLogger ?? NOOP_LOGGER;
  const debugLog = (msg: string) => {
    if (debug) log.debug(`${PREFIX} ${msg}`);
  };

  const findDenoJson = (startDir: string) => findProjectDenoJson(startDir);
  const getConfig = (path: string) => getDenoConfig(path);

  return {
    name: "resolver",
    setup(build) {
      if (!enabled) return;
      const existsMemo = new Map<string, boolean>();
      const existsSyncMemo = (path: string): boolean => {
        const hit = existsMemo.get(path);
        if (hit !== undefined) return hit;
        const ok = existsSync(path);
        existsMemo.set(path, ok);
        return ok;
      };

      const cacheLookupWithCheck = (specifier: string): string | undefined => {
        if (!moduleCache) return undefined;
        return cacheLookup(specifier, moduleCache, existsSync)?.path;
      };

      // 0. CDN 样式：仅 import "https://xxx.com/xxx.css" 这种以 .css 结尾的 URL 标为 external，由浏览器运行时加载
      build.onResolve(
        { filter: /^https?:\/\/.*\.css$/ },
        (args): esbuild.OnResolveResult | undefined => {
          debugLog(
            $tr("log.esbuild.resolverDeno.cdnCssExternal", { path: args.path }),
          );
          return { path: args.path, external: true };
        },
      );

      // 1. 路径别名 @/、~/ 与相对路径（./、../）写在一起。相对路径不限制 namespace，否则从某 .tsx 里 import("../views/_layout.tsx") 可能被错误跳过
      build.onResolve(
        { filter: /^(@\/|~\/|@[^/]+\/|~[^/]+\/)|^\.\.?\/.*/ },
        (args): esbuild.OnResolveResult | undefined => {
          const startDir = args.importer
            ? dirname(args.importer)
            : (args.resolveDir ?? cwd());

          // 相对路径：任意 namespace 都按 importer 目录解析（deno-protocol 的 ./ ../ 由后面单独 onResolve 处理）
          if (/^\.\.?\/.*/.test(args.path)) {
            const resolved = resolve(join(startDir, args.path));
            if (existsSyncMemo(resolved)) {
              debugLog(
                $tr("log.esbuild.resolverDeno.fileRelativePath", {
                  path: args.path,
                  resolved,
                }),
              );
              return { path: resolved, namespace: "file" };
            }
            if (!/\.[a-z0-9]+$/i.test(args.path)) {
              const withCss = resolve(join(startDir, args.path + ".css"));
              if (existsSyncMemo(withCss)) {
                debugLog(
                  $tr("log.esbuild.resolverDeno.fileRelativePathCss", {
                    path: args.path,
                    withCss,
                  }),
                );
                return { path: withCss, namespace: "file" };
              }
            }
            return undefined;
          }

          // 路径别名 @/、~/
          const denoJsonPath = findDenoJson(startDir);
          if (!denoJsonPath) return undefined;
          const config = getConfig(denoJsonPath);
          if (!config?.imports) return undefined;
          const hit = matchImportMapEntry(config.imports, args.path);
          if (!hit) return undefined;
          const denoJsonDir = dirname(denoJsonPath);
          const val = hit.value;
          const rest = hit.key.endsWith("/")
            ? args.path.slice(hit.key.length)
            : args.path.slice(hit.key.length).replace(/^\/+/, "");
          // 本地依赖（./ ../ file: 绝对路径）：子路径按 exports／磁盘候选解析
          if (isLocalImportMapTarget(val)) {
            const localHit = resolveLocalImportMapSubpath(
              denoJsonDir,
              val,
              rest,
            );
            if (localHit) {
              return { path: localHit, namespace: "file" };
            }
            return undefined;
          }
          const resolved = val.startsWith("./") || val.startsWith("../")
            ? join(denoJsonDir, val, rest)
            : (rest ? `${val.replace(/\/+$/, "")}/${rest}` : val);
          if (existsSyncMemo(resolved)) {
            return { path: resolved, namespace: "file" };
          }
          if (!resolved.includes(".")) {
            for (const ext of [".ts", ".tsx", ".js", ".jsx", ".css"]) {
              const withExt = resolved + ext;
              if (existsSyncMemo(withExt)) {
                return { path: withExt, namespace: "file" };
              }
            }
          }
          return undefined;
        },
      );

      // 2. 顶层 jsr:、npm:
      // 以项目 deno.json 的 imports 为准：若项目声明了某包版本，则优先用该版本解析，避免依赖包（如 render）内锁定的旧版本覆盖项目版本
      build.onResolve(
        { filter: /^(jsr|npm):/ },
        async (
          args,
        ): Promise<esbuild.OnResolveResult | undefined> => {
          const specifier = normalizeProtocolSpecifier(args.path);
          if (isServerBuild && !browserMode) {
            debugLog(
              $tr("log.esbuild.resolverDeno.serverBuildExternal", {
                specifier,
              }),
            );
            return { path: specifier, external: true };
          }
          // 客户端构建时 preact/react/@dreamer/view 等运行时必须打包进 bundle，不能 external，否则与 SSR 水合不一致
          const forceBundle = !isServerBuild && isClientRuntimeSpec(specifier);
          if (browserMode && !forceBundle) {
            const url = convertSpecifierToBrowserUrl(specifier);
            if (url) return { path: url, external: true };
            return undefined;
          }
          const override = resolveOverrides[args.path] ??
            resolveOverrides[specifier];
          if (override && existsSyncMemo(override)) {
            return { path: override, namespace: "file" };
          }
          if (!moduleCache) {
            debugLog($tr("log.esbuild.resolverDeno.noModuleCache"));
            return undefined;
          }
          let tryPath = specifier;
          if (projectDir) {
            const denoJsonPath = findDenoJson(projectDir);
            const parsed = getPackageKeyAndSubpathFromSpecifier(specifier);
            if (denoJsonPath && parsed) {
              const projectImport = getPackageImport(
                denoJsonPath,
                parsed.packageKey,
              );
              const sameProtocol = (specifier.startsWith("jsr:") &&
                projectImport?.startsWith("jsr:")) ||
                (specifier.startsWith("npm:") &&
                  projectImport?.startsWith("npm:"));
              if (projectImport && sameProtocol) {
                if (parsed.pathWithinPackage) {
                  tryPath = `${projectImport}/${parsed.pathWithinPackage}`;
                } else {
                  tryPath = projectImport;
                }
                if (tryPath !== specifier) {
                  debugLog(
                    $tr("log.esbuild.resolverDeno.useProjectVersion", {
                      specifier,
                      tryPath,
                    }),
                  );
                }
              }
            }
          }
          const localPath = cacheLookupWithCheck(tryPath);
          if (localPath) {
            debugLog(
              $tr("log.esbuild.resolverDeno.cacheLookupHit", {
                tryPath,
                localPath,
              }),
            );
            return { path: tryPath, namespace: NAMESPACE_DENO_PROTOCOL };
          }
          if (tryPath !== specifier) {
            const fallback = cacheLookupWithCheck(specifier);
            if (fallback) {
              debugLog(
                $tr("log.esbuild.resolverDeno.cacheLookupHitOriginal", {
                  specifier,
                  fallback,
                }),
              );
              return { path: specifier, namespace: NAMESPACE_DENO_PROTOCOL };
            }
          }
          // npm: 未进 moduleCache 时（如 JSR 依赖内字面量 `npm:tailwind-merge@^2.6.1`），用 Deno 解析到真实路径并走 file namespace 打包
          const denoJsonPathForFallback =
            (projectDir ? findDenoJson(projectDir) : undefined) ??
              findDenoJson(cwd());
          if (specifier.startsWith("npm:") && denoJsonPathForFallback) {
            let filePath = await resolveNpmSpecifierToFilePath(
              tryPath,
              denoJsonPathForFallback,
            );
            if (!filePath && tryPath !== specifier) {
              filePath = await resolveNpmSpecifierToFilePath(
                specifier,
                denoJsonPathForFallback,
              );
            }
            if (filePath) {
              debugLog(
                `npm cache miss fallback to file: ${tryPath} -> ${filePath}`,
              );
              return { path: filePath, namespace: "file" };
            }
          }
          // jsr: 未进 moduleCache 时（常见于动态 import 的传递依赖未被 deno info 收录），用 Deno 解析到真实路径并走 file namespace 打包
          if (specifier.startsWith("jsr:") && denoJsonPathForFallback) {
            let resolved = await resolveJsrSpecifierToCachedModule(
              tryPath,
              denoJsonPathForFallback,
              moduleCache,
            );
            if (!resolved && tryPath !== specifier) {
              resolved = await resolveJsrSpecifierToCachedModule(
                specifier,
                denoJsonPathForFallback,
                moduleCache,
              );
            }
            if (resolved) {
              debugLog(
                `jsr cache miss fallback: ${tryPath} -> ${resolved.localPath}`,
              );
              if (moduleCache) {
                return jsrCacheMissResolveResult(
                  moduleCache,
                  tryPath,
                  resolved,
                );
              }
              return { path: resolved.localPath, namespace: "file" };
            }
          }
          debugLog(
            $tr("log.esbuild.resolverDeno.cacheLookupMiss", { tryPath }),
          );
          return undefined;
        },
      );

      // 2.5 bare @scope/name 或 @scope/name/subpath：从 deno.json imports 取 jsr:/npm 地址
      // 优先用 projectDir 查 deno.json，保证 @dreamer/router/client、@dreamer/render/client/react 等子路径能命中项目 imports
      build.onResolve(
        { filter: /^@[^/]+\/[^/]+(\/.*)?$/ },
        async (
          args,
        ): Promise<esbuild.OnResolveResult | undefined> => {
          const startDir = projectDir ??
            (args.importer
              ? dirname(args.importer)
              : (args.resolveDir ?? cwd()));
          const denoJsonPath = findDenoJson(startDir);
          if (!denoJsonPath) return undefined;
          const denoJsonDir = dirname(denoJsonPath);
          const pkgImport = getPackageImport(denoJsonPath, args.path);
          if (!pkgImport) return undefined;
          // 本地依赖子路径：./／file:／绝对路径（getPackageImport 拼出的 base/subpath）
          if (isLocalImportMapTarget(pkgImport)) {
            // pkgImport 可能已是 baseVal/subpath 拼接；拆成 base + rest 再走 exports
            const config = getDenoConfig(denoJsonPath);
            let localHit: string | undefined;
            if (config?.imports) {
              const mapHit = matchImportMapEntry(config.imports, args.path);
              if (mapHit && isLocalImportMapTarget(mapHit.value)) {
                const sub = mapHit.key.endsWith("/")
                  ? args.path.slice(mapHit.key.length)
                  : args.path.slice(mapHit.key.length).replace(/^\/+/, "");
                localHit = resolveLocalImportMapSubpath(
                  denoJsonDir,
                  mapHit.value,
                  sub,
                );
              }
            }
            if (!localHit) {
              localHit = resolveLocalImportMapSubpath(
                denoJsonDir,
                pkgImport,
                "",
              );
            }
            if (localHit) {
              return { path: localHit, namespace: "file" };
            }
            return undefined;
          }
          if (pkgImport.startsWith("jsr:") || pkgImport.startsWith("npm:")) {
            if (isServerBuild && !browserMode) {
              return { path: pkgImport, external: true };
            }
            if (browserMode) {
              const url = convertSpecifierToBrowserUrl(pkgImport);
              if (url) return { path: url, external: true };
            }
            if (moduleCache && cacheLookupWithCheck(pkgImport)) {
              return { path: pkgImport, namespace: NAMESPACE_DENO_PROTOCOL };
            }
            if (pkgImport.startsWith("npm:")) {
              const filePath = await resolveNpmSpecifierToFilePath(
                pkgImport,
                denoJsonPath,
              );
              if (filePath) {
                return { path: filePath, namespace: "file" };
              }
            }
            if (pkgImport.startsWith("jsr:")) {
              const resolved = await resolveJsrSpecifierToCachedModule(
                pkgImport,
                denoJsonPath,
                moduleCache,
              );
              if (resolved) {
                if (moduleCache) {
                  return jsrCacheMissResolveResult(
                    moduleCache,
                    pkgImport,
                    resolved,
                  );
                }
                return { path: resolved.localPath, namespace: "file" };
              }
            }
          }
          return undefined;
        },
      );

      // 2.6 裸包名（无 @scope）：preact、react、lodash 等，与 resolver-deno.bak 一致，客户端用 projectDir 查 deno.json
      build.onResolve(
        { filter: /^[a-zA-Z][a-zA-Z0-9_-]*$/ },
        async (
          args,
        ): Promise<esbuild.OnResolveResult | undefined> => {
          const packageName = args.path;
          const inNodeModules = args.importer?.includes("node_modules") ??
            false;
          const isRuntimePkg = packageName === "preact" ||
            packageName === "react";
          const useProjectDir = inNodeModules ||
            (isServerBuild === false && projectDir);
          const startDir = useProjectDir
            ? (projectDir ?? cwd())
            : (args.resolveDir ??
              (args.importer ? dirname(args.importer) : cwd()));
          const denoJsonPath = findDenoJson(startDir);
          if (!denoJsonPath) return undefined;
          const config = getConfig(denoJsonPath);
          const packageImport = getPackageImport(
            denoJsonPath,
            packageName,
            config,
          );
          if (
            !packageImport ||
            (!packageImport.startsWith("jsr:") &&
              !packageImport.startsWith("npm:"))
          ) {
            return undefined;
          }
          if (isServerBuild && !browserMode) {
            debugLog(
              $tr("log.esbuild.resolverDeno.serverBuildExternal", {
                specifier: packageImport,
              }),
            );
            return { path: packageImport, external: true };
          }
          const forceBundle = !isServerBuild && isRuntimePkg;
          if (browserMode && !forceBundle) {
            const url = convertSpecifierToBrowserUrl(packageImport);
            if (url) return { path: url, external: true };
          }
          if (!moduleCache || !cacheLookupWithCheck(packageImport)) {
            if (packageImport.startsWith("npm:")) {
              const filePath = await resolveNpmSpecifierToFilePath(
                packageImport,
                denoJsonPath,
              );
              if (filePath) {
                return { path: filePath, namespace: "file" };
              }
            }
            if (packageImport.startsWith("jsr:")) {
              const resolved = await resolveJsrSpecifierToCachedModule(
                packageImport,
                denoJsonPath,
                moduleCache,
              );
              if (resolved) {
                if (moduleCache) {
                  return jsrCacheMissResolveResult(
                    moduleCache,
                    packageImport,
                    resolved,
                  );
                }
                return { path: resolved.localPath, namespace: "file" };
              }
            }
            return undefined;
          }
          debugLog(
            $tr("log.esbuild.resolverDeno.barePkgResolve", {
              packageName,
              packageImport,
            }),
          );
          return { path: packageImport, namespace: NAMESPACE_DENO_PROTOCOL };
        },
      );

      // 2.7 裸包子路径：preact/jsx-runtime、react/jsx-runtime 等，与 resolver-deno.bak 一致；优先 resolveOverrides
      build.onResolve(
        { filter: /^[a-zA-Z][a-zA-Z0-9_-]*\/.+$/ },
        async (
          args,
        ): Promise<esbuild.OnResolveResult | undefined> => {
          const path = args.path;
          const override = resolveOverrides[path];
          if (override && existsSyncMemo(override)) {
            debugLog(
              $tr("log.esbuild.resolverDeno.resolveOverrides", {
                path,
                override,
              }),
            );
            return { path: override, namespace: "file" };
          }
          const slashIdx = path.indexOf("/");
          const packageName = path.slice(0, slashIdx);
          const subpath = path.slice(slashIdx + 1);
          const inNodeModules = args.importer?.includes("node_modules") ??
            false;
          const isRuntimePkg = packageName === "preact" ||
            packageName === "react";
          const useProjectDir = inNodeModules ||
            (isServerBuild === false && projectDir);
          const startDir = useProjectDir
            ? (projectDir ?? cwd())
            : (args.resolveDir ??
              (args.importer ? dirname(args.importer) : cwd()));
          const denoJsonPath = findDenoJson(startDir);
          if (!denoJsonPath) return undefined;
          const config = getConfig(denoJsonPath);
          let packageImport = getPackageImport(denoJsonPath, path, config);
          if (!packageImport) {
            const baseImport = getPackageImport(
              denoJsonPath,
              packageName,
              config,
            );
            if (baseImport) packageImport = `${baseImport}/${subpath}`;
          }
          if (
            !packageImport ||
            (!packageImport.startsWith("jsr:") &&
              !packageImport.startsWith("npm:"))
          ) {
            return undefined;
          }
          if (isServerBuild && !browserMode) {
            debugLog(
              $tr("log.esbuild.resolverDeno.serverBuildExternal", {
                specifier: packageImport,
              }),
            );
            return { path: packageImport, external: true };
          }
          const forceBundleSubpath = !isServerBuild && isRuntimePkg;
          if (browserMode && !forceBundleSubpath) {
            const url = convertSpecifierToBrowserUrl(packageImport);
            if (url) return { path: url, external: true };
          }
          if (!moduleCache || !cacheLookupWithCheck(packageImport)) {
            if (packageImport.startsWith("npm:")) {
              const filePath = await resolveNpmSpecifierToFilePath(
                packageImport,
                denoJsonPath,
              );
              if (filePath) {
                return { path: filePath, namespace: "file" };
              }
            }
            if (packageImport.startsWith("jsr:")) {
              const resolved = await resolveJsrSpecifierToCachedModule(
                packageImport,
                denoJsonPath,
                moduleCache,
              );
              if (resolved) {
                if (moduleCache) {
                  return jsrCacheMissResolveResult(
                    moduleCache,
                    packageImport,
                    resolved,
                  );
                }
                return { path: resolved.localPath, namespace: "file" };
              }
            }
            return undefined;
          }
          debugLog(
            $tr("log.esbuild.resolverDeno.bareSubpathResolve", {
              path,
              packageImport,
            }),
          );
          return { path: packageImport, namespace: NAMESPACE_DENO_PROTOCOL };
        },
      );

      // 3. deno-protocol 下的相对路径：用 importer 的 cache key 作 base，返回 target specifier 走 onLoad（支持 jsr: 与 npm:，保证 preact 子路径 ../ 解析到主包单例）
      build.onResolve(
        { filter: /^\.\.?(\/.*)?$/, namespace: NAMESPACE_DENO_PROTOCOL },
        (args): esbuild.OnResolveResult | undefined => {
          let protocolPath = args.importer ?? "";
          const prefix = `${NAMESPACE_DENO_PROTOCOL}:`;
          if (protocolPath.startsWith(prefix)) {
            protocolPath = protocolPath.slice(prefix.length);
          }
          if (
            (!protocolPath.startsWith("jsr:") &&
              !protocolPath.startsWith("npm:")) ||
            !moduleCache
          ) {
            return undefined;
          }
          const importerResult = cacheLookup(
            protocolPath,
            moduleCache,
            existsSync,
          );
          const targetSpecifier = resolveRelative(
            protocolPath,
            args.path,
            cacheLookupWithCheck,
            importerResult?.key,
          );
          if (targetSpecifier) {
            debugLog(
              $tr("log.esbuild.resolverDeno.resolveRelative", {
                protocolPath,
                relativePath: args.path,
                targetSpecifier,
              }),
            );
            return {
              path: targetSpecifier,
              namespace: NAMESPACE_DENO_PROTOCOL,
            };
          }
          return undefined;
        },
      );

      // 4. onLoad：仅从 cache 读文件；用匹配到的 cache key 决定 loader；必须返回 resolveDir 以便包内相对路径（如 ./cjs/react.production.js）可被解析
      build.onLoad(
        { filter: /.*/, namespace: NAMESPACE_DENO_PROTOCOL },
        (args): esbuild.OnLoadResult | undefined => {
          const protocolPath = normalizeProtocolSpecifier(args.path);
          debugLog(
            $tr("log.esbuild.resolverDeno.onLoadProtocol", { protocolPath }),
          );
          if (!moduleCache) return undefined;
          const result = cacheLookup(protocolPath, moduleCache, existsSync);
          if (!result) return undefined;
          const { path: localPath, key } = result;
          const contents = stripDenoCacheMetadata(
            readTextFileSync(localPath),
          );
          const loader = inferEsbuildLoader(key, localPath, contents);
          const resolveDir = dirname(localPath);
          debugLog(
            $tr("log.esbuild.resolverDeno.onLoadFromCache", {
              protocolPath,
              localPath,
              count: String(contents.length),
            }),
          );
          return { contents, loader, resolveDir };
        },
      );

      // 5. 无扩展名的 Deno 哈希缓存若被误标成 file namespace，仍按 TS/TSX 加载
      build.onLoad(
        { filter: /.*/, namespace: "file" },
        (args): esbuild.OnLoadResult | undefined => {
          if (!isDenoExtensionlessCachePath(args.path)) return undefined;
          if (!existsSync(args.path)) return undefined;
          const contents = stripDenoCacheMetadata(
            readTextFileSync(args.path),
          );
          let key = args.path;
          if (moduleCache) {
            const indexed = getCacheIndex(moduleCache).canonicalByPath.get(
              args.path,
            );
            if (indexed) key = indexed;
          }
          return {
            contents,
            loader: inferEsbuildLoader(key, args.path, contents),
            resolveDir: dirname(args.path),
          };
        },
      );
    },
  };
}

/**
 * 供单测断言：JSR 子路径在 moduleCache 中的解析结果。
 * 回归：`router` 不得因正则前缀匹配到 `router-mount.ts`。
 *
 * @param specifier - 如 `jsr:@dreamer/view@1.3.0/router`
 * @param moduleCache - Deno 缓存模块映射
 * @param existsCheck - 本地路径是否存在
 */
export function parseDenoInfoLocalPathForTests(
  text: string,
): string | undefined {
  return parseDenoInfoLocalPath(text);
}

export function isDenoExtensionlessCachePathForTests(
  filePath: string,
): boolean {
  return isDenoExtensionlessCachePath(filePath);
}

export function inferEsbuildLoaderForTests(
  key: string,
  localPath: string,
  contents: string,
): "ts" | "tsx" | "js" | "jsx" | "json" {
  return inferEsbuildLoader(key, localPath, contents);
}

export function jsrCacheMissResolveResultForTests(
  cache: ModuleCache,
  requestSpec: string,
  resolved: { localPath: string; cacheKey: string },
): { path: string; namespace: string } {
  return jsrCacheMissResolveResult(cache, requestSpec, resolved);
}

export function localPathFromDenoInfoJsonForTests(
  info: DenoInfoOutput,
  specifier: string,
): string | undefined {
  return localPathFromDenoInfoJson(info, specifier);
}

export function mergeDenoInfoModulesForTests(
  info: DenoInfoOutput,
  cache: ModuleCache,
): void {
  mergeDenoInfoModules(info, cache, new Set(), () => {});
}

export function cacheLookupForTests(
  specifier: string,
  moduleCache: ModuleCache,
  existsCheck: (p: string) => boolean,
): CacheLookupResult | undefined {
  return cacheLookup(specifier, moduleCache, existsCheck);
}

export async function collectProjectSourceFilesForTests(
  projectDir: string,
  entryPoint: string,
  projectDenoJson?: string,
): Promise<string[]> {
  return await collectProjectSourceFiles(
    projectDir,
    entryPoint,
    projectDenoJson,
  );
}
