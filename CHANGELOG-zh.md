# 变更日志

@dreamer/esbuild 的所有重要变更均记录于此文件。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [1.0.4] - 2026-02-09

### 修复

- **Resolver**：在 `getLocalPathFromCache` 中增加 npm 子路径回退解析。当 `npm:preact@x.x.x/jsx-runtime`（或类似子路径）无法直接解析时，从主包路径推导包根，并尝试常见子路径文件（如 `jsx-runtime.mjs`、`jsx-runtime.js`、`jsx-runtime/index.mjs`）。修复 Preact 混合应用 hydration 报错 `(void 0) is not a function`（因 esbuild 打包 `preact/jsx-runtime` 时得到空 stub 模块导致）。

---

## [1.0.3] - 2026-02-08

### 新增

- **Resolver**：在传入 `debug: true` 时，为 React/Preact 主包及子路径解析输出调试日志（projectDir、startDir、denoJson、import、importer），便于构建时排查问题（如 dweb CSR/SSR 客户端构建）。

---

## [1.0.2] - 2026-02-08

### 新增

- **BuilderServer**：新增 `builder-server-bun.test.ts`，用于 Bun `buildWithBun` 服务端构建测试（2 个用例，仅 Bun）

### 修复

- **BuilderServer**：`buildWithBun` 解析入口时使用绝对路径，避免构建到错误文件（如 cwd 中存在 `main.ts` 时）

### 变更

- **文档**：更新 TEST_REPORT.md，补充 Deno/Bun 测试统计（Deno 518、Bun 503）
- **文档**：更新 README 与 README-zh 的测试徽章和统计表格

---

## [1.0.1] - 2026-02-08

### 修复

- **Resolver**：当 JSR 包中 `exports["./xxx.ts"]` 不存在时，回退尝试 `exports["./xxx"]`。修复打包导入 `@dreamer/socket-io/client` 的客户端代码时，无法解析 `EnginePacketType`、`SocketIOPacketType` 的问题（client 模块内相对导入 `../types.ts` 导致）。
- **测试**：为 edge-cases 中「应该清理测试输出目录」测试禁用 leak 检测，避免 CI 因异步 `readTextFile` 在测试期间完成而失败。

---

## [1.0.0] - 2026-02-06

### 新增

- **稳定版发布**：首个稳定版本，API 稳定
- **服务端编译**：基于 @dreamer/runtime-adapter 的服务端代码编译与打包
- **客户端打包**：基于 esbuild 的高性能打包
- **HTML 生成**：自动生成 HTML 入口、注入 JS/CSS
- **CSS 处理**：提取、优化、autoprefixer、cssnano
- **构建优化**：缓存、增量编译、Watch 模式
- **插件系统**：灵活插件架构
- **路径解析**：相对路径、npm 包、JSR 包自动解析
- **AssetsProcessor**：资源复制、图片压缩、格式转换
- **子路径导出**：`/builder`、`/client`、`/server`、`/bundle`、`/css-injector` 按需导入
