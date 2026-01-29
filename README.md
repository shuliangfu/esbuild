# @dreamer/esbuild

> 一个兼容 Deno 和 Bun 的构建工具库，提供服务端和客户端编译、打包、优化功能

[![JSR](https://jsr.io/badges/@dreamer/esbuild)](https://jsr.io/@dreamer/esbuild)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE.md)
[![Tests](https://img.shields.io/badge/tests-460%20(Bun)%20%7C%20469%20(Deno)%20passed-brightgreen)](./TEST_REPORT.md)

---

## 🎯 功能

构建工具库，提供统一的构建接口，支持服务端和客户端代码的编译、打包、优化等功能。基于 esbuild 实现高性能打包，支持 TypeScript、JSX、代码分割、Tree-shaking 等现代构建特性。

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

---

## 🌍 环境兼容性

| 环境 | 版本要求 | 状态 |
|------|---------|------|
| **Deno** | 2.5.0+ | ✅ 完全支持 |
| **Bun** | 1.3.0+ | ✅ 完全支持 |
| **服务端** | - | ✅ 支持（兼容 Deno 和 Bun 运行时） |
| **客户端** | - | ❌ 不支持（构建工具，仅在服务端运行） |

---

## ✨ 特性

- **服务端编译**：
  - 服务端代码编译和打包（基于 `@dreamer/runtime-adapter`）
  - TypeScript 编译（Deno/Bun 内置）
  - 代码压缩和优化
  - 单文件打包（standalone）
  - 多平台编译（Linux、macOS、Windows）
  - **内存模式**：支持 `write: false` 直接返回编译代码，不写入文件
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
  - Bun 环境：支持 `package.json` 的 `imports` 和 `tsconfig.json` 的 `paths` 配置

---

## 🎯 使用场景

- **全栈项目构建**：同时构建服务端和客户端代码
- **前端项目构建**：React、Preact、Vue3 应用打包
- **SPA 单页应用**：客户端渲染（CSR）项目构建
- **多平台应用打包**：支持 Linux、macOS、Windows
- **服务端渲染**：使用内存模式获取编译代码用于 SSR
- **CI/CD 构建流程**：自动化构建和部署

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

使用 `write: false` 参数，可以直接获取编译后的代码而不写入文件，适用于服务端渲染等场景。

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
import { createBuilder, BuildAnalyzer } from "@dreamer/esbuild";

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
import { BuilderClient, createServerModuleDetectorPlugin } from "@dreamer/esbuild";

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
    "@dreamer/logger": "jsr:@dreamer/logger@1.0.0-beta.7"
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

| 方法 | 说明 |
|------|------|
| `build(options?)` | 同时构建服务端和客户端 |
| `buildServer(options?)` | 仅构建服务端代码 |
| `buildClient(options?)` | 仅构建客户端代码 |
| `clean()` | 清理构建产物 |
| `watch(options?)` | 启动 Watch 模式 |
| `stopWatch()` | 停止 Watch 模式 |

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

#### 方法

| 方法 | 说明 |
|------|------|
| `build(options?)` | 构建客户端代码，支持 `{ mode, write }` 参数 |
| `createContext(mode?)` | 创建增量构建上下文 |
| `rebuild()` | 增量重新构建 |
| `dispose()` | 清理构建上下文 |
| `registerPlugin(plugin)` | 注册插件 |
| `getPluginManager()` | 获取插件管理器 |
| `getConfig()` | 获取配置 |

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

| 方法 | 说明 |
|------|------|
| `build(options?)` | 构建服务端代码，支持 `{ mode, write }` 参数或字符串模式 |
| `getConfig()` | 获取配置 |

#### ServerBuildOptions

```typescript
interface ServerBuildOptions {
  /** 构建模式（默认：prod） */
  mode?: "dev" | "prod";
  /** 是否写入文件（默认：true），设为 false 返回编译代码 */
  write?: boolean;
}
```

### BuilderBundle

简单打包器，用于快速将代码打包为浏览器可用格式。适用于浏览器测试、服务端渲染等场景。

```typescript
import { BuilderBundle, buildBundle } from "@dreamer/esbuild";

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

| 方法 | 说明 |
|------|------|
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
      byRoute: true,      // 按路由分割
      byComponent: true,  // 按组件分割
      bySize: 50000,      // 按大小分割（50KB）
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
    mode: "external",  // "inline" | "external" | "both"
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
    cache: true,  // 或指定缓存目录: "./cache"
  },
});
```

---

## ⚙️ 编译方式

本库根据运行时环境自动选择最优的编译方式：

| 构建器 | Deno 环境 | Bun 环境 |
|--------|-----------|----------|
| **BuilderClient** | esbuild + Deno 解析器插件 | esbuild + Bun 解析器插件 |
| **BuilderServer** | esbuild + Deno 解析器插件 | esbuild + Bun 解析器插件 |
| **BuilderBundle** | esbuild + Deno 解析器插件 | `bun build` 原生打包 |

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

`BuilderBundle` 在 Bun 环境下使用 `bun build` 原生命令进行打包，具有更快的编译速度。`BuilderClient` 和 `BuilderServer` 统一使用 esbuild + 解析器插件以保证跨平台一致性和功能完整性。

---

## 📊 测试报告

本库经过全面测试，所有测试用例均已通过，测试覆盖率达到 100%。详细测试报告请查看 [TEST_REPORT.md](./TEST_REPORT.md)。

**测试统计**：
- **Bun 环境测试数**: 460
- **Deno 环境测试数**: 469
- **通过**: 全部通过 ✅
- **失败**: 0
- **通过率**: 100% ✅
- **测试执行时间**:
  - Bun 环境: ~4.01秒
  - Deno 环境: ~46秒
- **测试覆盖**: 所有公共 API、边界情况、错误处理
- **测试环境**: Deno 2.x, Bun 1.3.5

**测试类型**：
- ✅ 单元测试（约 400 个）
- ✅ 集成测试（约 30 个）
- ✅ 边界情况和错误处理测试（约 39 个）

**测试亮点**：
- ✅ 所有功能、边界情况、错误处理都有完整的测试覆盖
- ✅ 集成测试验证了端到端的完整流程
- ✅ 内存模式（write: false）功能完整测试
- ✅ BuilderBundle 简单打包器完整测试（28 个）
  - ESM 和 IIFE 格式测试
  - 全局变量设置测试（window/global/globalThis）
  - 平台特定行为测试（browser/node/neutral）
- ✅ 路径解析功能测试（Deno 和 Bun 环境）
  - Deno 解析器插件测试（17 个测试）
  - Bun 解析器插件测试（10 个测试）
  - 服务端构建器路径解析测试（Deno 和 Bun 环境）
  - 客户端构建器路径解析测试（Deno 和 Bun 环境）

查看完整测试报告：[TEST_REPORT.md](./TEST_REPORT.md)

---

## 📝 注意事项

- **依赖要求**：需要安装 `npm:esbuild` 和 `@dreamer/runtime-adapter`
- **运行环境**：构建工具仅在服务端运行，不能在浏览器中使用
- **内存模式**：使用 `write: false` 时，内存模式不支持代码分割（splitting）
- **平台编译**：服务端多平台编译需要对应平台的编译工具链
- **缓存管理**：生产环境建议启用构建缓存以提升性能
- **路径解析**：
  - Deno 环境：需要 `deno.json` 配置 `imports` 字段来使用路径别名
  - Bun 环境：可以使用 `package.json` 的 `imports` 或 `tsconfig.json` 的 `paths` 来配置路径别名
  - Bun 环境不会读取 `deno.json` 配置

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

## 📄 许可证

MIT License - 详见 [LICENSE.md](./LICENSE.md)

---

<div align="center">

**Made with ❤️ by Dreamer Team**

</div>
