/**
 * @fileoverview 子路径导出测试
 *
 * 验证 jsr:@dreamer/esbuild/builder、/client、/server、/bundle 等子路径导出的 API 正确性
 */

import { describe, expect, it } from "@dreamer/test";
import {
  Builder,
  AssetsProcessor,
  createBuilder,
  type BuilderConfig,
} from "../src/entry-builder.ts";
import {
  BuilderClient,
  type ClientBuildOptions,
} from "../src/entry-client.ts";
import {
  BuilderServer,
  type ServerBuildOptions,
} from "../src/entry-server.ts";
import {
  buildBundle,
  BuilderBundle,
  type BundleOptions,
  type BundleResult,
} from "../src/entry-bundle.ts";
import {
  generateCSSTag,
  generateCSSTags,
  injectCSSIntoHTML,
  injectCSSFromDependencies,
  getCSSRelativePath,
} from "../src/utils/css-injector.ts";

describe("entry-builder 子路径导出", () => {
  it("应该导出 Builder 类", () => {
    expect(Builder).toBeDefined();
    expect(typeof Builder).toBe("function");
  });

  it("应该导出 AssetsProcessor 类", () => {
    expect(AssetsProcessor).toBeDefined();
    expect(typeof AssetsProcessor).toBe("function");
  });

  it("应该导出 createBuilder 函数", () => {
    expect(createBuilder).toBeDefined();
    expect(typeof createBuilder).toBe("function");
  });

  it("createBuilder 应该返回 Builder 实例", () => {
    const config: BuilderConfig = {
      client: {
        entry: "./src/index.ts",
        output: "./dist/client",
        engine: "preact",
      },
    };
    const builder = createBuilder(config);
    expect(builder).toBeInstanceOf(Builder);
  });
});

describe("entry-client 子路径导出", () => {
  it("应该导出 BuilderClient 类", () => {
    expect(BuilderClient).toBeDefined();
    expect(typeof BuilderClient).toBe("function");
  });

  it("应该支持 ClientBuildOptions 类型", () => {
    const opts: ClientBuildOptions = {
      mode: "prod",
      write: true,
    };
    expect(opts.mode).toBe("prod");
    expect(opts.write).toBe(true);
  });

  it("应该能创建 BuilderClient 实例", () => {
    const client = new BuilderClient({
      entry: "./src/index.ts",
      output: "./dist",
      engine: "preact",
    });
    expect(client).toBeInstanceOf(BuilderClient);
  });
});

describe("entry-server 子路径导出", () => {
  it("应该导出 BuilderServer 类", () => {
    expect(BuilderServer).toBeDefined();
    expect(typeof BuilderServer).toBe("function");
  });

  it("应该支持 ServerBuildOptions 类型", () => {
    const opts: ServerBuildOptions = {
      mode: "prod",
      write: true,
    };
    expect(opts.mode).toBe("prod");
    expect(opts.write).toBe(true);
  });

  it("应该能创建 BuilderServer 实例", () => {
    const server = new BuilderServer({
      entry: "./src/server.ts",
      output: "./dist",
    });
    expect(server).toBeInstanceOf(BuilderServer);
  });
});

describe("entry-bundle 子路径导出", () => {
  it("应该导出 buildBundle 函数", () => {
    expect(buildBundle).toBeDefined();
    expect(typeof buildBundle).toBe("function");
  });

  it("应该导出 BuilderBundle 类", () => {
    expect(BuilderBundle).toBeDefined();
    expect(typeof BuilderBundle).toBe("function");
  });

  it("应该支持 BundleOptions 类型", () => {
    const opts: BundleOptions = {
      entryPoint: "./src/index.ts",
    };
    expect(opts.entryPoint).toBe("./src/index.ts");
  });

  it("应该支持 BundleResult 类型", () => {
    const result: BundleResult = {
      code: "console.log('hello');",
    };
    expect(result.code).toBeDefined();
    expect(typeof result.code).toBe("string");
  });
});

describe("css-injector 子路径导出", () => {
  it("应该导出 generateCSSTag", () => {
    expect(generateCSSTag).toBeDefined();
    expect(typeof generateCSSTag).toBe("function");
  });

  it("应该导出 generateCSSTags", () => {
    expect(generateCSSTags).toBeDefined();
    expect(typeof generateCSSTags).toBe("function");
  });

  it("应该导出 injectCSSIntoHTML", () => {
    expect(injectCSSIntoHTML).toBeDefined();
    expect(typeof injectCSSIntoHTML).toBe("function");
  });

  it("应该导出 injectCSSFromDependencies", () => {
    expect(injectCSSFromDependencies).toBeDefined();
    expect(typeof injectCSSFromDependencies).toBe("function");
  });

  it("应该导出 getCSSRelativePath", () => {
    expect(getCSSRelativePath).toBeDefined();
    expect(typeof getCSSRelativePath).toBe("function");
  });
});
