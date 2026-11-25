// Эх кодоос орчуулах мөрүүдийг (t("…"), t.rich("…"), tr(…), N("…"), tMeta("…")) цуглуулна.
// Хэрэглээ: node scripts/i18n-keys.mjs [--missing]  — --missing: lib/i18n-en.ts-д байхгүйг л хэвлэнэ.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["app", "components", "lib"];
const RE = /\b(?:t|tr|N|tMeta)(?:\.rich)?\(\s*"((?:[^"\\]|\\.)*)"/g;
const COND = /\b(?:t|tr)\(\s*[\w.!?\s=&|"]+\?\s*"((?:[^"\\]|\\.)*)"\s*:\s*(?:[\w.\s=?"]+\?\s*"((?:[^"\\]|\\.)*)"\s*:\s*)?"((?:[^"\\]|\\.)*)"\s*\)/g;

export function sourceKeys(root = process.cwd()) {
  const keys = new Set();
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f) && !/i18n-(?:en|core)\.ts$/.test(f)) {
        const s = readFileSync(p, "utf8");
        if (!/lib\/i18n|\.\/i18n|i18n-core/.test(s) && !/\bN\(/.test(s)) continue;
        for (const m of s.matchAll(RE)) keys.add(JSON.parse(`"${m[1]}"`));
        for (const m of s.matchAll(COND)) for (const g of m.slice(1)) if (g !== undefined) keys.add(JSON.parse(`"${g}"`));
      }
    }
  };
  for (const r of ROOTS) walk(join(root, r));
  return keys;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const keys = [...sourceKeys()].filter((k) => /[Ѐ-ӿ]/.test(k));
  let out = keys;
  if (process.argv.includes("--missing")) {
    const en = readFileSync("lib/i18n-en.ts", "utf8");
    out = keys.filter((k) => !en.includes(JSON.stringify(k)));
  }
  console.log(out.map((k) => JSON.stringify(k)).join("\n"));
  console.error(`${out.length} / ${keys.length}`);
}
