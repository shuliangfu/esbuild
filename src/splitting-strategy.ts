/**
 * @module @dreamer/esbuild/splitting-strategy
 *
 * Resolve SplittingStrategy into extra esbuild entry points so byRoute /
 * byComponent / bySize / custom / include actually change the chunk graph
 * (not just chunkNames). Esbuild has no manualChunks; additional entry
 * points + splitting:true is the supported lever.
 *
 * Import walk follows relative `./` / `../` by default. Optional
 * `aliases` (path prefix → local dir, e.g. from deno.json imports /
 * import map / tsconfig paths) lets the walk follow `@/…` style specs.
 */

import {
  dirname,
  exists,
  isFile,
  join,
  readTextFile,
  resolve,
  stat,
} from "@dreamer/runtime-adapter";
import type { SplittingStrategy } from "./types.ts";

const CODE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".mjs",
  ".cts",
  ".cjs",
] as const;

/** Static `from "..."` / `import "..."` / side-effect imports (any specifier) */
const STATIC_SPEC_RE =
  /(?:import|export)(?:\s+type)?\s+(?:[^'"\n;]*?\s+from\s+)?["']([^"']+)["']/g;

/** Dynamic `import("...")` */
const DYNAMIC_SPEC_RE = /import\s*\(\s*["']([^"']+)["']\s*\)/g;

/**
 * Route-like path conventions (Dreamer / common app routers).
 * Matched against normalized absolute paths.
 */
export function isRouteSplitPath(filePath: string): boolean {
  const n = filePath.replace(/\\/g, "/");
  if (/\/(routes|pages)\//i.test(n)) return true;
  if (/\/(?:_?(?:layout|page|route)|route-page)(?:\.[^/]+)?$/i.test(n)) {
    return true;
  }
  if (/\/\+(?:page|layout|error|loading)(?:\.[^/]+)?$/i.test(n)) return true;
  if (/\/[^/]*route[^/]*\.(?:tsx?|jsx?|mts|mjs)$/i.test(n)) return true;
  return false;
}

/**
 * Component-like path conventions.
 */
export function isComponentSplitPath(filePath: string): boolean {
  const n = filePath.replace(/\\/g, "/");
  return /\/components\//i.test(n);
}

/**
 * Convert a simple glob (`*`, `**`, `?`) to a RegExp.
 * Patterns are matched against forward-slash normalized absolute paths.
 */
export function globToRegExp(pattern: string): RegExp {
  const n = pattern.replace(/\\/g, "/");
  let re = "^";
  let i = 0;
  while (i < n.length) {
    if (n[i] === "*" && n[i + 1] === "*") {
      if (n[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 3;
      } else {
        re += ".*";
        i += 2;
      }
    } else if (n[i] === "*") {
      re += "[^/]*";
      i += 1;
    } else if (n[i] === "?") {
      re += "[^/]";
      i += 1;
    } else if (".$^+()[]{}|\\".includes(n[i]!)) {
      re += "\\" + n[i];
      i += 1;
    } else {
      re += n[i];
      i += 1;
    }
  }
  re += "$";
  return new RegExp(re, "i");
}

/**
 * Match `filePath` against any of the glob patterns.
 */
export function matchSplitGlobs(
  filePath: string,
  patterns: string[] | undefined,
): boolean {
  if (!patterns || patterns.length === 0) return false;
  const n = filePath.replace(/\\/g, "/");
  for (const pattern of patterns) {
    if (!pattern) continue;
    try {
      if (globToRegExp(pattern).test(n)) return true;
    } catch {
      // ignore bad patterns
    }
  }
  return false;
}

/**
 * Whether this strategy object asks for any real split-point collection.
 * Boolean `splitting: true` / empty object → false (compat: name-only / native).
 * `aliases` alone do not trigger a scan (they only extend the walk).
 */
export function strategyRequestsSplitEntries(
  strategy: SplittingStrategy,
): boolean {
  return !!(
    strategy.byRoute ||
    strategy.byComponent ||
    (typeof strategy.bySize === "number" && strategy.bySize > 0) ||
    typeof strategy.custom === "function" ||
    (Array.isArray(strategy.include) && strategy.include.length > 0)
  );
}

function normalizeAliasPrefix(prefix: string): string {
  return prefix;
}

function resolveAliasTarget(
  target: string,
  root: string,
): string {
  if (
    target.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(target) // Windows drive
  ) {
    return resolve(target);
  }
  return resolve(root, target);
}

/**
 * Build longest-prefix-first alias list from strategy.aliases.
 */
function buildAliasEntries(
  strategy: SplittingStrategy,
  root: string,
): Array<{ prefix: string; target: string }> {
  const aliases = strategy.aliases;
  if (!aliases) return [];
  return Object.entries(aliases)
    .filter(([prefix, target]) => !!prefix && typeof target === "string")
    .map(([prefix, target]) => ({
      prefix: normalizeAliasPrefix(prefix),
      target: resolveAliasTarget(target, root),
    }))
    .sort((a, b) => b.prefix.length - a.prefix.length);
}

async function resolveWithExtensions(base: string): Promise<string | null> {
  const candidates: string[] = [base];
  for (const ext of CODE_EXTENSIONS) {
    candidates.push(base + ext);
    candidates.push(join(base, "index" + ext));
  }
  for (const candidate of candidates) {
    try {
      if (await exists(candidate) && await isFile(candidate)) {
        return resolve(candidate);
      }
    } catch {
      // ignore missing / permission
    }
  }
  return null;
}

async function resolveLocalSpecifier(
  fromFile: string,
  spec: string,
  aliasEntries: Array<{ prefix: string; target: string }>,
): Promise<string | null> {
  // Relative (default / compat path)
  if (spec.startsWith(".")) {
    const base = resolve(dirname(fromFile), spec);
    return await resolveWithExtensions(base);
  }

  // Skip remote / protocol / bare package without configured alias
  if (
    spec.startsWith("npm:") ||
    spec.startsWith("jsr:") ||
    spec.startsWith("http:") ||
    spec.startsWith("https:") ||
    spec.startsWith("node:") ||
    spec.startsWith("data:")
  ) {
    return null;
  }

  for (const { prefix, target } of aliasEntries) {
    if (!spec.startsWith(prefix)) continue;
    const rest = spec.slice(prefix.length);
    // Avoid joining when rest is empty and target already a file
    const base = rest
      ? join(target, rest)
      : target.endsWith("/") || target.endsWith("\\")
      ? target
      : target;
    const resolved = await resolveWithExtensions(base);
    if (resolved) return resolved;
  }

  return null;
}

function collectImportSpecs(source: string): string[] {
  const specs = new Set<string>();
  STATIC_SPEC_RE.lastIndex = 0;
  DYNAMIC_SPEC_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STATIC_SPEC_RE.exec(source)) !== null) {
    if (m[1]) specs.add(m[1]);
  }
  while ((m = DYNAMIC_SPEC_RE.exec(source)) !== null) {
    if (m[1]) specs.add(m[1]);
  }
  return [...specs];
}

async function shouldSplitFile(
  absPath: string,
  strategy: SplittingStrategy,
  primaryEntry: string,
): Promise<boolean> {
  const normalized = resolve(absPath);
  if (normalized === resolve(primaryEntry)) return false;

  if (matchSplitGlobs(normalized, strategy.exclude)) return false;

  if (strategy.byRoute && isRouteSplitPath(normalized)) return true;
  if (strategy.byComponent && isComponentSplitPath(normalized)) return true;

  if (matchSplitGlobs(normalized, strategy.include)) return true;

  if (typeof strategy.custom === "function") {
    try {
      if (strategy.custom(normalized)) return true;
    } catch {
      // ignore custom predicate errors
    }
  }

  if (typeof strategy.bySize === "number" && strategy.bySize > 0) {
    try {
      const info = await stat(normalized);
      if (typeof info.size === "number" && info.size >= strategy.bySize) {
        return true;
      }
    } catch {
      // ignore
    }
  }

  return false;
}

/**
 * Walk the local import graph from `entryPoint` and return absolute paths that
 * should be passed as **additional** esbuild entry points so that
 * `splitting: true` emits separate chunks for those modules.
 *
 * Follows relative specs always; follows alias-prefix specs when
 * `strategy.aliases` is set (local targets only). Skips remote / package
 * specs (`npm:`, `jsr:`, bare without alias, http). Does not modify source.
 * Primary entry is never returned (caller already has it).
 */
export async function collectSplitEntryPoints(
  entryPoint: string,
  strategy: SplittingStrategy,
): Promise<string[]> {
  if (!strategyRequestsSplitEntries(strategy)) return [];

  const primary = resolve(entryPoint);
  const root = strategy.root ? resolve(strategy.root) : dirname(primary);
  const aliasEntries = buildAliasEntries(strategy, root);
  const visited = new Set<string>();
  const splitEntries: string[] = [];
  const queue: string[] = [primary];

  while (queue.length > 0) {
    const current = queue.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);

    if (await shouldSplitFile(current, strategy, primary)) {
      splitEntries.push(current);
    }

    let source: string;
    try {
      source = await readTextFile(current);
    } catch {
      continue;
    }

    for (const spec of collectImportSpecs(source)) {
      const resolved = await resolveLocalSpecifier(
        current,
        spec,
        aliasEntries,
      );
      if (resolved && !visited.has(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return splitEntries;
}

/**
 * Build the full entryPoints list for a client build.
 */
export async function resolveClientEntryPoints(
  entryPoint: string,
  splitting: boolean | SplittingStrategy | undefined,
  splittingEnabled: boolean,
): Promise<string[]> {
  const primary = resolve(entryPoint);
  if (!splittingEnabled || typeof splitting !== "object" || !splitting) {
    return [primary];
  }
  const extras = await collectSplitEntryPoints(primary, splitting);
  const seen = new Set<string>([primary]);
  const out = [primary];
  for (const extra of extras) {
    const abs = resolve(extra);
    if (!seen.has(abs)) {
      seen.add(abs);
      out.push(abs);
    }
  }
  return out;
}
