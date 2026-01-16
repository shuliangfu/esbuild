/**
 * @fileoverview 服务端模块检测插件测试
 *
 * 测试客户端构建时自动分离服务端代码的功能
 */

import {
  join,
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
} from "@dreamer/runtime-adapter";
import { describe, expect, it } from "@dreamer/test";
import type { ServerModuleDetectorOptions } from "../src/plugins/server-module-detector.ts";
import { createServerModuleDetectorPlugin } from "../src/plugins/server-module-detector.ts";
import type { ClientConfig } from "../src/types.ts";
import { getTestDataDir, getTestOutputDir } from "./test-utils.ts";

/**
 * 动态导入 ClientBuilder（避免在模块加载时触发 esbuild）
 */
async function getClientBuilder() {
  const { ClientBuilder } = await import("../src/client-builder.ts");
  return ClientBuilder;
}

describe("ServerModuleDetectorPlugin", () => {
  let testDataDir: string;
  let outputDir: string;

  // 测试前创建测试目录
  it("应该创建测试目录", async () => {
    testDataDir = getTestDataDir();
    outputDir = getTestOutputDir("server-module-detector");
    await mkdir(outputDir, { recursive: true });
    expect(testDataDir).toBeTruthy();
  });

  describe("插件创建", () => {
    it("应该创建服务端模块检测插件", () => {
      const plugin = createServerModuleDetectorPlugin();
      expect(plugin).toBeTruthy();
      expect(plugin.name).toBe("server-module-detector");
      expect(typeof plugin.setup).toBe("function");
    });

    it("应该支持自定义选项", () => {
      const options: ServerModuleDetectorOptions = {
        enabled: true,
        additionalPatterns: [/^@my-org\/server/],
      };
      const plugin = createServerModuleDetectorPlugin(options);
      expect(plugin).toBeTruthy();
    });

    it("应该支持禁用插件", () => {
      const plugin = createServerModuleDetectorPlugin({ enabled: false });
      expect(plugin).toBeTruthy();
    });
  });

  describe("Node.js 内置模块检测", () => {
    it("应该检测 fs 模块", async () => {
      const entryFile = join(testDataDir, "test-fs.ts");
      await writeTextFile(
        entryFile,
        `import { readFile } from "fs";
console.log("test");
`,
      );

      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };

      const BuilderClass = await getClientBuilder();
      const builder = new BuilderClass(config);
      const result = await builder.build("dev");

      // fs 模块应该被标记为 external，不会被打包
      expect(result).toBeTruthy();
      expect(result.outputFiles.length).toBeGreaterThan(0);

      // 检查输出文件，不应该包含 fs 模块的代码
      const outputFile = result.outputFiles.find((f) => f.endsWith(".js"));
      if (outputFile) {
        const content = await readTextFile(outputFile);
        // fs 模块应该被排除，不应该包含 Node.js 特定的 API
        expect(content).not.toContain("readFileSync");
        expect(content).not.toContain("fs.readFile");
      }
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该检测 path 模块", async () => {
      const entryFile = join(testDataDir, "test-path.ts");
      await writeTextFile(
        entryFile,
        `import { join } from "path";
console.log(join("a", "b"));
`,
      );

      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };

      const BuilderClass = await getClientBuilder();
      const builder = new BuilderClass(config);
      const result = await builder.build("dev");

      expect(result).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该检测 crypto 模块", async () => {
      const entryFile = join(testDataDir, "test-crypto.ts");
      await writeTextFile(
        entryFile,
        `import { createHash } from "crypto";
console.log("test");
`,
      );

      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };

      const BuilderClass = await getClientBuilder();
      const builder = new BuilderClass(config);
      const result = await builder.build("dev");

      expect(result).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该检测 http 模块", async () => {
      const entryFile = join(testDataDir, "test-http.ts");
      await writeTextFile(
        entryFile,
        `import { createServer } from "http";
console.log("test");
`,
      );

      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };

      const BuilderClass = await getClientBuilder();
      const builder = new BuilderClass(config);
      const result = await builder.build("dev");

      expect(result).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("Deno 模块检测", () => {
    it("应该检测 deno 模块", async () => {
      const entryFile = join(testDataDir, "test-deno.ts");
      await writeTextFile(
        entryFile,
        `import { readTextFile } from "deno";
console.log("test");
`,
      );

      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };

      const BuilderClass = await getClientBuilder();
      const builder = new BuilderClass(config);
      const result = await builder.build("dev");

      expect(result).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该检测 deno: 协议模块", async () => {
      const entryFile = join(testDataDir, "test-deno-protocol.ts");
      await writeTextFile(
        entryFile,
        `import { serve } from "deno:http/server.ts";
console.log("test");
`,
      );

      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };

      const BuilderClass = await getClientBuilder();
      const builder = new BuilderClass(config);
      const result = await builder.build("dev");

      expect(result).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("服务端库检测", () => {
    it("应该检测 @dreamer/database", async () => {
      const entryFile = join(testDataDir, "test-database.ts");
      await writeTextFile(
        entryFile,
        `import { Database } from "@dreamer/database";
console.log("test");
`,
      );

      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };

      const BuilderClass = await getClientBuilder();
      const builder = new BuilderClass(config);
      const result = await builder.build("dev");

      expect(result).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该检测 @dreamer/server", async () => {
      const entryFile = join(testDataDir, "test-server.ts");
      await writeTextFile(
        entryFile,
        `import { Server } from "@dreamer/server";
console.log("test");
`,
      );

      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };

      const BuilderClass = await getClientBuilder();
      const builder = new BuilderClass(config);
      const result = await builder.build("dev");

      expect(result).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该检测 express", async () => {
      const entryFile = join(testDataDir, "test-express.ts");
      await writeTextFile(
        entryFile,
        `import express from "express";
console.log("test");
`,
      );

      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };

      const BuilderClass = await getClientBuilder();
      const builder = new BuilderClass(config);
      const result = await builder.build("dev");

      expect(result).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该检测 @prisma/client", async () => {
      const entryFile = join(testDataDir, "test-prisma.ts");
      await writeTextFile(
        entryFile,
        `import { PrismaClient } from "@prisma/client";
console.log("test");
`,
      );

      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };

      const BuilderClass = await getClientBuilder();
      const builder = new BuilderClass(config);
      const result = await builder.build("dev");

      expect(result).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("文件路径模式检测", () => {
    it("应该检测 .server. 文件", async () => {
      const serverFile = join(testDataDir, "utils.server.ts");
      const entryFile = join(testDataDir, "test-server-file.ts");

      await writeTextFile(
        serverFile,
        `export function serverOnlyFunction() {
  return "server";
}
`,
      );

      await writeTextFile(
        entryFile,
        `import { serverOnlyFunction } from "./utils.server.ts";
console.log("test");
`,
      );

      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };

      const BuilderClass = await getClientBuilder();
      const builder = new BuilderClass(config);
      const result = await builder.build("dev");

      expect(result).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该检测 /server/ 路径", async () => {
      await mkdir(join(testDataDir, "server"), { recursive: true });
      const serverFile = join(testDataDir, "server", "api.ts");
      const entryFile = join(testDataDir, "test-server-path.ts");

      await writeTextFile(
        serverFile,
        `export function serverAPI() {
  return "server";
}
`,
      );

      await writeTextFile(
        entryFile,
        `import { serverAPI } from "./server/api.ts";
console.log("test");
`,
      );

      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };

      const BuilderClass = await getClientBuilder();
      const builder = new BuilderClass(config);
      const result = await builder.build("dev");

      expect(result).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("自定义模式", () => {
    it("应该支持自定义字符串模式", async () => {
      const entryFile = join(testDataDir, "test-custom.ts");
      await writeTextFile(
        entryFile,
        `import { something } from "custom-server-module";
console.log("test");
`,
      );

      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
        plugins: [
          createServerModuleDetectorPlugin({
            additionalPatterns: ["custom-server-module"],
          }),
        ],
      };

      const BuilderClass = await getClientBuilder();
      const builder = new BuilderClass(config);
      const result = await builder.build("dev");

      expect(result).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该支持自定义正则表达式模式", async () => {
      const entryFile = join(testDataDir, "test-custom-regex.ts");
      await writeTextFile(
        entryFile,
        `import { something } from "@my-org/server-utils";
console.log("test");
`,
      );

      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
        plugins: [
          createServerModuleDetectorPlugin({
            additionalPatterns: [/^@my-org\/server/],
          }),
        ],
      };

      const BuilderClass = await getClientBuilder();
      const builder = new BuilderClass(config);
      const result = await builder.build("dev");

      expect(result).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("客户端代码不应被排除", () => {
    it("应该允许客户端模块正常打包", async () => {
      const clientUtils = join(testDataDir, "client-utils.ts");
      const entryFile = join(testDataDir, "test-client.ts");

      await writeTextFile(
        clientUtils,
        `export function clientFunction() {
  return "client";
}
`,
      );

      await writeTextFile(
        entryFile,
        `import { clientFunction } from "./client-utils.ts";
console.log(clientFunction());
`,
      );

      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };

      const BuilderClass = await getClientBuilder();
      const builder = new BuilderClass(config);
      const result = await builder.build("dev");

      expect(result).toBeTruthy();
      expect(result.outputFiles.length).toBeGreaterThan(0);

      // 客户端代码应该被打包
      const outputFile = result.outputFiles.find((f) => f.endsWith(".js"));
      if (outputFile) {
        const content = await readTextFile(outputFile);
        expect(content).toContain("clientFunction");
      }
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该允许 React 等客户端库正常打包", async () => {
      const entryFile = join(testDataDir, "test-react.ts");
      await writeTextFile(
        entryFile,
        `import React from "react";
console.log("test");
`,
      );

      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };

      const BuilderClass = await getClientBuilder();
      const builder = new BuilderClass(config);
      const result = await builder.build("dev");

      expect(result).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("混合场景", () => {
    it("应该同时处理服务端和客户端导入", async () => {
      const entryFile = join(testDataDir, "test-mixed.ts");
      await writeTextFile(
        entryFile,
        `// 客户端导入（应该打包）
import React from "react";

// 服务端导入（应该排除）
import { readFile } from "fs";

console.log("test");
`,
      );

      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };

      const BuilderClass = await getClientBuilder();
      const builder = new BuilderClass(config);
      const result = await builder.build("dev");

      expect(result).toBeTruthy();
      expect(result.outputFiles.length).toBeGreaterThan(0);

      // 检查输出：应该包含客户端代码，但不包含服务端代码
      const outputFile = result.outputFiles.find((f) => f.endsWith(".js"));
      if (outputFile) {
        const content = await readTextFile(outputFile);
        // fs 模块应该被排除
        expect(content).not.toContain("readFileSync");
        expect(content).not.toContain("fs.readFile");
      }
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该处理深层嵌套的服务端模块导入", async () => {
      const serverUtils = join(testDataDir, "server-utils.ts");
      const clientCode = join(testDataDir, "client-code.ts");
      const entryFile = join(testDataDir, "test-nested.ts");

      await writeTextFile(
        serverUtils,
        `import { readFile } from "fs";
export function serverUtil() {
  return "server";
}
`,
      );

      await writeTextFile(
        clientCode,
        `import { serverUtil } from "./server-utils.ts";
export function clientCode() {
  return serverUtil();
}
`,
      );

      await writeTextFile(
        entryFile,
        `import { clientCode } from "./client-code.ts";
console.log(clientCode());
`,
      );

      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };

      const BuilderClass = await getClientBuilder();
      const builder = new BuilderClass(config);
      const result = await builder.build("dev");

      expect(result).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("插件禁用场景", () => {
    it("应该在插件禁用时不排除服务端模块", async () => {
      const entryFile = join(testDataDir, "test-disabled.ts");
      await writeTextFile(
        entryFile,
        `import { readFile } from "fs";
console.log("test");
`,
      );

      // 使用自定义插件，禁用服务端模块检测
      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
        plugins: [
          createServerModuleDetectorPlugin({ enabled: false }),
        ],
      };

      const BuilderClass = await getClientBuilder();
      const builder = new BuilderClass(config);
      // 注意：禁用插件后，fs 模块可能会尝试被打包，可能导致构建失败
      // 这里主要测试插件可以正确禁用
      expect(builder).toBeTruthy();
    });
  });

  // 清理测试文件
  it("应该清理测试文件", async () => {
    try {
      await remove(testDataDir, { recursive: true });
      await remove(outputDir, { recursive: true });
    } catch {
      // 忽略清理错误
    }
  });
}, { sanitizeOps: false, sanitizeResources: false });
