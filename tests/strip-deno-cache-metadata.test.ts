/**
 * 回归：Deno HTTP 缓存元数据剥离不得误清空「首行 metadata + 正文」文件。
 */
import { describe, expect, it } from "@dreamer/test";
import { stripDenoCacheMetadataForTests } from "../src/plugins/resolver-deno.ts";

describe("stripDenoCacheMetadata", () => {
  it("剥除末尾 \\n// denoCacheMetadata=…", () => {
    const body = '{"a":1}';
    const contents = `${body}\n// denoCacheMetadata={"url":"https://example"}`;
    expect(stripDenoCacheMetadataForTests(contents)).toBe(body);
  });

  it("首行仅为 metadata 时保留其后正文", () => {
    const body = 'export const x = 1;\n';
    const contents = `// denoCacheMetadata={"url":"https://example"}\n${body}`;
    expect(stripDenoCacheMetadataForTests(contents)).toBe(body);
  });

  it("整文件仅 metadata（无换行）时返回空串", () => {
    expect(
      stripDenoCacheMetadataForTests("// denoCacheMetadata={\"url\":\"x\"}"),
    ).toBe("");
  });

  it("无 marker 时原样返回", () => {
    const body = "const a = 1;\n";
    expect(stripDenoCacheMetadataForTests(body)).toBe(body);
  });
});
