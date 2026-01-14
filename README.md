# @dreamer/esbuild

> 一个兼容 Deno 和 Bun 的构建工具库，提供服务端和客户端编译功能

[![JSR](https://jsr.io/badges/@dreamer/esbuild)](https://jsr.io/@dreamer/esbuild)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 🎯 功能

构建工具库，用于编译服务端和客户端代码。

## 特性

### 服务端编译

- 服务端代码编译和打包（基于 `@dreamer/runtime-adapter`，兼容 Deno 和 Bun）
- TypeScript 编译（Deno/Bun 内置）
- 代码压缩和优化
- 依赖分析和打包
- 单文件打包（standalone）
- 多平台编译（Linux、macOS、Windows）
- 编译配置（deno.json/bun.json 支持）
- **运行时兼容性**：必须兼容 Deno 和 Bun，使用 `@dreamer/runtime-adapter` 实现跨运行时编译

### 客户端编译

- **打包工具**：基于 esbuild（通过 npm:esbuild）
- **JS Bundle 生成**：
  - 入口文件打包（entry point → bundle.js）
  - 代码分割（路由级别、组件级别）
  - 生成多个 chunk 文件（main.js、chunk-xxx.js）
  - 依赖打包（将 node_modules 中的依赖打包）
  - Tree-shaking（移除未使用的代码）
- **HTML 生成**：
  - 自动生成 HTML 入口文件（index.html）
  - 自动注入打包后的 JS 文件（`<script src="main.js">`）
  - 自动注入 CSS 文件（`<link rel="stylesheet" href="main.css">`）
  - 支持自定义 HTML 模板
  - 支持多入口 HTML（MPA 多页应用）
- **支持框架**：Preact、React、Vue3（支持这三个框架）
- **客户端渲染（CSR）支持**：
  - 纯客户端渲染（SPA 单页应用）
  - 生成完整的客户端 JS bundle
  - 客户端路由支持（React Router、Preact Router）
  - 客户端状态管理
  - 客户端数据获取
- **资源处理**：
  - CSS 处理和优化（提取、压缩、自动前缀）
  - 图片处理（压缩、格式转换）
  - 字体文件处理
  - 静态资源复制和优化
- **生产构建优化**：
  - 代码压缩（minify）
  - 代码混淆（mangle）
  - Source Map 生成
  - 资源压缩和优化

### 通用功能

- 统一的构建配置
- 多环境构建（dev、prod）
- 构建缓存
- 增量编译
- 构建产物分析
- 插件系统

## 实现技术栈

- **服务端编译**：`@dreamer/runtime-adapter`（跨运行时编译，兼容 Deno 和 Bun）
- **客户端打包**：esbuild（通过 npm:esbuild）
- **渲染功能**：由 `@dreamer/render` 库负责（不在本库实现）
- **HTML 生成**：模板引擎（自定义实现）

## 实现可行性分析

- ✅ **服务端编译**：完全可行
  - 使用 `@dreamer/runtime-adapter` 实现跨运行时编译（兼容 Deno 和 Bun）
  - Deno 环境：使用 Deno 编译 API（通过运行时适配器）
  - Bun 环境：使用 Bun 打包 API（通过运行时适配器）
  - 支持多平台编译（Linux、macOS、Windows）
  - 支持 standalone 打包（包含所有依赖）

- ✅ **客户端 JS Bundle 生成**：完全可行
  - 使用 esbuild（npm:esbuild）进行打包
  - esbuild 支持 TypeScript、JSX、代码分割、Tree-shaking
  - 可以处理 npm 依赖和本地模块
  - 生成优化后的 bundle 文件（main.js、chunk-xxx.js）
  - **关键**：入口文件（entry）→ 打包工具 → 生成 bundle.js → HTML 中引入

- ✅ **HTML 生成**：完全可行
  - 使用模板引擎生成 HTML 文件
  - 自动注入打包后的 JS 和 CSS 文件路径
  - 支持自定义 HTML 模板
  - 可以处理多入口场景
  - **关键**：构建时扫描生成的 JS/CSS 文件 → 生成 HTML → 注入 `<script>` 和 `<link>` 标签


- ✅ **资源处理**：完全可行
  - CSS 提取和处理（esbuild 内置支持）
  - 图片和字体等静态资源复制
  - 可以使用 Deno 内置 API 处理文件操作

- ⚠️ **注意事项**：
  - 需要依赖 npm 包（esbuild）
  - 需要依赖 `@dreamer/runtime-adapter`（跨运行时兼容）
  - 客户端打包功能相对复杂，需要处理各种边界情况
  - 必须确保 Deno 和 Bun 兼容性，不能直接使用 `deno compile`
  - 建议分阶段实现：先实现基础打包，再添加高级特性

## 使用场景

- Deno 项目构建和打包
- 前端项目构建（Preact、React）
- **客户端渲染（CSR）项目构建**（SPA 单页应用）
- 全栈项目构建（服务端 + 客户端）
- CI/CD 构建流程
- 多平台应用打包

## 安装

```bash
deno add jsr:@dreamer/esbuild
```

## 环境兼容性

- **运行时要求**：Deno 2.6+ 或 Bun 1.3.5
- **服务端**：✅ 支持（兼容 Deno 和 Bun 运行时，服务端编译支持）
- **客户端**：❌ 不支持（构建工具，仅在服务端运行）
- **依赖**：
  - `npm:esbuild`（客户端打包）
  - `@dreamer/runtime-adapter`（跨运行时编译，必须）
  - `@dreamer/render`（渲染功能，独立库，不在本库实现）
- **平台限制**：服务端编译支持 Linux、macOS、Windows（通过运行时适配器）

---

## 🚀 快速开始

```typescript
import { Builder, createBuilder } from "jsr:@dreamer/esbuild";

// 创建构建器
const builder = createBuilder({
  // 服务端构建配置
  server: {
    entry: "./src/server.ts",
    output: "./dist/server",
    target: "deno",
    compile: {
      minify: true,
      platform: ["linux", "darwin"], // 支持 Linux 和 macOS
    }
  },
  // 客户端构建配置（支持 Preact、React 或 Vue3）
  client: {
    entry: "./src/client/index.tsx", // 或 .vue
    output: "./dist/client",
    engine: "react", // 或 "preact" 或 "vue3"
    bundle: {
      minify: true,
      sourcemap: true,
      splitting: true,
    },
    html: {
      template: "./public/index.html", // 可选：自定义 HTML 模板
      title: "My App"
    }
  }
});

// 构建服务端
await builder.buildServer();

// 构建客户端
await builder.buildClient();

// 同时构建服务端和客户端
await builder.build();

```

### 纯客户端渲染（CSR - SPA 模式）

```typescript
const builder = createBuilder({
  client: {
    entry: "./src/client/index.tsx", // 入口文件（.tsx 或 .vue）
    output: "./dist/client", // 输出目录
    engine: "react", // 或 "preact" 或 "vue3"
    html: {
      template: "./public/index.html", // 可选：自定义 HTML 模板
      title: "My App"
    }
  }
});

await builder.buildClient();

// 构建产物：
// dist/client/index.html:
//   <!DOCTYPE html>
//   <html>
//     <head>
//       <link rel="stylesheet" href="/main.css">
//     </head>
//     <body>
//       <div id="root"></div>
//       <script src="/main.js"></script>
//     </body>
//   </html>
// dist/client/main.js: 打包后的 React/Preact 应用代码
```

### 客户端渲染 JS 生成流程（详细说明）

**步骤 1：入口文件分析**
```
入口：./src/client/index.tsx
↓
分析依赖（import 语句）
↓
构建依赖图（dependency graph）
```

**步骤 2：代码打包**
```
使用 esbuild 打包：
- 入口文件 + 所有依赖 → bundle
- TypeScript → JavaScript（编译）
- JSX → JavaScript（转换）
- 代码分割（按路由、按组件）
- Tree-shaking（移除未使用代码）
- 压缩和优化
↓
生成文件：
- main.js（主 bundle）
- chunk-route-home.js（路由 chunk）
- chunk-route-about.js（路由 chunk）
```

**步骤 3：HTML 生成**
```
扫描生成的 JS/CSS 文件
↓
生成 HTML 模板：
<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="/main.css">
  </head>
  <body>
    <div id="root"></div>
    <!-- 自动注入打包后的 JS -->
    <script src="/main.js"></script>
    <script src="/chunk-route-home.js"></script>
    <script src="/chunk-route-about.js"></script>
  </body>
</html>
↓
输出：dist/client/index.html
```

**步骤 4：资源处理**
```
- CSS 提取：从 JS 中提取 CSS → main.css
- 静态资源：复制到 dist/client/assets/
- 资源路径：自动更新为正确的路径
```

**最终产物结构（CSR）**：
```
dist/client/
├── index.html          # HTML 入口（包含所有 <script> 标签）
├── main.js             # 主 bundle（React/Preact + 应用代码）
├── main.css            # 提取的 CSS
├── chunk-*.js          # 代码分割后的 chunk
└── assets/             # 静态资源（图片、字体等）
    ├── logo.png
    └── fonts/
```


---

## 📝 备注

- **构建工具**：仅在服务端运行，用于构建客户端和服务端代码
- **统一接口**：提供统一的构建 API 接口，降低学习成本
- **类型安全**：完整的 TypeScript 类型支持
- **依赖**：
  - `npm:esbuild`（客户端打包）
  - `@dreamer/runtime-adapter`（跨运行时编译）
- **平台限制**：服务端编译支持 Linux、macOS、Windows（通过运行时适配器）

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
