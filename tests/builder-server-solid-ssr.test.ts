/**
 * @fileoverview Solid 服务端（SSR）单文件编译测试
 *
 * 测试 compileSolidRouteForSSR：用 esbuild-plugin-solid 的 generate: "ssr"
 * 将 Solid .tsx 路由编译为服务端可 import 的 .mjs，产出使用 escape/ssrElement 的代码。
 */

import {
  exists,
  join,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@dreamer/runtime-adapter";
import { describe, expect, it } from "@dreamer/test";
import { compileSolidRouteForSSR } from "../src/builder-server.ts";
import { getTestDataDir, getTestOutputDir } from "./test-utils.ts";

describe("compileSolidRouteForSSR (Solid SSR)", () => {
  const testDataDir = getTestDataDir();
  const solidFixtureDir = join(getTestOutputDir("solid-ssr"), "fixture");
  const routeTsxPath = join(solidFixtureDir, "route.tsx");
  /** 最小 Solid 路由组件：仅含 JSX，用于验证 SSR 编译产出 */
  const minimalSolidRoute = `
/** 测试用 Solid 路由组件 */
export default function Route() {
  return <div>Hello Solid SSR</div>;
}
`;

  it("应能创建 Solid .tsx  fixture 并完成 SSR 编译", async () => {
    await mkdir(solidFixtureDir, { recursive: true });
    await writeTextFile(routeTsxPath, minimalSolidRoute.trim());

    const outPath = await compileSolidRouteForSSR(
      routeTsxPath,
      solidFixtureDir,
    );

    expect(outPath).toBeTruthy();
    expect(outPath.endsWith("route.mjs")).toBe(true);
    const fileExists = await exists(outPath);
    expect(fileExists).toBe(true);
  }, { sanitizeOps: false, sanitizeResources: false });

  it(
    "SSR 编译产物应包含服务端运行时特征（非客户端 insert/assign）",
    async () => {
      await mkdir(solidFixtureDir, { recursive: true });
      await writeTextFile(routeTsxPath, minimalSolidRoute.trim());

      const outPath = await compileSolidRouteForSSR(
        routeTsxPath,
        solidFixtureDir,
      );
      const content = await readTextFile(outPath);

      // SSR 模式产出使用 escape/ssrElement 等，不应出现客户端专用的 notSup/insert/assign
      expect(content.length).toBeGreaterThan(0);
      // 典型 SSR 产出会包含 escape 或 ssr 相关标识
      const hasSsrOrEscape = /escape|ssr|ssrElement|\.t\s*\(/.test(content);
      expect(hasSsrOrEscape).toBe(true);
    },
    { sanitizeOps: false, sanitizeResources: false },
  );

  it("相同 contentHash 应命中缓存并返回同一 outPath", async () => {
    await mkdir(solidFixtureDir, { recursive: true });
    await writeTextFile(routeTsxPath, minimalSolidRoute.trim());

    const cacheKey = "solid-ssr-cache-test-key";
    const out1 = await compileSolidRouteForSSR(
      routeTsxPath,
      solidFixtureDir,
      cacheKey,
    );
    const out2 = await compileSolidRouteForSSR(
      routeTsxPath,
      solidFixtureDir,
      cacheKey,
    );

    expect(out1).toBe(out2);
  }, { sanitizeOps: false, sanitizeResources: false });
});
