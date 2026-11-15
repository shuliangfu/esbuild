import { describe, expect, it } from "@dreamer/test";
import {
  processConditionalCompileForTests,
  shouldSkipConditionalCompilePathForTests,
} from "../src/plugins/conditional-compile.ts";

describe("条件编译快路径", () => {
  it("没有 #ifdef 的文件应原样返回，不改内容", () => {
    const src = "export const n = 1;\n";
    expect(processConditionalCompileForTests(src, "CLIENT")).toBe(src);
  });

  it("应跳过 node_modules 与 Deno 缓存路径", () => {
    expect(
      shouldSkipConditionalCompilePathForTests(
        "/app/node_modules/chart.js/dist/chart.js",
      ),
    ).toBe(true);
    expect(
      shouldSkipConditionalCompilePathForTests(
        "/Users/me/Library/Caches/deno/remote/https/jsr.io/hash",
      ),
    ).toBe(true);
    expect(
      shouldSkipConditionalCompilePathForTests(
        "/app/src/backend/routes/index.tsx",
      ),
    ).toBe(false);
  });

  it("仍应去掉不匹配的 #ifdef 块", () => {
    const src = `const a = 1;
// #ifdef SERVER
import { db } from "./db.ts";
// #endif
const b = 2;
`;
    const out = processConditionalCompileForTests(src, "CLIENT");
    expect(out.includes("db")).toBe(false);
    expect(out.includes("const a = 1;")).toBe(true);
    expect(out.includes("const b = 2;")).toBe(true);
  });
});
