/**
 * 生产压缩压测：较大／较复杂多文件源 → minify + legalComments:"none"
 * 断言：体积小于未压缩／保留 license 的对照；构建成功；产物可执行冒烟。
 */
import {
  join,
  mkdir,
  writeTextFile,
  readTextFile,
} from "@dreamer/runtime-adapter";
import { describe, expect, it } from "@dreamer/test";
import { buildBundle } from "../src/builder-bundle.ts";
import { denoResolverPlugin } from "../src/plugins/resolver-deno.ts";
import { cleanupDir, getTestOutputDir } from "./test-utils.ts";

const LICENSE = `/*!
 * Copyright (c) 2026 Dreamer Stress Fixture
 * SPDX-License-Identifier: MIT
 * Permission is hereby granted... (long legal banner for size contrast)
 */`;

async function scaffoldComplexApp(root: string): Promise<string> {
  const src = join(root, "src");
  await mkdir(join(src, "util"), { recursive: true });
  await mkdir(join(src, "models"), { recursive: true });
  await mkdir(join(src, "services"), { recursive: true });

  await writeTextFile(
    join(src, "util", "math.ts"),
    `${LICENSE}
export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
export function sum(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0);
}
export function avg(nums: number[]): number {
  return nums.length ? sum(nums) / nums.length : 0;
}
`,
  );

  await writeTextFile(
    join(src, "util", "format.ts"),
    `${LICENSE}
export function pad2(n: number): string {
  return n < 10 ? \`0\${n}\` : String(n);
}
export function formatMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const v = Math.abs(cents);
  return \`\${sign}$\${Math.floor(v / 100)}.\${pad2(v % 100)}\`;
}
export function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
`,
  );

  await writeTextFile(
    join(src, "models", "order.ts"),
    `${LICENSE}
export type OrderStatus = "draft" | "paid" | "shipped" | "cancelled";
export interface OrderLine {
  sku: string;
  qty: number;
  unitCents: number;
}
export interface Order {
  id: string;
  status: OrderStatus;
  lines: OrderLine[];
  note?: string;
}
export function lineTotal(line: OrderLine): number {
  return line.qty * line.unitCents;
}
export function orderTotal(order: Order): number {
  return order.lines.reduce((s, l) => s + lineTotal(l), 0);
}
`,
  );

  await writeTextFile(
    join(src, "services", "pricing.ts"),
    `${LICENSE}
import { clamp } from "../util/math.ts";
import { orderTotal, type Order } from "../models/order.ts";

export function applyDiscount(order: Order, pct: number): number {
  const p = clamp(pct, 0, 100);
  const total = orderTotal(order);
  return Math.round(total * (1 - p / 100));
}

export function bulkScore(order: Order): number {
  const qty = order.lines.reduce((s, l) => s + l.qty, 0);
  if (qty >= 50) return 3;
  if (qty >= 20) return 2;
  if (qty >= 5) return 1;
  return 0;
}
`,
  );

  await writeTextFile(
    join(src, "services", "report.ts"),
    `${LICENSE}
import { avg } from "../util/math.ts";
import { formatMoney, slugify } from "../util/format.ts";
import { applyDiscount, bulkScore } from "./pricing.ts";
import { orderTotal, type Order } from "../models/order.ts";

export function summarize(orders: Order[], discountPct = 0): string {
  const totals = orders.map((o) => applyDiscount(o, discountPct));
  const mean = avg(totals);
  const scores = orders.map((o) => bulkScore(o));
  const title = slugify(\`orders-\${orders.length}-report\`);
  return [
    title,
    \`count=\${orders.length}\`,
    \`mean=\${formatMoney(Math.round(mean))}\`,
    \`rawSum=\${formatMoney(orders.reduce((s, o) => s + orderTotal(o), 0))}\`,
    \`bulk=\${scores.join(",")}\`,
  ].join("|");
}
`,
  );

  // fat entry: loops + object tables + re-exports to keep graph wide
  const entry = join(src, "main.ts");
  await writeTextFile(
    entry,
    `${LICENSE}
import { summarize } from "./services/report.ts";
import { clamp, sum } from "./util/math.ts";
import type { Order } from "./models/order.ts";

const CATALOG = Array.from({ length: 40 }, (_, i) => ({
  sku: \`SKU-\${1000 + i}\`,
  unitCents: 99 + (i * 17) % 500,
}));

function buildOrders(n: number): Order[] {
  const out: Order[] = [];
  for (let i = 0; i < n; i++) {
    const lines = CATALOG.slice(i % 10, (i % 10) + 3 + (i % 4)).map((c, j) => ({
      sku: c.sku,
      qty: 1 + ((i + j) % 7),
      unitCents: c.unitCents,
    }));
    out.push({
      id: \`ord-\${i}\`,
      status: (["draft", "paid", "shipped", "cancelled"] as const)[i % 4]!,
      lines,
      note: i % 5 === 0 ? \`note-\${i}\` : undefined,
    });
  }
  return out;
}

export function runStress(seed = 7): string {
  const orders = buildOrders(24 + (seed % 5));
  const report = summarize(orders, clamp(seed, 0, 30));
  const checksum = sum(orders.map((o) => o.lines.length));
  return \`\${report}|chk=\${checksum}|ok\`;
}

// side-effect free default for smoke
export const STRESS_BANNER = "prod-minify-legal-stress";
`,
  );
  return entry;
}

describe("生产压缩压测（复杂源 + legalComments none）", () => {
  it("minify+none 体积更小、无 license、产物可跑", async () => {
    const root = getTestOutputDir("prod-minify-legal-stress");
    try {
      const entry = await scaffoldComplexApp(root);
      const plugin = denoResolverPlugin({ projectDir: root });

      const plain = await buildBundle({
        entryPoint: entry,
        globalName: "StressPlain",
        platform: "neutral",
        format: "esm",
        minify: false,
        legalComments: "inline",
        plugins: [plugin],
      });

      const prod = await buildBundle({
        entryPoint: entry,
        globalName: "StressProd",
        platform: "neutral",
        format: "esm",
        minify: true,
        // 默认应等价 none；显式写出以锁定契约
        legalComments: "none",
        plugins: [plugin],
      });

      expect(plain.code.length).toBeGreaterThan(0);
      expect(prod.code.length).toBeGreaterThan(0);
      expect(prod.code.length).toBeLessThan(plain.code.length);
      // 对照含 license；生产 none 应去掉
      expect(plain.code).toContain("SPDX-License-Identifier");
      expect(prod.code).not.toContain("SPDX-License-Identifier");
      expect(prod.code).not.toContain("Copyright (c) 2026 Dreamer Stress Fixture");
      expect(prod.code).toContain("prod-minify-legal-stress");

      // 写出产物并动态 import 冒烟
      const outFile = join(root, "stress-prod.mjs");
      await writeTextFile(outFile, prod.code + "\n");
      const mod = await import(outFile);
      expect(typeof mod.runStress).toBe("function");
      const result = mod.runStress(11);
      expect(typeof result).toBe("string");
      expect(result).toContain("|ok");
      expect(result).toContain("count=");
      // 再读盘确认未被人改回带 license
      const disk = await readTextFile(outFile);
      expect(disk).not.toContain("SPDX-License-Identifier");
    } finally {
      await cleanupDir(root);
    }
  }, { sanitizeOps: false, sanitizeResources: false, timeout: 60_000 });
});
