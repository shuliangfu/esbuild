# Changelog

All notable changes to @dreamer/esbuild are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.3] - 2026-02-08

### Added

- **Resolver**: Debug logging for React/Preact main package and subpath resolution when `debug: true` is passed (projectDir, startDir, denoJson, import, importer) to aid build-time debugging (e.g. dweb CSR/SSR client builds).

---

## [1.0.2] - 2026-02-08

### Added

- **BuilderServer**: Add `builder-server-bun.test.ts` for Bun `buildWithBun` server build tests (2 tests, Bun only)

### Fixed

- **BuilderServer**: Use absolute path for entry when `buildWithBun` resolves to avoid wrong file being built (e.g. when `main.ts` exists in cwd)

### Changed

- **Docs**: Update TEST_REPORT.md with Deno/Bun test statistics (518 Deno, 503 Bun)
- **Docs**: Update README and README-zh test badges and statistics tables

---

## [1.0.1] - 2026-02-08

### Fixed

- **Resolver**: Add fallback for `xxx.ts` subpath when `exports["./xxx.ts"]` does not exist in JSR package; try `exports["./xxx"]` instead. Fixes esbuild resolver failing to resolve `EnginePacketType` and `SocketIOPacketType` when bundling client code that imports `@dreamer/socket-io/client` (e.g. relative import `../types.ts` from client modules).
- **Tests**: Disable leak detection for "应该清理测试输出目录" in edge-cases test to avoid CI failure caused by async `readTextFile` completing during test.

---

## [1.0.0] - 2026-02-06

### Added

- **Stable release**: First stable version with stable API
- **Server compilation**:
  - Server code compilation and bundling (based on @dreamer/runtime-adapter)
  - TypeScript compilation, code minification, standalone bundling
  - Multi-platform compilation (Linux, macOS, Windows)
  - Memory mode (`write: false`) to return compiled code without writing to file
  - External dependencies (`external` config)
  - Native compilation (`useNativeCompile`) for deno compile / bun build
    --compile
- **Client bundling**:
  - High-performance bundling based on esbuild
  - Code splitting (route-level, component-level), Tree-shaking
  - Multiple output formats (ESM, CJS, IIFE)
  - Memory mode (`write: false`)
- **HTML generation**:
  - Auto-generate HTML entry files, auto-inject bundled JS/CSS
  - Custom HTML templates, preload strategies, multi-entry HTML (MPA)
- **CSS processing**:
  - CSS extraction and optimization, autoprefixer, cssnano
  - Auto-inject CSS into HTML
- **Build optimization**:
  - Build cache management, incremental compilation, Watch mode
  - Build output analysis, performance monitoring
- **Plugin system**:
  - Flexible plugin architecture
  - Server module auto-detection and exclusion
  - Conditional compilation support
- **Path resolution**:
  - Auto-resolve relative paths, npm packages, JSR packages
  - Path aliases (`@/`, `~/`), deno.json imports, tsconfig paths
- **AssetsProcessor**:
  - Copy public/ to output, image compression, format conversion (webp/avif)
  - Content hash, quality parameter, asset-manifest.json for SSR
- **Subpath exports**: `/builder`, `/client`, `/server`, `/bundle`,
  `/css-injector` for on-demand imports

### Compatibility

- Deno 2.5.0+
- Bun 1.3.0+
- esbuild 0.27.2+
