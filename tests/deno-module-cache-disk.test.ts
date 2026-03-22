/**
 * @fileoverview {@link ../src/plugins/deno-module-cache-disk.ts} 指纹与磁盘读写行为单测
 */

import {
  ensureDir,
  getEnv,
  join,
  makeTempDir,
  remove,
  setEnv,
  writeTextFile,
} from "@dreamer/runtime-adapter";
import { afterAll, beforeAll, describe, expect, it } from "@dreamer/test";
import {
  computeDenoLockFingerprint,
  resolveDreamerProjectRootForCache,
  saveDenoModuleCacheToDisk,
  tryLoadDenoModuleCacheFromDisk,
} from "../src/plugins/deno-module-cache-disk.ts";

describe("deno-module-cache-disk", () => {
  let tmpRoot: string;
  let denoJsonPath: string;
  /** 将 `~/.dreamer` 落到临时目录，避免污染真实主目录 */
  let fakeHome: string;
  let prevHome: string | undefined;

  beforeAll(async () => {
    tmpRoot = await makeTempDir({ prefix: "dreamer-deno-disk-cache-" });
    fakeHome = join(tmpRoot, "home");
    await ensureDir(fakeHome);
    prevHome = getEnv("HOME");
    setEnv("HOME", fakeHome);

    denoJsonPath = join(tmpRoot, "deno.json");
    await writeTextFile(denoJsonPath, '{"name":"t","version":"1.0.0"}\n');
    await writeTextFile(join(tmpRoot, "deno.lock"), "lock-v1\n");
  });

  afterAll(async () => {
    if (prevHome !== undefined) setEnv("HOME", prevHome);
    try {
      await remove(tmpRoot, { recursive: true });
    } catch {
      /* ignore */
    }
  });

  it("computeDenoLockFingerprint：deno.json 变更后指纹应变（lock 不变）", async () => {
    const fp1 = await computeDenoLockFingerprint(denoJsonPath);
    await writeTextFile(
      denoJsonPath,
      '{"name":"t","version":"1.0.0","imports":{"x":"npm:foo"}}\n',
    );
    const fp2 = await computeDenoLockFingerprint(denoJsonPath);
    expect(fp1).not.toBe(fp2);
    expect(fp1.length).toBeGreaterThan(8);
    expect(fp2.length).toBeGreaterThan(8);
  });

  it("save 后 tryLoad 应能读回；第二次 save 应合并条目", async () => {
    const projectRoot = resolveDreamerProjectRootForCache(
      tmpRoot,
      denoJsonPath,
    );
    const fp = await computeDenoLockFingerprint(denoJsonPath);
    await saveDenoModuleCacheToDisk(projectRoot, fp, new Map([["a", "/x/a"]]));
    const m1 = await tryLoadDenoModuleCacheFromDisk(projectRoot, fp);
    expect(m1?.get("a")).toBe("/x/a");
    await saveDenoModuleCacheToDisk(projectRoot, fp, new Map([["b", "/x/b"]]));
    const m2 = await tryLoadDenoModuleCacheFromDisk(projectRoot, fp);
    expect(m2?.get("a")).toBe("/x/a");
    expect(m2?.get("b")).toBe("/x/b");
  });
});
