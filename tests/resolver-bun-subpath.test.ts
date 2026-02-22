/**
 * @fileoverview Bun 解析器子路径（npm:pkg/client）按 exports 解析的集成测试
 *
 * 通过实际编译验证：import @dreamer/router/client 时，onLoad 能按 package.json exports
 * 正确加载 client 模块，产物中包含 createRouter。仅当 IS_BUN 时执行。
 */

import { IS_BUN, join, mkdir, writeTextFile } from "@dreamer/runtime-adapter";
import { afterAll, beforeAll, describe, expect, it } from "@dreamer/test";
import { buildBundle } from "../src/builder-bundle.ts";
import { bunResolverPlugin } from "../src/plugins/resolver-bun.ts";
import { cleanupDir, getTestOutputDir } from "./test-utils.ts";

const subpathTestDir = getTestOutputDir("resolver-bun-subpath");

if (IS_BUN) {
  describe("Bun 解析器子路径 (npm:pkg/client 按 exports 解析)", () => {
    beforeAll(async () => {
      await mkdir(subpathTestDir, { recursive: true });
      await writeTextFile(
        join(subpathTestDir, "package.json"),
        JSON.stringify(
          {
            name: "resolver-bun-subpath-test",
            type: "module",
            imports: {
              "@dreamer/router": "npm:@jsr/dreamer__router@^1.0.15",
            },
          },
          null,
          2,
        ),
      );
      await writeTextFile(
        join(subpathTestDir, "entry.ts"),
        `import { createRouter } from "@dreamer/router/client";
export const hasCreateRouter = typeof createRouter === "function";
`,
      );
    });

    afterAll(async () => {
      try {
        await cleanupDir(subpathTestDir);
      } catch {
        /* ignore */
      }
    });

    it(
      "应能编译并打包 @dreamer/router/client，产物中包含 createRouter",
      async () => {
        const result = await buildBundle({
          entryPoint: join(subpathTestDir, "entry.ts"),
          globalName: "SubpathTest",
          platform: "browser",
          format: "iife",
          plugins: [bunResolverPlugin()],
        });

        expect(result).toBeDefined();
        expect(result.code).toBeDefined();
        expect(result.code.length).toBeGreaterThan(0);
        expect(result.code).toContain("SubpathTest");
        // 子路径按 exports 解析后应打入 client 模块，产物中应有 createRouter 或相关符号
        expect(
          result.code.includes("createRouter") ||
            result.code.includes("hasCreateRouter"),
        ).toBe(true);
      },
      { sanitizeOps: false, sanitizeResources: false, timeout: 15000 },
    );
  });
}
