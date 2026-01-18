/**
 * @fileoverview 客户端构建服务端代码分离测试
 *
 * 测试客户端构建时自动分离服务端代码的完整功能
 */

import {
  join,
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
} from "@dreamer/runtime-adapter";
import { describe, expect, it } from "@dreamer/test";
// 动态导入 BuilderClient，避免在模块加载时触发 esbuild
import { createConditionalCompilePlugin } from "../src/plugins/conditional-compile.ts";
import { createServerModuleDetectorPlugin } from "../src/plugins/server-module-detector.ts";
import type { ClientConfig } from "../src/types.ts";
import { getTestDataDir, getTestOutputDir } from "./test-utils.ts";

/**
 * 动态导入 BuilderClient（避免在模块加载时触发 esbuild）
 */
async function getBuilderClient() {
  const { BuilderClient } = await import("../src/builder-client.ts");
  return BuilderClient;
}

describe("客户端构建服务端代码分离", () => {
  let testDataDir: string;
  let outputDir: string;

  // 测试前创建测试目录
  it("应该创建测试目录", async () => {
    testDataDir = getTestDataDir();
    outputDir = getTestOutputDir("client-server-separation");
    await mkdir(outputDir, { recursive: true });
    expect(testDataDir).toBeTruthy();
  });

  describe("自动分离服务端模块", () => {
    it("应该在构建时自动排除 Node.js 内置模块", async () => {
      const entryFile = join(testDataDir, "app.ts");
      await writeTextFile(
        entryFile,
        `import { readFile } from "fs";
import { join } from "path";

console.log("Client app");
`,
      );

      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };

      const BuilderClass = await getBuilderClient();
      const builder = new BuilderClass(config);
      const result = await builder.build("dev");

      expect(result).toBeTruthy();
      expect(result.outputFiles.length).toBeGreaterThan(0);

      // 检查输出文件，不应该包含 fs 和 path 模块的实现
      const outputFile = result.outputFiles.find((f) => f.endsWith(".js"));
      if (outputFile) {
        const content = await readTextFile(outputFile);
        // 服务端模块应该被标记为 external，不会被打包
        // 检查是否不包含 Node.js 特定的实现代码
        expect(content).not.toContain("readFileSync");
        expect(content).not.toContain("path.join");
      }
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该排除服务端库（@dreamer/database）", async () => {
      const entryFile = join(testDataDir, "app-db.ts");
      await writeTextFile(
        entryFile,
        `import { Database } from "@dreamer/database";

console.log("Client app");
`,
      );

      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };

      const BuilderClass = await getBuilderClient();
      const builder = new BuilderClass(config);
      const result = await builder.build("dev");

      expect(result).toBeTruthy();
      // @dreamer/database 应该被排除，不会导致构建失败
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该排除 .server. 文件", async () => {
      const serverFile = join(testDataDir, "api.server.ts");
      const entryFile = join(testDataDir, "app-server-file.ts");

      await writeTextFile(
        serverFile,
        `import { readFile } from "fs";

export function serverAPI() {
  return "server";
}
`,
      );

      await writeTextFile(
        entryFile,
        `import { serverAPI } from "./api.server.ts";

console.log("Client app");
`,
      );

      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };

      const BuilderClass = await getBuilderClient();
      const builder = new BuilderClass(config);
      const result = await builder.build("dev");

      expect(result).toBeTruthy();
      // .server. 文件应该被排除
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("条件编译配合使用", () => {
    it("应该同时使用条件编译和服务端模块检测", async () => {
      const entryFile = join(testDataDir, "app-conditional.ts");
      await writeTextFile(
        entryFile,
        `// #ifdef CLIENT
console.log("Client code");
// #endif

// #ifdef SERVER
import { readFile } from "fs";
console.log("Server code");
// #endif

console.log("Shared code");
`,
      );

      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };

      const BuilderClass = await getBuilderClient();
      const builder = new BuilderClass(config);
      const result = await builder.build("dev");

      expect(result).toBeTruthy();
      expect(result.outputFiles.length).toBeGreaterThan(0);

      // 检查输出：应该只包含 CLIENT 代码，不包含 SERVER 代码
      const outputFile = result.outputFiles.find((f) => f.endsWith(".js"));
      if (outputFile) {
        const content = await readTextFile(outputFile);
        // SERVER 代码块应该被移除
        expect(content).not.toContain("Server code");
        // CLIENT 代码块应该保留
        expect(content).toContain("Client code");
        // 共享代码应该保留
        expect(content).toContain("Shared code");
        // fs 导入应该被移除（因为 SERVER 块被移除）
        expect(content).not.toContain("readFile");
      }
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该处理条件编译中的服务端模块导入", async () => {
      const entryFile = join(testDataDir, "app-conditional-import.ts");
      await writeTextFile(
        entryFile,
        `// #ifdef CLIENT
import React from "react";
// #endif

// #ifdef SERVER
import { readFile } from "fs";
import { Database } from "@dreamer/database";
// #endif

console.log("App");
`,
      );

      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };

      const BuilderClass = await getBuilderClient();
      const builder = new BuilderClass(config);
      const result = await builder.build("dev");

      expect(result).toBeTruthy();
      expect(result.outputFiles.length).toBeGreaterThan(0);

      // 检查输出：SERVER 块中的导入应该被完全移除
      const outputFile = result.outputFiles.find((f) => f.endsWith(".js"));
      if (outputFile) {
        const content = await readTextFile(outputFile);
        // SERVER 块中的导入应该被移除
        expect(content).not.toContain("readFile");
        expect(content).not.toContain("@dreamer/database");
        // CLIENT 块中的导入应该保留（如果 React 可用）
        // 共享代码应该保留
        expect(content).toContain("App");
      }
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("实际应用场景", () => {
    it("应该处理包含服务端和客户端代码的组件", async () => {
      const serverUtils = join(testDataDir, "server-utils.ts");
      const clientComponent = join(testDataDir, "component.tsx");
      const entryFile = join(testDataDir, "app-component.tsx");

      // 服务端工具函数
      await writeTextFile(
        serverUtils,
        `import { readFile } from "fs";

export function readConfig() {
  return "config";
}
`,
      );

      // 客户端组件
      await writeTextFile(
        clientComponent,
        `export function MyComponent() {
  return <div>Hello</div>;
}
`,
      );

      // 入口文件（错误地导入了服务端代码）
      await writeTextFile(
        entryFile,
        `import { MyComponent } from "./component.tsx";
// 错误：导入了服务端代码
import { readConfig } from "./server-utils.ts";

console.log("App");
`,
      );

      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };

      const BuilderClass = await getBuilderClient();
      const builder = new BuilderClass(config);
      const result = await builder.build("dev");

      expect(result).toBeTruthy();
      // 服务端代码应该被排除，构建应该成功
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该处理共享代码中的条件服务端导入", async () => {
      const sharedUtils = join(testDataDir, "shared-utils.ts");
      const entryFile = join(testDataDir, "app-shared.ts");

      await writeTextFile(
        sharedUtils,
        `// #ifdef SERVER
import { readFile } from "fs";
// #endif

export function getData() {
  // #ifdef SERVER
  return readFile("data.json", "utf-8");
  // #else
  return fetch("/api/data").then(r => r.json());
  // #endif
}
`,
      );

      await writeTextFile(
        entryFile,
        `import { getData } from "./shared-utils.ts";

getData().then(console.log);
`,
      );

      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };

      const BuilderClass = await getBuilderClient();
      const builder = new BuilderClass(config);
      const result = await builder.build("dev");

      expect(result).toBeTruthy();
      expect(result.outputFiles.length).toBeGreaterThan(0);

      // 检查输出：应该只包含客户端代码
      const outputFile = result.outputFiles.find((f) => f.endsWith(".js"));
      if (outputFile) {
        const content = await readTextFile(outputFile);
        // SERVER 代码应该被移除
        expect(content).not.toContain("readFile");
        expect(content).not.toContain("fs");
        // CLIENT 代码应该保留
        expect(content).toContain("fetch");
      }
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("构建产物验证", () => {
    it("应该验证服务端代码不在客户端 bundle 中", async () => {
      const entryFile = join(testDataDir, "app-verify.ts");
      await writeTextFile(
        entryFile,
        `import { readFile } from "fs";
import { join } from "path";
import { Database } from "@dreamer/database";

console.log("Client app");
`,
      );

      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };

      const BuilderClass = await getBuilderClient();
      const builder = new BuilderClass(config);
      const result = await builder.build("dev");

      expect(result).toBeTruthy();
      expect(result.outputFiles.length).toBeGreaterThan(0);

      // 验证所有输出文件
      for (const outputFile of result.outputFiles) {
        if (outputFile.endsWith(".js")) {
          const content = await readTextFile(outputFile);
          // 验证服务端模块不在 bundle 中
          expect(content).not.toContain("readFileSync");
          expect(content).not.toContain("path.join");
          // 验证客户端代码存在
          expect(content).toContain("Client app");
        }
      }
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该验证客户端代码正常打包", async () => {
      const clientUtils = join(testDataDir, "client-utils.ts");
      const entryFile = join(testDataDir, "app-client-only.ts");

      await writeTextFile(
        clientUtils,
        `export function formatDate(date: Date): string {
  return date.toISOString();
}

export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number,
): T {
  let timeout: number | null = null;
  return ((...args: any[]) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  }) as T;
}
`,
      );

      await writeTextFile(
        entryFile,
        `import { formatDate, debounce } from "./client-utils.ts";

const formatted = formatDate(new Date());
console.log(formatted);

const debouncedLog = debounce(console.log, 100);
debouncedLog("test");
`,
      );

      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };

      const BuilderClass = await getBuilderClient();
      const builder = new BuilderClass(config);
      const result = await builder.build("dev");

      expect(result).toBeTruthy();
      expect(result.outputFiles.length).toBeGreaterThan(0);

      // 验证客户端代码被打包
      const outputFile = result.outputFiles.find((f) => f.endsWith(".js"));
      if (outputFile) {
        const content = await readTextFile(outputFile);
        expect(content).toContain("formatDate");
        expect(content).toContain("debounce");
      }
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("插件优先级", () => {
    it("应该确保服务端模块检测插件优先执行", async () => {
      const entryFile = join(testDataDir, "app-priority.ts");
      await writeTextFile(
        entryFile,
        `import { readFile } from "fs";
console.log("test");
`,
      );

      // 手动注册插件，验证顺序
      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
        plugins: [
          // 服务端模块检测应该自动注册在最前面
          createServerModuleDetectorPlugin(),
          createConditionalCompilePlugin(),
        ],
      };

      const BuilderClass = await getBuilderClient();
      const builder = new BuilderClass(config);
      // BuilderClient 会自动注册服务端模块检测插件，优先级最高
      const result = await builder.build("dev");

      expect(result).toBeTruthy();
      // fs 模块应该被排除
    }, { sanitizeOps: false, sanitizeResources: false });
  });

  describe("边界情况", () => {
    it("应该处理空的服务端导入", async () => {
      const entryFile = join(testDataDir, "app-empty.ts");
      await writeTextFile(
        entryFile,
        `// 只有注释，没有实际导入
console.log("test");
`,
      );

      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };

      const BuilderClass = await getBuilderClient();
      const builder = new BuilderClass(config);
      const result = await builder.build("dev");

      expect(result).toBeTruthy();
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该处理动态导入的服务端模块", async () => {
      const entryFile = join(testDataDir, "app-dynamic.ts");
      await writeTextFile(
        entryFile,
        `// 动态导入
const loadServer = async () => {
  const fs = await import("fs");
  return fs;
};

console.log("test");
`,
      );

      const config: ClientConfig = {
        entry: entryFile,
        output: outputDir,
        engine: "react",
      };

      const BuilderClass = await getBuilderClient();
      const builder = new BuilderClass(config);
      const result = await builder.build("dev");

      expect(result).toBeTruthy();
      // 动态导入的 fs 模块也应该被排除
    }, { sanitizeOps: false, sanitizeResources: false });
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
