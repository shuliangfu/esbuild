/**
 * @module @dreamer/esbuild/i18n
 *
 * i18n for @dreamer/esbuild: builder/analyzer log and error messages.
 * Uses $tr + module instance, no install(); locale auto-detected from env
 * (LANGUAGE/LC_ALL/LANG) when not set.
 */

import {
  createI18n,
  type I18n,
  type TranslationData,
  type TranslationParams,
} from "@dreamer/i18n";
import { getEnv } from "@dreamer/runtime-adapter";
import enUS from "./locales/en-US.json" with { type: "json" };
import zhCN from "./locales/zh-CN.json" with { type: "json" };

/** Supported locale. */
export type Locale = "en-US" | "zh-CN";

/** Default locale when detection fails. */
export const DEFAULT_LOCALE: Locale = "en-US";

const ESBUILD_LOCALES: Locale[] = ["en-US", "zh-CN"];

const LOCALE_DATA: Record<string, TranslationData> = {
  "en-US": enUS as TranslationData,
  "zh-CN": zhCN as TranslationData,
};

/** Module-scoped i18n instance for esbuild; not installed globally. */
let esbuildI18n: I18n | null = null;

/**
 * Detect locale: LANGUAGE > LC_ALL > LANG.
 * Falls back to DEFAULT_LOCALE when unset or not in supported list.
 */
export function detectLocale(): Locale {
  const langEnv = getEnv("LANGUAGE") || getEnv("LC_ALL") || getEnv("LANG");
  if (!langEnv) return DEFAULT_LOCALE;
  const first = langEnv.split(/[:\s]/)[0]?.trim();
  if (!first) return DEFAULT_LOCALE;
  const match = first.match(/^([a-z]{2})[-_]([A-Z]{2})/i);
  if (match) {
    const normalized = `${match[1].toLowerCase()}-${
      match[2].toUpperCase()
    }` as Locale;
    if (ESBUILD_LOCALES.includes(normalized)) return normalized;
  }
  const primary = first.substring(0, 2).toLowerCase();
  if (primary === "zh") return "zh-CN";
  if (primary === "en") return "en-US";
  return DEFAULT_LOCALE;
}

/** 内部初始化，导入 i18n 时自动执行，不导出 */
function initEsbuildI18n(): void {
  if (esbuildI18n) return;
  const i18n = createI18n({
    defaultLocale: DEFAULT_LOCALE,
    fallbackBehavior: "default",
    locales: [...ESBUILD_LOCALES],
    translations: LOCALE_DATA as Record<string, TranslationData>,
  });
  i18n.setLocale(detectLocale());
  esbuildI18n = i18n;
}

initEsbuildI18n();

/**
 * Translate by key. Uses module instance; when lang is not passed, uses current locale.
 * When init not called, returns key.
 */
export function $tr(
  key: string,
  params?: Record<string, string | number>,
  lang?: Locale,
): string {
  if (!esbuildI18n) initEsbuildI18n();
  if (!esbuildI18n) return key;
  if (lang !== undefined) {
    const prev = esbuildI18n.getLocale();
    esbuildI18n.setLocale(lang);
    try {
      return esbuildI18n.t(key, params as TranslationParams);
    } finally {
      esbuildI18n.setLocale(prev);
    }
  }
  return esbuildI18n.t(key, params as TranslationParams);
}
