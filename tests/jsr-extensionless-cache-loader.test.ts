/**
 * Deno 远程缓存文件无扩展名时，jsr cache miss 不得走 file+JS loader。
 */
import { describe, expect, it } from "@dreamer/test";
import {
  inferEsbuildLoaderForTests,
  isDenoExtensionlessCachePathForTests,
  jsrCacheMissResolveResultForTests,
} from "../src/plugins/resolver-deno.ts";

const HASH_PATH =
  "/Users/someone/Library/Caches/deno/remote/https/jsr.io/3a064737881f45f1988827834b2efa218a3a4ef8a10a2a3673d3e4a4025afaef";

const OVERLAY_TS = `import type { Owner } from "../reactivity/owner.ts";
export function mount() {
  return <div class="overlay">ok</div>;
}
`;

describe("isDenoExtensionlessCachePath", () => {
  it("treats hashed jsr.io cache files as extensionless Deno cache", () => {
    expect(isDenoExtensionlessCachePathForTests(HASH_PATH)).toBe(true);
  });

  it("does not flag ordinary source files with extensions", () => {
    expect(
      isDenoExtensionlessCachePathForTests(
        "/Users/someone/worker/view/src/devtools/overlay.ts",
      ),
    ).toBe(false);
  });
});

describe("inferEsbuildLoader", () => {
  it("uses ts for import-type-only .ts without JSX", () => {
    expect(
      inferEsbuildLoaderForTests(
        "jsr:@dreamer/view@3.1.0/src/devtools/owner.ts",
        HASH_PATH,
        'import type { Owner } from "./owner.ts";\nexport type { Owner };\n',
      ),
    ).toBe("ts");
  });

  it("upgrades .ts overlay with JSX to tsx so import type and tags both parse", () => {
    expect(
      inferEsbuildLoaderForTests(
        "jsr:@dreamer/view@3.1.0/src/devtools/overlay.ts",
        HASH_PATH,
        OVERLAY_TS,
      ),
    ).toBe("tsx");
  });

  it("uses tsx for extensionless cache paths that contain JSX", () => {
    expect(inferEsbuildLoaderForTests(HASH_PATH, HASH_PATH, OVERLAY_TS)).toBe(
      "tsx",
    );
  });
});

describe("jsrCacheMissResolveResult", () => {
  it("routes extensionless Deno cache hits through deno-protocol", () => {
    const cache = new Map<string, string>();
    const result = jsrCacheMissResolveResultForTests(
      cache,
      "jsr:@dreamer/view@^3.1.0/devtools/overlay",
      {
        localPath: HASH_PATH,
        cacheKey: "jsr:@dreamer/view@3.1.0/src/devtools/overlay.ts",
      },
    );
    expect(result.namespace).toBe("deno-protocol");
    expect(result.path).toBe(
      "jsr:@dreamer/view@3.1.0/src/devtools/overlay.ts",
    );
    expect(cache.get("jsr:@dreamer/view@^3.1.0/devtools/overlay")).toBe(
      HASH_PATH,
    );
  });
});
