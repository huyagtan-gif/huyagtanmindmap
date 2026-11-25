// i18n-ийн цэвэр хэсэг (сервер/клиент, тестэд ашиглагдана). Монгол мөр нь өөрөө түлхүүр (gettext маяг):
// орчуулга олдохгүй бол монголоороо харагдана. Шинэ хэл нэмэхдээ LANGS-д нэмж, lib/i18n-<код>.ts толь үүсгэнэ.
import { createElement, Fragment, type ReactNode } from "react";
import { EN } from "./i18n-en";

export const LANGS = [{ code: "mn", name: "Монгол" }, { code: "en", name: "English" }] as const;
export type Lang = (typeof LANGS)[number]["code"];
const DICT: Record<Lang, Record<string, string> | null> = { mn: null, en: EN };

export type T = ((s: string, vars?: Record<string, string | number>) => string) & {
  /** Мөрөнд JSX (холбоос гэх мэт) суулгах: t.rich("… {link} …", { link: <Link/> }) */
  rich: (s: string, parts: Record<string, ReactNode>) => ReactNode;
  lang: Lang;
};

/** Орчуулах мөрийг тэмдэглэх (gettext_noop): ERR/MSG газрын зургийн утгад. Ашиглахдаа t(ERR[k]). */
export const N = (s: string) => s;

export function makeT(lang: Lang): T {
  const dict = DICT[lang];
  const fn = ((s: string, vars?: Record<string, string | number>) => {
    let out = dict?.[s] ?? s;
    if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
    return out;
  }) as T;
  fn.rich = (s, parts) => {
    const pieces = (dict?.[s] ?? s).split(/\{(\w+)\}/);
    return createElement(Fragment, null, ...pieces.map((p, i) => (i % 2 ? (parts[p] ?? `{${p}}`) : p)));
  };
  fn.lang = lang;
  return fn;
}
export const isLang = (c: string | undefined): c is Lang => LANGS.some((l) => l.code === c);
