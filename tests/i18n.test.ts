import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { makeT } from "../lib/i18n-core";
import { EN } from "../lib/i18n-en";
import { sourceKeys } from "../scripts/i18n-keys.mjs";

const cyr = (s: string) => /[Ѐ-ӿ]/.test(s);
const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("i18n (D13)", () => {
  const keys = [...(sourceKeys() as Set<string>)].filter(cyr);

  it("эх кодын бүх орчуулах мөр англи тольд байна", () => {
    expect(keys.length).toBeGreaterThan(150);
    expect(keys.filter((k) => !(k in EN))).toEqual([]);
  });

  it("төлбөрийн төлвийн нэрс (PAY_STATE, PAYMENT_STATE) тольд байна", () => {
    const src = readFileSync("lib/training.ts", "utf8").match(/PAY_STATE[^\n]+/)![0] + readFileSync("lib/payments.ts", "utf8").match(/PAYMENT_STATE[\s\S]+?\};/)![0];
    const labels = [...src.matchAll(/\["\w*", "([^"]+)"\]/g)].map((m) => m[1]);
    expect(labels.length).toBeGreaterThan(5);
    expect(labels.filter((l) => !(l in EN))).toEqual([]);
  });

  it("орчуулга монгол үсэггүй, {хувьсагч} нь эхтэйгээ таарна", () => {
    for (const [k, v] of Object.entries(EN)) {
      expect(cyr(v), k).toBe(false);
      expect(vars(v), k).toEqual(vars(k));
    }
  });

  it("t(): орчуулж, хувьсагч орлуулж, олдохгүй бол монголоор үлдээнэ", () => {
    const en = makeT("en"), mn = makeT("mn");
    expect(en("Нэвтрэх")).toBe("Sign in");
    expect(en("QPay-ээр {amount} төлөх", { amount: "5’000₮" })).toBe("Pay 5’000₮ with QPay");
    expect(mn("QPay-ээр {amount} төлөх", { amount: "5’000₮" })).toBe("QPay-ээр 5’000₮ төлөх");
    expect(en("Орчуулаагүй шинэ мөр")).toBe("Орчуулаагүй шинэ мөр");
    expect(en.lang).toBe("en");
    expect(en.rich("Сайн байна уу, {name}.", { name: "Бат" })).toBeTruthy();
  });
});
