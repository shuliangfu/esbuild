# resolver-deno 重写分析

## 一、目标

1. **不走网络**：全部解析只查本地缓存，未命中即报错或明确失败，不 subprocess
   resolve、不 fetch JSR。
2. **通用**：不针对某个包写特殊分支（如 `/components`、`/mod`），规则统一。
3. **相对路径正确**：包内 `./mod`、`../x` 等基于「importer
   所在目录」解析，不拼错路径。
4. **缓存范围限定**：不能使用「全部 Deno 缓存」；只使用**当前项目的 deno.json
   解析出的依赖**以及**项目中 jsr: 包的缓存**（即仅本项目的依赖图内的模块）。

---

## 二、现状问题简述

- **多套逻辑并存**：直接缓存查找、范围匹配、tryKeys 多种写法、subprocess
  resolve、fetchJsrSourceViaMeta、import.meta.resolve，分支多且互相覆盖。
- **缓存 key 不统一**：`deno info` 产出的是
  `https://jsr.io/.../version/src/path.ts`，插件里又衍生
  `jsr:@scope@version/path`、`@^version`、无扩展名、带 `src/` 等多种
  key，查找时再靠 tryKeys + 范围遍历，效率低且易漏。
- **相对路径 base 靠猜**：用「是否带扩展名」「是否 /mod」「是否
  /components」或「是否在缓存」推断 importer 是文件还是目录，逻辑分散且易错。

---

## 三、重写核心思路

### 3.1 单一数据源：预构建缓存（且仅限本项目）

- **缓存范围**（必须遵守）：
  - **不能**去扫或使用「整个 Deno 缓存目录」或其它项目的缓存。
  - **只能**使用以下两类来源：
    1. **当前项目的 deno.json 下的缓存**：在**项目目录**下、用**项目的
       deno.json**（`--config <项目 deno.json>`）执行
       `deno info --json <entry>`，得到的依赖图里的模块 → 这些模块的 resolved
       specifier 与本地路径才写入 cache。
    2. **项目中 jsr: 包的缓存**：即上述依赖图里通过 `jsr:`
       引用到的包（及其传递依赖），它们经 Deno
       解析后落在本地缓存中的路径；不包含项目未引用的其它 JSR 包。
  - 总结：cache = 仅「本项目 deno.json + entry 的依赖图」对应的那批模块的
    specifier→localPath，不扩大范围。
- **唯一真相**：`buildModuleCache(entry, projectDir)` 在**项目目录**、带**项目
  deno.json** 调用 `deno info --json`（或等价），一次性拿到「本依赖图内」模块的
  **resolved specifier → 本地绝对路径**，仅将这部分写入 Map。
- **缓存 key 约定**（建议）：
  - 以 **resolved 后的形态** 为准：例如 JSR 为
    `jsr:@scope/name@<exactVersion>/<path>`，path 与 `deno info` 一致（如
    `src/client/mod.ts`、`src/client/components.ts`）。
  - 为减少查找分支，可在 buildModuleCache 阶段对每个模块
    **同时写入「导出风格」的 key**：\
    例如文件 `src/client/mod.ts` 对应导出 `client`，则额外写
    `jsr:@scope/name@version/client` → 同一 localPath；\
    `src/client/components.ts` 对应导出 `client/components`，则写
    `.../client/components` → 同一 localPath。\
    这样 onResolve 只需 **一次 get(specifier)**，无需 tryKeys/范围匹配。
- **npm**：同上，仅对**本依赖图内**的 npm 模块；`deno info` 无 local
  时用子进程在**项目目录 + 项目 deno.json** 下 `import.meta.resolve` 补全并写入
  cache。**仅允许在 buildModuleCache 时** 调用子进程，插件运行时不再
  subprocess。

### 3.2 禁止网络与运行时 subprocess

- 插件 **onResolve / onLoad** 内：
  - 不调用 `fetch`、不请求 JSR API、不读 meta.json。
  - 不调用 `import.meta.resolve`（插件上下文与项目 deno.json 不一致）。
  - 不为此起 subprocess 做 resolve。
- 解析结果 **只来自**：`moduleCache.get(specifier)` 或基于 cache
  推导出的路径；未命中则返回错误或 undefined，由上层决定是否报错。

### 3.3 相对路径：通用规则

- **约定**：importer 一定是「协议路径」（如 `jsr:@scope/name@version/client` 或
  `.../client/components`），且该路径 **一定在 cache 里存在**（因为来自我们之前
  onResolve 的返回）。
- **规则**：
  1. 用 `parseJsrPackageBaseAndPath(importer)` 得到 `packageBase` +
     `pathWithinPackage`。
  2. **importer 在 cache 中命中 ⇒ 视为单文件**。\
     base 目录 = `pathWithinPackage` 的**父目录**（即
     `pathWithinPackage.replace(/\/[^/]+$/, "")`）。\
     例如 `client/components` → base = `client`；`client/mod` → base =
     `client`；`encryption/encryption-manager` → base = `encryption`。
  3. 用 `new URL(relativePath, "file:///" + base + "/").pathname`
     得到包内相对路径，再拼成 `packageBase + "/" + resolvedPath` 得到目标
     specifier。
  4. 对目标 specifier 做 **一次 cache 查找**；命中则返回对应 localPath（或返回
     deno-protocol path 让 onLoad 读 cache），未命中则报错/undefined。
- **不引入**「带扩展名」「/mod」「/components」等特殊分支；是否「单文件」完全由「是否在
  cache 中」决定。

### 3.4 插件与 esbuild 的配合

- **isServerBuild === true**：与现在一致，jsr:/npm 直接
  `external: true`，不参与打包。
- **isServerBuild === false 且提供 moduleCache**：
  - **onResolve（顶层 jsr:/npm）**：
    - 规范 specifier（如 ^ → 在 cache 中选一个等价 key，见下）。
    - `localPath = moduleCache.get(specifier)`（或唯一一种规范化后的 get）。
    - 若命中：返回 `path: localPath, namespace: "file"`，这样 esbuild
      会认为该模块是磁盘文件，**相对路径会走 namespace "file" 的解析**。
  - **onResolve（namespace "file" 下的相对路径 ./ ../）**：
    - importer 此时为 **本地绝对路径**（因为上一步我们返回了 file）。
    - 需要 **从 localPath 反推回「协议路径」**，才能用「包内 base +
      relativePath」算目标协议路径，再查 cache。
    - 因此要么：\
      **(A)** 维护一个 **reverseMap: localPath → 协议路径**（在 buildModuleCache
      或插件初始化时从 moduleCache 建出来），用 `importer` 的 localPath 查
      reverseMap 得到协议路径，再按 3.3 算目标 specifier，再
      `moduleCache.get(目标)` 得到目标 localPath 返回；\
      **(B)** 或者顶层 jsr:/npm 不返回 file，而是返回
      `path: protocolPath, namespace: "deno-protocol"`，相对路径 onResolve 的
      importer 就是协议路径，直接走 3.3，最后再在 onLoad 里对 protocolPath
      做一次 cache 读文件。
- **(B) 更简单**：顶层与相对路径都统一用「协议路径」在插件内流转，onLoad
  只做「protocolPath → cache.get → readFile」；相对路径 onResolve 只做「importer
  协议路径 + args.path → 目标协议路径 → cache.get(目标) → 若命中则返回 file path
  或继续返回 protocol path 给 onLoad」。\
  若希望相对导入也直接得到 file path（减少 onLoad 调用），可在相对路径 onResolve
  中算出目标协议路径后 `cache.get` 得到 localPath，返回
  `path: localPath, namespace: "file"`。

### 3.5 缓存查找：用正则匹配 key（避免精确拼接路径）

- **问题**：精确匹配 cache key 需要把「版本、path、是否带 src/、是否带
  .ts」等都拼对，容易错且难维护。
- **做法**：**查找时用正则（或模式）去匹配 cache 的 key**，命中即取该 key 对应的
  localPath；不依赖「拼出与 deno info 完全一致的 key」。
- **buildModuleCache 写入**：
  - 保持简单：按 `deno info` 产出原样写入，例如 JSR 为
    `jsr:@scope/name@version/path`（path 如 `src/client/mod.ts`），npm 为
    `npm:pkg@version/subpath`。**不必**再写一套「导出风格」key。
- **cacheLookup(specifier)**：
  1. **先精确查**：`moduleCache.get(specifier)`，命中则返回。
  2. **未命中则按 specifier 生成正则**，遍历 `moduleCache` 的
     key，取第一个被该正则匹配的 key，返回其 value（localPath）。
- **JSR 的 specifier → 正则**（思路）：
  - 从 specifier 解析出：`scope/name`、版本部分（可含 ^/~）、包内路径
    subpath（如 `client`、`client/components`）。
  - 正则允许：版本为任意数字/点（或忽略 ^/~）、包内路径允许带或不带
    `src/`、末尾允许有无扩展名。\
    例如 `jsr:@dreamer/router@^1.0.8/client` → 匹配 key 形如
    `jsr:@dreamer/router@[\d.]+/(src/)?client(/mod)?(\.tsx?|\.jsx?)?`
    或更宽松的等价形式；\
    `jsr:@dreamer/router@1.0.9/client/components` → 匹配
    `.../client/components(.ts)?` 等。
  - 保证同一包内「同一逻辑路径」只对应一个 cache 条目（取第一个匹配即可）。
- **相对路径得到的目标 specifier**（如
  `packageBase + "/" + resolvedPath`）同样用正则查 cache：用 packageBase 的
  scope/name + resolvedPath 构造正则，在 cache 的 key 里匹配，避免自己拼
  `src/`、扩展名等。
- **npm**：可继续精确 get，或对 subpath 做简单正则（如允许 `/dist/` 与 `/cjs/`
  等变体）。逻辑可先简单再按需放宽。
- **优点**：不依赖精确拼接 key；deno info 的 key
  格式有细微变化时只需调正则，不用改多处拼接逻辑。

### 3.6 需要保留的周边能力

- **路径别名**（`@/`、`~/` 等）：仍从项目 deno.json 的 imports
  解析，仅做本地路径替换，与 cache 无关。
- **bare specifier**（`@dreamer/xxx`）：从 deno.json imports 解析为
  jsr:/npm，再走上述 cache 逻辑。
- **browserMode**：jsr/npm 转 CDN URL 并 external，逻辑可保留，不依赖 cache。
- **CJS→ESM 重定向**：若 cache 中某条指向 npm 包的 CJS 文件，可继续在 onLoad 或
  onResolve 时替换为已缓存的 ESM 路径；逻辑可收敛到「仅读 cache + 最多一次 CJS
  检测」。
- **resolveOverrides**：继续在首次 onResolve 时优先查 override，再查 cache。
- **loader**：根据最终使用的 localPath 或 cache key 的扩展名决定 ts/tsx/js/jsx。

---

## 四、建议的模块划分（重写后）

| 模块 / 文件                                                                     | 职责                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildModuleCache`                                                              | 仅负责：在**项目目录 + 项目 deno.json** 下执行 deno info（+ 必要时 npm 子进程 resolve），**只把本依赖图内的模块**写入 Map；可同时生成 reverseMap(localPath → specifier) 供相对路径用。不扫全局缓存。 |
| `cacheLookup(specifier, moduleCache, options?)`                                 | 唯一入口：先精确 get；未命中则用 specifier 生成正则，遍历 cache key 取第一个匹配，返回其 localPath。不做精确路径拼接。                                                                               |
| `resolveRelative(importerProtocolPath, relativePath, moduleCache, reverseMap?)` | 解析包内相对路径：importer 在 cache 中 ⇒ base = dirname(pathWithinPackage)；算目标逻辑路径；用 packageBase + 该路径走 cacheLookup（正则匹配），不手拼 key。                                          |
| `onResolve`                                                                     | 分三类：别名、顶层 jsr/npm、相对路径；后两类只调 cacheLookup / resolveRelative，不 subprocess、不 fetch。                                                                                            |
| `onLoad`                                                                        | 仅对 deno-protocol（若仍使用）：path 即 protocolPath → cacheLookup → readFile 返回 contents + loader；无网络。                                                                                       |

---

## 五、实施顺序建议

1. **定稿缓存 key 约定**：buildModuleCache 只写 deno info 产出的
   key，不写多套；查找统一用正则匹配。
2. **实现新 buildModuleCache**：输出 ModuleCache + 可选 ReverseMap；key 与 deno
   info 一致即可。
3. **实现 cacheLookup**：先精确 get；未命中则 specifier → 正则，遍历 cache key
   取第一个匹配并返回 localPath。
4. **实现 resolveRelative**：仅依赖 cache + reverseMap（若 importer 为 file
   时需反推协议路径）。
5. **重写 onResolve**：别名 → 现有逻辑；jsr/npm → cacheLookup，命中则
   file；相对路径 → resolveRelative，命中则 file。
6. **重写 onLoad**：仅 cacheLookup + readFile；删除
   fetch、subprocess、fetchJsrSourceViaMeta。
7. **删除**：所有 fetch、import.meta.resolve、子进程
   resolve、fetchJsrSourceViaMeta、getLocalPathFromCache 内复杂
   tryKeys/范围循环，收敛到上述单一路径。

---

## 六、小结

- **不跑网络**：只读预构建的 moduleCache，未命中即失败。
- **缓存范围**：只用当前项目 deno.json 与 entry 的依赖图 + 其中 jsr:
  包的缓存；不拿「所有缓存」、不扫全局。
- **缓存查找**：用正则匹配 cache key，不依赖精确拼接路径；先精确 get，未命中再按
  specifier 生成正则遍历匹配。
- **通用**：是否文件、base 目录，都只依赖「是否在 cache」和「pathWithinPackage
  的父目录」。
- **相对路径**：importer 在 cache ⇒ 单文件 ⇒ base =
  dirname(pathWithinPackage)；用 URL 解析 relativePath，得到目标 specifier，再查
  cache 一次。

这样重写后，逻辑单一路径清晰，便于维护和性能优化。
