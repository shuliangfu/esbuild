/**
 * @fileoverview 针对 @dreamer/view 子路径的解析器测试
 *
 * 验证从 @dreamer/view/store 等子路径入口解析相对导入（如 ./signal.ts、./effect.ts）
 * 时，能按包内真实路径（exports）解析为正确子路径（如 .../signal、.../effect），
 * 而非错误地解析为 store/signal.ts（包内无此导出会导致打包得到 (void 0)）。
 *
 * 覆盖范围：view 的 exports 中，当前仅 store 子路径会相对导入其它已导出模块；
 * 本用例覆盖 store 的全部 5 个相对依赖（signal、effect、scheduler、proxy、types）。
 * 其它 exports（cli、router、boundary 等）未被 store 引用，无需在本套件中做“从子路径解析相对路径”的用例。
 */

import { IS_DENO } from "@dreamer/runtime-adapter";
import { afterEach, beforeEach, describe, expect, it } from "@dreamer/test";
import { resolveJsrRelativeFromMeta } from "../src/plugins/resolver-deno.ts";

/**
 * 模拟 @dreamer/view 的 deno.json exports，用于 mock _meta.json。
 * 与 view 包 exports 对齐；scheduler、proxy 为 store 依赖但 view 未单独导出，此处保留以便 store 相对导入能解析。
 */
const VIEW_LIKE_EXPORTS: Record<string, string> = {
  ".": "./src/mod.ts",
  "./cli": "./src/cli.ts",
  "./setup": "./src/setup.ts",
  "./csr": "./src/mod-csr.ts",
  "./hybrid": "./src/mod-hybrid.ts",
  "./jsx-runtime": "./src/jsx-runtime.ts",
  "./reactive": "./src/reactive.ts",
  "./boundary": "./src/boundary.ts",
  "./directive": "./src/directive.ts",
  "./resource": "./src/resource.ts",
  "./compiler": "./src/compiler.ts",
  "./context": "./src/context.ts",
  "./stream": "./src/stream.ts",
  "./router": "./src/router.ts",
  "./store": "./src/store.ts",
  "./types": "./src/types.ts",
  "./signal": "./src/signal.ts",
  "./effect": "./src/effect.ts",
  "./scheduler": "./src/scheduler.ts",
  "./proxy": "./src/proxy.ts",
};

describe("resolveJsrRelativeFromMeta（view 子路径）", () => {
  if (!IS_DENO) {
    it("仅 Deno 环境运行", () => {
      expect(IS_DENO).toBe(true);
    });
    return;
  }

  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("store + ./signal.ts 应解析为 .../signal", async () => {
    globalThis.fetch = (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("@dreamer/view") && url.endsWith("_meta.json")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ exports: VIEW_LIKE_EXPORTS }),
            { headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return originalFetch(input);
    };

    const out = await resolveJsrRelativeFromMeta(
      "jsr:@dreamer/view@^1.0.0-beta.18/store",
      "./signal.ts",
      false,
    );
    expect(out).toBe("jsr:@dreamer/view@^1.0.0-beta.18/signal");
  });

  it("store + ./effect.ts 应解析为 .../effect", async () => {
    globalThis.fetch = (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("@dreamer/view") && url.endsWith("_meta.json")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ exports: VIEW_LIKE_EXPORTS }),
            { headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return originalFetch(input);
    };

    const out = await resolveJsrRelativeFromMeta(
      "jsr:@dreamer/view@^1.0.0-beta.18/store",
      "./effect.ts",
      false,
    );
    expect(out).toBe("jsr:@dreamer/view@^1.0.0-beta.18/effect");
  });

  it("store + ./scheduler.ts 应解析为 .../scheduler", async () => {
    globalThis.fetch = (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("@dreamer/view") && url.endsWith("_meta.json")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ exports: VIEW_LIKE_EXPORTS }),
            { headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return originalFetch(input);
    };

    const out = await resolveJsrRelativeFromMeta(
      "jsr:@dreamer/view@^1.0.0-beta.18/store",
      "./scheduler.ts",
      false,
    );
    expect(out).toBe("jsr:@dreamer/view@^1.0.0-beta.18/scheduler");
  });

  it("store + ./proxy.ts 应解析为 .../proxy", async () => {
    globalThis.fetch = (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("@dreamer/view") && url.endsWith("_meta.json")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ exports: VIEW_LIKE_EXPORTS }),
            { headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return originalFetch(input);
    };

    const out = await resolveJsrRelativeFromMeta(
      "jsr:@dreamer/view@^1.0.0-beta.18/store",
      "./proxy.ts",
      false,
    );
    expect(out).toBe("jsr:@dreamer/view@^1.0.0-beta.18/proxy");
  });

  it("store + ./types.ts 应解析为 .../types", async () => {
    globalThis.fetch = (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("@dreamer/view") && url.endsWith("_meta.json")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ exports: VIEW_LIKE_EXPORTS }),
            { headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return originalFetch(input);
    };

    const out = await resolveJsrRelativeFromMeta(
      "jsr:@dreamer/view@^1.0.0-beta.18/store",
      "./types.ts",
      false,
    );
    expect(out).toBe("jsr:@dreamer/view@^1.0.0-beta.18/types");
  });

  it("非 jsr: 协议应返回 null", async () => {
    const out = await resolveJsrRelativeFromMeta(
      "npm:some-pkg@1.0.0/sub",
      "./foo.ts",
      false,
    );
    expect(out).toBeNull();
  });
});
