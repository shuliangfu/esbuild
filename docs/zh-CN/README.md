# @dreamer/esbuild

> 兼容 Deno 和 Bun
> 的高性能构建工具包，提供全栈编译、打包、资源处理、优化等功能，支持子路径按需导入

本包是 [@dreamer/dweb](https://jsr.io/@dreamer/dweb)
框架的核心构建引擎，也可独立用于任意 Deno/Bun 项目的构建。

[![JSR](https://jsr.io/badges/@dreamer/esbuild)](https://jsr.io/@dreamer/esbuild)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-Deno%20571%20%7C%20Bun%20509%20passed-brightgreen)](./TEST_REPORT.md)

[English](../../README.md) | 中文 (Chinese)

---

## 📑 目录

- [功能](#-功能)
- [安装](#-安装)
- [特性](#-特性)
- [使用场景](#-使用场景)
- [快速开始](#-快速开始)
- [使用示例](#-使用示例)
- [API 文档](#-api-文档)
- [国际化（i18n）](#-国际化i18n)
- [高级配置](#-高级配置)
- [编译方式](#️-编译方式)
- [测试报告](#-测试报告)
- [注意事项](#-注意事项)

---

## 🎯 功能

构建工具包，提供统一的构建接口，支持服务端和客户端代码的编译、打包、优化等功能。基于
esbuild 实现高性能打包，支持 TypeScript、JSX、代码分割、Tree-shaking
等现代构建特性。

**架构优化**：

- **子路径导出**：`/builder`、`/client`、`/server`、`/bundle`、`/css-injector`
  按需导入，减少打包体积
- **延迟初始化**：BuildAnalyzer、CacheManager 在首次 `build()` 时创建，避免
  dev/build 时额外加载
- **Tree-shaking 友好**：子路径导出使按需加载成为可能

---

## 📦 安装

### Deno

```bash
deno add jsr:@dreamer/esbuild
```

### Bun

```bash
bunx jsr add -D @dreamer/esbuild
```

### 按需导入（子路径）

为减少打包体积、提升 Tree-shaking 效果，可按需从子路径导入：

| 子路径                              | 导出内容                                                                                          | 适用场景                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `jsr:@dreamer/esbuild/builder`      | Builder、AssetsProcessor、createBuilder、BuilderConfig                                            | 全栈构建、资源处理                 |
| `jsr:@dreamer/esbuild/client`       | BuilderClient、ClientBuildOptions                                                                 | 仅客户端打包                       |
| `jsr:@dreamer/esbuild/server`       | BuilderServer、ServerBuildOptions                                                                 | 仅服务端编译                       |
| `jsr:@dreamer/esbuild/bundle`       | buildBundle、BuilderBundle、BundleOptions、BundleResult                                           | 快速打包、测试、SSR                |
| `jsr:@dreamer/esbuild/css-injector` | generateCSSTag、generateCSSTags、injectCSSIntoHTML、injectCSSFromDependencies、getCSSRelativePath | extract 模式下将 CSS 路径注入 HTML |

```typescript
// 仅需 Builder、AssetsProcessor 时
import {
  AssetsProcessor,
  Builder,
  createBuilder,
} from "jsr:@dreamer/esbuild/builder";

// 仅需客户端构建时
import { BuilderClient } from "jsr:@dreamer/esbuild/client";

// 仅需服务端构建时
import { BuilderServer } from "jsr:@dreamer/esbuild/server";

// 仅需 buildBundle 时（测试、SSR 等）
import { buildBundle } from "jsr:@dreamer/esbuild/bundle";

// 仅需 CSS 注入工具时（extract 模式 + 手动注入 HTML）
import { injectCSSIntoHTML } from "jsr:@dreamer/esbuild/css-injector";
```

---

## 🌍 环境兼容性

| 环境       | 版本要求 | 状态                                  |
| ---------- | -------- | ------------------------------------- |
| **Deno**   | 2.5.0+   | ✅ 完全支持                           |
| **Bun**    | 1.3.0+   | ✅ 完全支持                           |
| **服务端** | -        | ✅ 支持（兼容 Deno 和 Bun 运行时）    |
| **客户端** | -        | ❌ 不支持（构建工具，仅在服务端运行） |

---

## ✨ 特性

- **服务端编译**：
  - 服务端代码编译和打包（基于 `@dreamer/runtime-adapter`）
  - TypeScript 编译（Deno/Bun 内置）
  - 代码压缩和优化
  - 单文件打包（standalone）
  - 多平台编译（Linux、macOS、Windows）
  - **内存模式**：支持 `write: false` 直接返回编译代码，不写入文件
  - **外部依赖**：支持 `external` 配置排除指定依赖不打包
  - **原生编译**：支持 `useNativeCompile` 使用 `deno compile` 或
    `bun build --compile` 生成可执行文件
- **客户端打包**：
  - 基于 esbuild 高性能打包
  - 入口文件打包（entry point → bundle.js）
  - 代码分割（路由级别、组件级别）
  - Tree-shaking（移除未使用的代码）
  - 多种输出格式（ESM、CJS、IIFE）
  - **内存模式**：支持 `write: false` 直接返回编译代码，不写入文件
- **HTML 生成**：
  - 自动生成 HTML 入口文件
  - 自动注入打包后的 JS/CSS 文件
  - 支持自定义 HTML 模板
  - 支持预加载策略配置
  - 支持多入口 HTML（MPA 多页应用）
- **CSS 处理**：
  - CSS 提取和优化
  - 自动添加浏览器前缀（autoprefixer）
  - CSS 压缩（cssnano）
  - 自动注入 CSS 到 HTML
- **构建优化**：
  - 构建缓存管理
  - 增量编译
  - Watch 模式
  - 构建产物分析
  - 性能监控和报告
- **插件系统**：
  - 灵活的插件架构
  - 服务端模块自动检测和排除
  - 条件编译支持
  - 自定义构建逻辑
- **路径解析**：
  - 自动解析相对路径、npm 包、JSR 包
  - 支持路径别名（`@/`, `~/` 等）
  - Deno 环境：支持 `deno.json` 的 `imports` 配置
  - Bun 环境：支持 `package.json` 的 `imports` 和 `tsconfig.json` 的 `paths`
    配置
- **静态资源处理（AssetsProcessor）**：
  - 复制 `public/` 到输出目录，支持 `exclude` 排除
  - 图片压缩、格式转换（webp/avif/original）、content hash
  - 图片质量参数 `quality`（0-100）
  - 自动更新 HTML/CSS/JS 中的资源引用路径
  - 生成 `asset-manifest.json` 供 SSR 运行时替换路径
  - `pathUpdateDirs` 支持 SSR 场景下更新服务端 bundle 中的路径

---

## 🎯 使用场景

- **全栈项目构建**：同时构建服务端和客户端代码
- **前端项目构建**：React、Preact 应用打包
- **SPA 单页应用**：客户端渲染（CSR）项目构建
- **SSR/Hybrid/SSG**：与 @dreamer/dweb 集成，asset-manifest
  支持生产模式资源路径替换
- **多平台应用打包**：支持 Linux、macOS、Windows
- **服务端渲染**：使用内存模式获取编译代码用于 SSR
- **CI/CD 构建流程**：自动化构建和部署

### 与 @dreamer/dweb 集成

本包是 [@dreamer/dweb](https://jsr.io/@dreamer/dweb) 的核心构建引擎。dweb 的
`deno task build` 内部调用 `Builder.build()`，完成服务端 + 客户端 +
资源处理。生产模式下，dweb 使用 `asset-manifest.json` 在 SSR/Hybrid/SSG 输出
HTML 前替换资源路径。

---

## 🚀 快速开始

### 基础使用

```typescript
import { createBuilder } from "@dreamer/esbuild";

// 创建构建器
const builder = createBuilder({
  // 客户端构建配置
  client: {
    entry: "./src/client/index.tsx",
    output: "./dist/client",
    engine: "react",
    bundle: {
      minify: true,
      sourcemap: true,
      splitting: true,
    },
    html: {
      title: "My App",
    },
  },
});

// 构建客户端
await builder.buildClient();
```

### 全栈项目构建

```typescript
import { createBuilder } from "@dreamer/esbuild";

const builder = createBuilder({
  // 服务端构建配置
  server: {
    entry: "./src/server.ts",
    output: "./dist/server",
    target: "deno",
    compile: {
      minify: true,
      platform: ["linux", "darwin"],
    },
  },
  // 客户端构建配置
  client: {
    entry: "./src/client/index.tsx",
    output: "./dist/client",
    engine: "react",
    bundle: {
      minify: true,
      sourcemap: true,
    },
  },
});

// 同时构建服务端和客户端
await builder.build();
```

---

## 🎨 使用示例

### 示例 1：客户端构建（内存模式）

使用 `write: false`
参数，可以直接获取编译后的代码而不写入文件，适用于服务端渲染等场景。

```typescript
import { BuilderClient } from "@dreamer/esbuild";

const builder = new BuilderClient({
  entry: "./src/client/mod.ts",
  output: "./dist",
  engine: "react",
});

// 内存模式：不写入文件，直接返回编译代码
const result = await builder.build({ mode: "prod", write: false });

// 获取编译后的代码
const code = result.outputContents?.[0]?.text;
console.log(code);
```

### 示例 2：服务端构建（内存模式）

```typescript
import { BuilderServer } from "@dreamer/esbuild";

const builder = new BuilderServer({
  entry: "./src/server.ts",
  output: "./dist/server",
  target: "deno",
});

// 内存模式：返回编译后的代码
const result = await builder.build({ mode: "prod", write: false });

// 获取编译后的代码
const code = result.outputContents?.[0]?.text;
console.log(code);
```

### 示例 3：增量构建（Watch 模式）

```typescript
import { createBuilder } from "@dreamer/esbuild";

const builder = createBuilder({
  client: {
    entry: "./src/client/index.tsx",
    output: "./dist/client",
    engine: "react",
  },
  build: {
    watch: {
      enabled: true,
      debounce: 300,
      onFileChange: (path, kind) => {
        console.log(`文件变化: ${path} (${kind})`);
      },
    },
  },
});

// 启动 Watch 模式
await builder.watch();

// 停止 Watch 模式
builder.stopWatch();
```

### 示例 4：构建产物分析

```typescript
import { BuildAnalyzer, createBuilder } from "@dreamer/esbuild";

const builder = createBuilder({
  client: {
    entry: "./src/client/index.tsx",
    output: "./dist/client",
    engine: "react",
  },
});

const result = await builder.buildClient();

// 分析构建产物
const analyzer = new BuildAnalyzer();
const analysis = await analyzer.analyze(result.metafile);

// 生成分析报告
const report = analyzer.generateReport(analysis);
console.log(report);

// 生成 HTML 报告
await analyzer.generateHTMLReport(analysis, "./dist/build-report.html");
```

### 示例 5：使用插件

```typescript
import {
  BuilderClient,
  createServerModuleDetectorPlugin,
} from "@dreamer/esbuild";

const builder = new BuilderClient({
  entry: "./src/client/index.tsx",
  output: "./dist/client",
  engine: "react",
  plugins: [
    // 自动排除服务端模块
    createServerModuleDetectorPlugin({
      patterns: ["@dreamer/database", "express"],
    }),
  ],
});

await builder.build("prod");
```

### 示例 6：路径别名配置

#### Deno 环境（deno.json）

```json
{
  "imports": {
    "@/": "./src/",
    "~/": "./",
    "@dreamer/logger": "jsr:@dreamer/logger@^1.0.0-beta.7"
  }
}
```

```typescript
// src/client/index.tsx
import { logger } from "@/utils/logger.ts";
import { config } from "~/config.ts";
import { log } from "@dreamer/logger/client";
```

#### Bun 环境（package.json 或 tsconfig.json）

**方式 1：使用 package.json**

```json
{
  "imports": {
    "@/": "./src/",
    "~/": "./"
  }
}
```

**方式 2：使用 tsconfig.json**

```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"],
      "~/*": ["./*"]
    }
  }
}
```

```typescript
// src/client/index.tsx
import { logger } from "@/utils/logger.ts";
import { config } from "~/config.ts";
```

路径解析会自动处理这些别名，无需额外配置。

---

## 📚 API 文档

### Builder

统一的构建器，支持同时构建服务端和客户端代码。

```typescript
import { Builder, createBuilder } from "@dreamer/esbuild";

const builder = createBuilder(config);
```

#### 方法

| 方法                    | 说明                   |
| ----------------------- | ---------------------- |
| `build(options?)`       | 同时构建服务端和客户端 |
| `buildServer(options?)` | 仅构建服务端代码       |
| `buildClient(options?)` | 仅构建客户端代码       |
| `clean()`               | 清理构建产物           |
| `watch(options?)`       | 启动 Watch 模式        |
| `stopWatch()`           | 停止 Watch 模式        |

### BuilderClient

客户端构建器，用于打包客户端代码。

```typescript
import { BuilderClient } from "@dreamer/esbuild";

const builder = new BuilderClient(config);
```

#### 构造函数

```typescript
new BuilderClient(config: ClientConfig)
```

**ClientConfig 调试与日志**：

- `debug?: boolean`：是否启用调试日志（默认：false），开启后输出 resolver/build
  等详细调试信息。
- `logger?: BuildLogger`：日志实例（未传时使用包内默认 logger），info/debug
  均通过 logger 输出，不使用 console。
- `lang?: "en-US" | "zh-CN"`：错误信息、日志与报告的语言（默认：由环境变量
  `LANGUAGE` / `LC_ALL` / `LANG` 自动检测）。

**ClientConfig.cssImport**（CSS 导入处理）：

- `enabled?: boolean`：是否启用（默认：true）
- `extract?: boolean`：是否提取为独立文件（默认：false，内联进 JS）。true
  时需配合 css-injector 手动注入 HTML
- `cssOnly?: boolean`：内联模式仅处理 .css（scss/sass/less
  需预处理器，默认：true）

#### 方法

| 方法                     | 说明                                        |
| ------------------------ | ------------------------------------------- |
| `build(options?)`        | 构建客户端代码，支持 `{ mode, write }` 参数 |
| `createContext(mode?)`   | 创建增量构建上下文                          |
| `rebuild()`              | 增量重新构建                                |
| `dispose()`              | 清理构建上下文                              |
| `registerPlugin(plugin)` | 注册插件                                    |
| `getPluginManager()`     | 获取插件管理器                              |
| `getConfig()`            | 获取配置                                    |

#### ClientBuildOptions

```typescript
interface ClientBuildOptions {
  /** 构建模式（默认：prod） */
  mode?: "dev" | "prod";
  /** 是否写入文件（默认：true），设为 false 返回编译代码 */
  write?: boolean;
}
```

### BuilderServer

服务端构建器，用于编译服务端代码。

```typescript
import { BuilderServer } from "@dreamer/esbuild";

const builder = new BuilderServer(config);
```

#### 构造函数

```typescript
new BuilderServer(config: ServerConfig)
```

#### 方法

| 方法              | 说明                                                    |
| ----------------- | ------------------------------------------------------- |
| `build(options?)` | 构建服务端代码，支持 `{ mode, write }` 参数或字符串模式 |
| `getConfig()`     | 获取配置                                                |

#### ServerBuildOptions

```typescript
interface ServerBuildOptions {
  /** 构建模式（默认：prod） */
  mode?: "dev" | "prod";
  /** 是否写入文件（默认：true），设为 false 返回编译代码 */
  write?: boolean;
}
```

#### ServerConfig 高级选项

```typescript
interface ServerConfig {
  /** 入口文件路径 */
  entry: string;
  /** 输出目录 */
  output: string;
  /** 目标运行时（默认：deno） */
  target?: "deno" | "bun";
  /** 外部依赖（不打包），支持通配符 */
  external?: string[];
  /** 使用原生编译器生成可执行文件（Deno: deno compile, Bun: bun build --compile） */
  useNativeCompile?: boolean;
  /** 是否启用调试日志（默认：false），开启后输出 resolver/build 等详细调试信息，便于排查 */
  debug?: boolean;
  /** 日志实例（未传时使用包内默认 logger），info/debug 均通过 logger 输出，不使用 console */
  logger?: BuildLogger;
  /** 错误信息与日志的语言（默认：由环境变量自动检测）。使用 createBuilder 时可传入并透传给 client/server */
  lang?: "en-US" | "zh-CN";
  // ... 其他配置
}
```

**示例：排除外部依赖**

```typescript
const builder = new BuilderServer({
  entry: "./src/server.ts",
  output: "./dist/server",
  target: "deno",
  external: [
    "better-sqlite3", // 排除原生模块
    "@prisma/*", // 通配符排除
    "node:*", // 排除所有 Node.js 内置模块
  ],
});
```

**示例：生成可执行文件**

```typescript
const builder = new BuilderServer({
  entry: "./src/server.ts",
  output: "./dist/server",
  target: "deno",
  useNativeCompile: true, // 使用 deno compile 或 bun build --compile
});

await builder.build("prod");
// Deno 环境：生成 ./dist/server (可执行文件)
// Bun 环境：生成 ./dist/server (可执行文件)
```

### BuilderBundle

简单打包器，用于快速将代码打包为浏览器可用格式。适用于浏览器测试、服务端渲染等场景。

```typescript
import { buildBundle, BuilderBundle } from "@dreamer/esbuild";

// 使用类
const bundler = new BuilderBundle();
const result = await bundler.build({
  entryPoint: "./src/client/mod.ts",
  globalName: "MyClient",
});

// 使用函数
const result = await buildBundle({
  entryPoint: "./src/client/mod.ts",
  format: "esm",
  minify: true,
});
```

#### 方法

| 方法             | 说明                   |
| ---------------- | ---------------------- |
| `build(options)` | 打包代码，返回打包结果 |

#### BundleOptions

```typescript
interface BundleOptions {
  /** 入口文件路径 */
  entryPoint: string;
  /** 全局变量名（IIFE 格式时使用） */
  globalName?: string;
  /** 目标平台（默认：browser） */
  platform?: "browser" | "node" | "neutral";
  /** 目标 ES 版本（默认：es2020） */
  target?: string | string[];
  /** 是否压缩（默认：false） */
  minify?: boolean;
  /** 输出格式（默认：iife） */
  format?: "iife" | "esm" | "cjs";
  /** 是否生成 sourcemap（默认：false） */
  sourcemap?: boolean;
  /** 外部依赖（不打包） */
  external?: string[];
  /** 定义替换 */
  define?: Record<string, string>;
  /** 是否打包依赖（默认：true） */
  bundle?: boolean;
  /** 是否启用调试日志（默认：false），开启后输出 resolver/build 等详细调试信息 */
  debug?: boolean;
  /** 日志实例（未传时使用包内默认 logger），info/debug 均通过 logger 输出，不使用 console */
  logger?: BuildLogger;
}
```

#### BundleResult

```typescript
interface BundleResult {
  /** 打包后的代码 */
  code: string;
  /** Source Map（如果启用） */
  map?: string;
}
```

### AssetsProcessor

静态资源处理器，负责复制、图片处理、路径更新、生成 asset-manifest。

```typescript
import { AssetsProcessor } from "jsr:@dreamer/esbuild/builder";

const config = {
  publicDir: "./public",
  assetsDir: "assets",
  images: { compress: true, format: "webp", hash: true, quality: 80 },
};
const processor = new AssetsProcessor(
  config,
  "./dist/client",
  ["./dist/server"], // 可选，SSR 场景下需更新的额外目录
);
await processor.processAssets();
```

#### AssetsConfig

```typescript
interface AssetsConfig {
  /** 静态资源目录 */
  publicDir?: string;
  /** 资源输出目录（默认：assets） */
  assetsDir?: string;
  /** 复制时排除的文件，如 ["tailwind.css", "uno.css"] */
  exclude?: string[];
  /** 图片处理（需 @dreamer/image） */
  images?: {
    compress?: boolean;
    format?: "webp" | "avif" | "original";
    hash?: boolean;
    quality?: number; // 0-100，默认 80（有损）或 100（PNG/GIF 无损）
  };
}
```

**输出**：`outputDir/asset-manifest.json`，格式
`{ "/assets/原路径": "/assets/带hash新路径" }`，供 SSR 框架替换 HTML
中的资源路径。

### BuildResult

构建结果类型。

```typescript
interface BuildResult {
  /** 输出文件列表（文件路径） */
  outputFiles: string[];
  /** 输出文件内容列表（当 write 为 false 时有值） */
  outputContents?: OutputFileContent[];
  /** 构建元数据 */
  metafile?: unknown;
  /** 构建时间（毫秒） */
  duration: number;
}

interface OutputFileContent {
  /** 文件路径 */
  path: string;
  /** 文件内容（字符串格式） */
  text: string;
  /** 文件内容（二进制格式） */
  contents: Uint8Array;
}
```

---

## 🌐 国际化（i18n）

错误信息、构建日志与分析报告支持多语言。通过 **lang** 选项指定语言：

- **lang**（`"en-US" | "zh-CN"`，可选）：指定后覆盖默认行为（默认由环境变量
  `LANGUAGE` / `LC_ALL` / `LANG` 自动检测）。对 Builder、BuilderClient、
  BuilderServer、BuildAnalyzer 均生效。可在 `createBuilder(config)` 顶层传入
  `lang`，或在 `client` / `server` 配置中单独指定。

**示例**：

```typescript
const builder = createBuilder({
  lang: "en-US", // 或 "zh-CN"
  client: {
    entry: "./src/client/index.tsx",
    output: "./dist/client",
    engine: "react",
  },
});
```

---

## 🔧 调试与日志

服务端/客户端构建与简单打包均支持 **debug** 和 **logger**
参数，便于排查构建与解析问题：

- **debug**（`boolean`，默认 `false`）：设为 `true` 时输出 resolver、build
  等详细调试信息。
- **logger**（`BuildLogger`，可选）：日志实例；未传时使用包内默认 logger。所有
  info/debug 输出均通过 logger，不使用 `console`。

**示例**：

```typescript
import { createLogger } from "@dreamer/logger";
import { buildBundle, BuilderClient, BuilderServer } from "@dreamer/esbuild";

const logger = createLogger({ level: "debug", format: "text" });

// 服务端构建：开启调试并传入自定义 logger
const serverBuilder = new BuilderServer({
  entry: "./src/server.ts",
  output: "./dist",
  debug: true,
  logger,
});

// 客户端构建：同上
const clientBuilder = new BuilderClient({
  entry: "./src/client/index.tsx",
  output: "./dist/client",
  engine: "react",
  debug: true,
  logger,
});

// 简单打包：BundleOptions 同样支持 debug、logger
const result = await buildBundle({
  entryPoint: "./src/client/mod.ts",
  format: "esm",
  debug: true,
  logger,
});
```

---

## 🔧 高级配置

### 代码分割策略

```typescript
const builder = new BuilderClient({
  entry: "./src/client/index.tsx",
  output: "./dist/client",
  engine: "react",
  bundle: {
    splitting: {
      enabled: true,
      byRoute: true, // 按路由分割
      byComponent: true, // 按组件分割
      bySize: 50000, // 按大小分割（50KB）
    },
  },
});
```

### Source Map 配置

```typescript
const builder = new BuilderClient({
  entry: "./src/client/index.tsx",
  output: "./dist/client",
  engine: "react",
  sourcemap: {
    enabled: true,
    mode: "external", // "inline" | "external" | "both"
  },
});
```

### 缓存配置

```typescript
const builder = createBuilder({
  client: {
    entry: "./src/client/index.tsx",
    output: "./dist/client",
    engine: "react",
  },
  build: {
    cache: true, // 或指定缓存目录: "./cache"
  },
});
```

### 静态资源与 asset-manifest

配置 `assets` 后，Builder 会在构建时调用 `AssetsProcessor` 处理静态资源，并生成
`asset-manifest.json`。

```typescript
const builder = createBuilder({
  client: {
    entry: "./src/client/index.tsx",
    output: "./dist/client",
    engine: "react",
  },
  server: {
    entry: "./src/server.ts",
    output: "./dist/server",
  },
  assets: {
    publicDir: "./public",
    assetsDir: "assets",
    exclude: ["tailwind.css", "uno.css"], // 排除会被其他插件编译的源文件
    images: {
      compress: true,
      format: "webp", // "webp" | "avif" | "original"
      hash: true, // 文件名加 content hash，用于缓存失效
      quality: 80, // 0-100，JPEG/WebP/AVIF 默认 80，PNG/GIF 默认 100
    },
  },
});

await builder.build();
```

**流程**：

1. 复制 `public/` 到 `outputDir/assets/`（排除 `exclude` 配置的文件）
2. 图片压缩、格式转换、content hash
3. 更新 HTML/CSS/JS 中的资源引用路径
4. 生成
   `outputDir/asset-manifest.json`，格式：`{ "/assets/logo.png": "/assets/logo.abc12345.webp" }`

**SSR 场景**：当同时配置 `server` 时，`pathUpdateDirs` 会自动包含 server output
目录，确保服务端 bundle 中的资源路径也被更新。SSR 框架（如 dweb）可在输出 HTML
前用 manifest 替换路径。

### css-injector 使用场景

`css-injector` 适用于 **extract 模式**：将 CSS 提取为独立文件，再手动将 `<link>`
路径注入 HTML。

```typescript
import { injectCSSIntoHTML } from "jsr:@dreamer/esbuild/css-injector";

// 构建后得到 CSS 文件路径列表（如 createCSSImportHandlerPlugin extract 模式）
const cssFiles = ["dist/main.css", "dist/chunk-1.css"];

const html = `<!DOCTYPE html><html><head></head><body></body></html>`;
const htmlWithCss = injectCSSIntoHTML(html, cssFiles, {
  outputDir: "./dist",
  publicPath: "/assets/",
  dedupe: true,
});
```

**导出函数**：`generateCSSTag`、`generateCSSTags`、`injectCSSIntoHTML`、`injectCSSFromDependencies`、`getCSSRelativePath`。

**注意**：dweb 框架使用内联模式（`extract: false`），CSS 直接 `<style>`
注入，无需 css-injector。

---

## ⚙️ 编译方式

本包根据运行时环境自动选择最优的编译方式：

| 构建器                               | Deno 环境                 | Bun 环境                       |
| ------------------------------------ | ------------------------- | ------------------------------ |
| **BuilderClient**                    | esbuild + Deno 解析器插件 | esbuild + Bun 解析器插件       |
| **BuilderServer**                    | esbuild + Deno 解析器插件 | esbuild + Bun 解析器插件       |
| **BuilderServer** (useNativeCompile) | `deno compile` 原生编译   | `bun build --compile` 原生编译 |
| **BuilderBundle**                    | esbuild + Deno 解析器插件 | `bun build` 原生打包           |

### Deno 解析器插件

在 Deno 环境下，会自动启用 Deno 解析器插件（`denoResolverPlugin`），用于：

- 解析 `deno.json` 的 `imports` 配置（路径别名）
- 支持 JSR 包的导入（`jsr:` 协议）
- 支持 npm 包的导入（`npm:` 协议）
- 支持相对路径解析（`./`, `../`）
- 支持 JSR 包的子路径导出（如 `@dreamer/logger/client`）

### Bun 解析器插件

在 Bun 环境下，会自动启用 Bun 解析器插件（`bunResolverPlugin`），用于：

- 解析 `package.json` 的 `imports` 配置（路径别名）
- 解析 `tsconfig.json` 的 `paths` 配置（路径别名）
- 支持 npm 包的导入（`npm:` 协议）
- 支持 JSR 包的导入（`jsr:` 协议，Bun 原生支持）
- 支持相对路径解析（`./`, `../`）
- **不读取** `deno.json` 配置（Bun 环境专用）

### Bun 原生打包

`BuilderBundle` 在 Bun 环境下使用 `bun build`
原生命令进行打包，具有更快的编译速度。`BuilderClient` 和 `BuilderServer`
统一使用 esbuild + 解析器插件以保证跨平台一致性和功能完整性。

### 原生编译器（生成可执行文件）

当启用 `useNativeCompile` 选项时，`BuilderServer`
会使用平台原生编译器生成独立可执行文件：

| 运行时   | 编译命令                                             | 输出           |
| -------- | ---------------------------------------------------- | -------------- |
| **Deno** | `deno compile --allow-all --output <output> <entry>` | 独立可执行文件 |
| **Bun**  | `bun build --compile --outfile <output> <entry>`     | 独立可执行文件 |

**注意事项**：

- 原生编译会将所有依赖打包进可执行文件
- Deno 的 `deno compile` 不支持 `external` 选项，会输出警告
- Bun 的 `bun build --compile` 支持 `--external` 选项排除依赖

---

## 📊 测试报告

本包经过全面测试，所有测试用例均已通过，测试覆盖率达到 100%。详细测试报告请查看
[TEST_REPORT.md](./TEST_REPORT.md)。

**测试统计**：

| 运行时                | 测试数 | 通过 | 失败 | 通过率  |
| --------------------- | ------ | ---- | ---- | ------- |
| Deno (`deno test -A`) | 571    | 571  | 0    | 100% ✅ |
| Bun (`bun test`)      | 509    | 509  | 0    | 100% ✅ |

- **测试覆盖**: 所有公共 API、子路径导出、边界情况、错误处理
- **测试环境**: Deno 2.x, Bun 1.3.5
- **说明**: Bun 测试数较少，因为 `builder-server-bun.test.ts`（2 个用例）仅在
  Bun 下运行；部分测试依赖 Deno 特性，仅在 Deno 下运行

**测试类型**：

- ✅ 单元测试（约 440 个）
- ✅ 集成测试（约 30 个）
- ✅ 边界情况和错误处理测试（约 48 个）

**测试亮点**：

- ✅
  子路径导出测试（entry-builder、entry-client、entry-server、entry-bundle、css-injector）
- ✅ AssetsProcessor 高级功能（asset-manifest、quality、pathUpdateDirs）
- ✅ 所有功能、边界情况、错误处理都有完整的测试覆盖
- ✅ 集成测试验证了端到端的完整流程
- ✅ 内存模式（write: false）功能完整测试
- ✅ BuilderBundle 简单打包器完整测试（29 个）
  - ESM 和 IIFE 格式测试
  - 全局变量设置测试（window/global/globalThis）
  - 平台特定行为测试（browser/node/neutral）
- ✅ 路径解析功能测试（Deno 和 Bun 环境）
  - 解析器插件测试（18 个）+ 解析器高级测试（17 个）
  - 服务端构建器路径解析测试（5 个）
  - 服务端构建器 Bun 测试（2 个，仅 Bun）
  - 客户端构建器路径解析测试（6 个）
  - 客户端构建路径解析测试（6 个）
- ✅ 服务端构建器高级功能测试（19 个）
  - 外部依赖配置（external）测试
  - 原生编译器（useNativeCompile）测试
  - 多平台编译测试（Linux、macOS、Windows）

查看完整测试报告：[TEST_REPORT.md](./TEST_REPORT.md)

---

## 📝 注意事项

- **依赖要求**：需要安装 `npm:esbuild`、`@dreamer/runtime-adapter`；图片处理需
  `@dreamer/image`
- **运行环境**：构建工具仅在服务端运行，不能在浏览器中使用
- **内存模式**：使用 `write: false` 时，内存模式不支持代码分割（splitting）
- **平台编译**：服务端多平台编译需要对应平台的编译工具链
- **缓存管理**：生产环境建议启用构建缓存以提升性能
- **路径解析**：
  - Deno 环境：需要 `deno.json` 配置 `imports` 字段来使用路径别名
  - Bun 环境：可以使用 `package.json` 的 `imports` 或 `tsconfig.json` 的 `paths`
    来配置路径别名
  - Bun 环境不会读取 `deno.json` 配置

---

## 📦 依赖

| 依赖                                 | 用途                                              |
| ------------------------------------ | ------------------------------------------------- |
| `npm:esbuild`                        | 核心打包引擎                                      |
| `@dreamer/runtime-adapter`           | 跨运行时 API（Deno/Bun）                          |
| `@dreamer/image`                     | 图片压缩、格式转换（仅当配置 `assets.images` 时） |
| `postcss`、`autoprefixer`、`cssnano` | CSS 优化（仅当配置 CSS 处理时）                   |

---

## 📋 变更日志

**v1.0.28**（2026-02-18）

- **变更**：配置项用 `lang?: "en-US" | "zh-CN"` 替代 `t` 做国际化；文档补充 lang
  与国际化章节；删除 `docs/en-US/README.md`。
- **新增**：补全 i18n locale 键，替换 build-analyzer HTML 与 builder-server
  调试日志中的硬编码文案。

完整历史见 [CHANGELOG.md](./CHANGELOG.md)。

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

## 📄 许可证

Apache License 2.0 - 详见 [LICENSE](./LICENSE)

---

<div align="center">

**Made with ❤️ by Dreamer Team**

</div>
