/**
 * Deno `deno info` 模块映射磁盘缓存：写入 `~/.dreamer/<项目目录名>/esbuild-deno-cache/`，
 * 避免每次 esbuild 构建重复起子进程解析依赖图。
 *
 * **指纹**：`deno.json` 与 `deno.lock` 全文拼接后哈希（任一侧变更即失效）；无 `deno.json` 时为 `no-deno-json`。
 * **单文件**：同一指纹下整仓共用一个 `deno-module-map-<指纹>.json`，与具体构建入口无关；
 * 新入口解析后写入时会与盘上已有条目 **合并**（同一 specifier 后写覆盖先写）。
 * **写盘**：先写临时文件再 `rename` 替换，避免崩溃留下半截 JSON；尽量用目录锁序列化写并 **写前再读** 合并，减轻并发构建丢条目。
 * 禁用：`DREAMER_DENO_MODULE_DISK_CACHE=0`。
 *
 * @module @dreamer/esbuild/plugins/deno-module-cache-disk
 */

import {
  basename,
  dirname,
  ensureDir,
  existsSync,
  getEnv,
  hash,
  join,
  mkdir,
  readTextFile,
  remove,
  rename,
  resolve,
  writeTextFile,
} from "@dreamer/runtime-adapter";

/** 与 dweb `cache-dirs` 一致：项目根文件夹名安全化 */
function sanitizeDreamerProjectSegment(segment: string): string {
  const s = segment
    .replace(/\\/g, "-")
    .replace(/[/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 120)
    .trim();
  return s || "project";
}

/**
 * 解析用于 `~/.dreamer/<segment>/` 的项目根（含 `deno.json` 的目录）
 *
 * @param workDir - `buildModuleCache` 的 projectDir（常为入口所在目录）
 * @param projectDenoJson - `findProjectDenoJson` 结果，可为 undefined
 */
export function resolveDreamerProjectRootForCache(
  workDir: string,
  projectDenoJson: string | undefined,
): string {
  if (projectDenoJson) {
    return resolve(dirname(projectDenoJson));
  }
  return resolve(workDir);
}

/**
 * `~/.dreamer/<项目目录名>/esbuild-deno-cache/`；无法取得用户主目录时返回 null
 *
 * @param projectRootAbs - 项目根绝对路径
 */
export function getDreamerEsbuildDenoCacheDir(
  projectRootAbs: string,
): string | null {
  const home = getEnv("HOME") ?? getEnv("USERPROFILE") ??
    getEnv("LOCALAPPDATA");
  if (!home) return null;
  const segment = sanitizeDreamerProjectSegment(
    basename(resolve(projectRootAbs)),
  );
  return join(home, ".dreamer", segment, "esbuild-deno-cache");
}

/**
 * 根据 `deno.json` + `deno.lock` 内容生成磁盘缓存指纹（与入口、workDir 无关）。
 * 仅改 imports 未更新 lock 时也会使指纹变化，避免沿用陈旧映射。
 *
 * @param projectDenoJsonPath - 项目 `deno.json` 绝对路径，用于读取配置与同目录下 `deno.lock`；undefined 时返回固定串
 * @returns 哈希十六进制串，或 `no-deno-json`
 */
export async function computeDenoLockFingerprint(
  projectDenoJsonPath: string | undefined,
): Promise<string> {
  if (!projectDenoJsonPath) return "no-deno-json";
  const root = dirname(projectDenoJsonPath);
  const lockPath = join(root, "deno.lock");
  let denoJsonText = "";
  try {
    denoJsonText = await readTextFile(projectDenoJsonPath);
  } catch {
    /* 读失败时按空串参与哈希，仍与「可读」时区分度由 lock 等补足 */
  }
  let lockText = "";
  try {
    if (existsSync(lockPath)) {
      lockText = await readTextFile(lockPath);
    }
  } catch {
    /* 读 lock 失败视为无 lock 内容 */
  }
  const combined = `deno.json\n${denoJsonText}\ndeno.lock\n${lockText}`;
  return await hash(combined);
}

/**
 * @deprecated 请使用 {@link computeDenoLockFingerprint}（现为 deno.json + deno.lock 联合指纹）
 */
export async function computeDenoConfigFingerprint(
  projectDenoJsonPath: string | undefined,
): Promise<string> {
  return await computeDenoLockFingerprint(projectDenoJsonPath);
}

/** 聚合磁盘 JSON（v3）：单项目、单缓存指纹一份文件 */
export interface DenoModuleDiskCachePayloadV3 {
  v: 3;
  /** 与 {@link computeDenoLockFingerprint} 一致（字段名历史沿用，实为 deno.json+lock 联合指纹） */
  lockFingerprint: string;
  entries: [string, string][];
}

/**
 * 聚合缓存文件路径：`deno-module-map-<lockFingerprint>.json`
 */
export function resolveDenoModuleDiskAggregatePath(
  projectRootAbs: string,
  lockFingerprint: string,
): string | null {
  const base = getDreamerEsbuildDenoCacheDir(projectRootAbs);
  if (!base) return null;
  return join(base, `deno-module-map-${lockFingerprint}.json`);
}

/**
 * @deprecated 已改为按 lock 单文件聚合，请使用 {@link resolveDenoModuleDiskAggregatePath}
 */
export function resolveDenoModuleDiskCacheFilePath(
  projectRootAbs: string,
  fingerprint: string,
  _entryForDeno: string,
  _workDirNorm: string,
): string | null {
  return resolveDenoModuleDiskAggregatePath(projectRootAbs, fingerprint);
}

/** 磁盘 JSON 结构（历史 v1，仅兼容读） */
export interface DenoModuleDiskCachePayloadV1 {
  v: 1;
  fingerprint: string;
  entryForDeno: string;
  workDirNorm: string;
  entries: [string, string][];
}

/**
 * 从磁盘读取**整项目**合并后的模块映射；校验失败或禁用则返回 null
 */
export async function tryLoadDenoModuleCacheFromDisk(
  projectRootAbs: string,
  lockFingerprint: string,
): Promise<Map<string, string> | null> {
  if (getEnv("DREAMER_DENO_MODULE_DISK_CACHE") === "0") return null;
  try {
    const filePath = resolveDenoModuleDiskAggregatePath(
      projectRootAbs,
      lockFingerprint,
    );
    if (!filePath || !existsSync(filePath)) return null;
    const raw = await readTextFile(filePath);
    const data = JSON.parse(raw) as
      | DenoModuleDiskCachePayloadV3
      | DenoModuleDiskCachePayloadV1;
    if (data.v === 3 && "lockFingerprint" in data) {
      if (data.lockFingerprint !== lockFingerprint) return null;
      if (!Array.isArray(data.entries)) return null;
      return new Map(data.entries);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 尝试创建独占「锁目录」；`mkdir` 在 `recursive: false` 时若已存在则失败，用作跨进程互斥（Unix/Windows 常见场景）。
 *
 * @param lockDir - 锁目录绝对路径
 * @param maxWaitMs - 最长等待毫秒数
 * @returns 是否取得锁（超时则为 false，调用方可降级为无锁写）
 */
async function tryAcquireDenoModuleDiskWriteLock(
  lockDir: string,
  maxWaitMs: number,
): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      await mkdir(lockDir, { recursive: false });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  return false;
}

/**
 * 将文本写入目标路径：先写临时文件再 `rename` 覆盖，读侧要么见旧文件要么见完整新文件。
 * Windows 下目标已存在时先删再 rename（非严格原子，但仍避免损坏 JSON）。
 *
 * @param finalPath - 最终 JSON 路径
 * @param content - 完整文件内容
 */
async function writeTextFileReplacingAtomically(
  finalPath: string,
  content: string,
): Promise<void> {
  const rnd = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const tmpPath = `${finalPath}.${rnd}.tmp`;
  try {
    await writeTextFile(tmpPath, content);
    try {
      await rename(tmpPath, finalPath);
    } catch {
      if (existsSync(finalPath)) {
        await remove(finalPath);
      }
      await rename(tmpPath, finalPath);
    }
  } catch (e) {
    try {
      if (existsSync(tmpPath)) await remove(tmpPath);
    } catch {
      /* ignore */
    }
    throw e;
  }
}

/**
 * 将**当前内存中的**模块映射写回磁盘：写前尽量再读盘合并（持锁时与其它进程串行），再以原子替换落盘。
 * 调用方传入的 `cache` 已含预载 + 本次 `deno info`；此处再合并是为捕获并行构建中其它进程已写入的条目。
 */
export async function saveDenoModuleCacheToDisk(
  projectRootAbs: string,
  lockFingerprint: string,
  cache: Map<string, string>,
): Promise<void> {
  if (getEnv("DREAMER_DENO_MODULE_DISK_CACHE") === "0") return;
  if (cache.size === 0) return;
  try {
    const base = getDreamerEsbuildDenoCacheDir(projectRootAbs);
    if (!base) return;
    await ensureDir(base);
    const filePath = resolveDenoModuleDiskAggregatePath(
      projectRootAbs,
      lockFingerprint,
    );
    if (!filePath) return;

    const lockDir = join(base, ".deno-module-cache-write.lock");
    const gotLock = await tryAcquireDenoModuleDiskWriteLock(lockDir, 2000);
    try {
      const diskNow = await tryLoadDenoModuleCacheFromDisk(
        projectRootAbs,
        lockFingerprint,
      );
      const merged: Map<string, string> = diskNow
        ? new Map(diskNow)
        : new Map();
      for (const [k, v] of cache) merged.set(k, v);
      if (merged.size === 0) return;

      const payload: DenoModuleDiskCachePayloadV3 = {
        v: 3,
        lockFingerprint,
        entries: [...merged.entries()],
      };
      await writeTextFileReplacingAtomically(
        filePath,
        JSON.stringify(payload),
      );
    } finally {
      if (gotLock) {
        try {
          await remove(lockDir, { recursive: true });
        } catch {
          /* 释放锁失败不阻断构建；用户可手动删锁目录 */
        }
      }
    }
  } catch {
    /* 写盘失败不阻断构建 */
  }
}
