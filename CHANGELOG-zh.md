# 变更日志

@dreamer/esbuild 的所有重要变更均记录于此文件。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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
