import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv";
import { isNone, mapEra, parseTimestamp, rowsFromCsv, splitNames } from "@/lib/import";
import { capWords, normOngod, normPerson, normPhone, parseUsDate, similar, splitName } from "@/lib/norm";

describe("нэр нормчлол (§11.3)", () => {
  it("нэг хүний хувилбарууд ижил түлхүүртэй", () => {
    const k = normPerson("Ганзориг");
    for (const v of ["Э.Ганзориг", "Ганзориг багш", "Э.Ганзориг багш", "ганзориг"]) expect(normPerson(v)).toBe(k);
    expect(normPerson("Нар Сар")).toBe(normPerson("Нарсар"));
    expect(normPerson("Nar Sar")).toBe(normPerson("Нарсар багш"));
    expect(normPerson("Temuujin")).toBe(normPerson("Тэмүүжин"));
    expect(normPerson("Сарнай эмч")).toBe(normPerson("Б.Сарнай"));
  });
  it("төстэй нэрийг санал болгоно, өөр нэрийг үгүй", () => {
    expect(similar(normPerson("Номин"), normPerson("Номинцэг"))).toBe(true);
    expect(similar(normPerson("Номинцэг"), normPerson("Номинцэцэг"))).toBe(true);
    expect(similar(normPerson("Дорж"), normPerson("Сүхээ"))).toBe(false);
    expect(similar(normPerson("Бат"), normPerson("Батсайхан"))).toBe(false);
  });
  it("нэр задлах", () => {
    expect(splitName("Э.Ганзориг")).toEqual({ father: "Э", given: "Ганзориг" });
    expect(splitName("Тэмүүжин")).toEqual({ father: null, given: "Тэмүүжин" });
    expect(capWords("хуримт түшээ")).toBe("Хуримт Түшээ");
  });
});

describe("онгод тулгах (§11.2)", () => {
  it("дагавар салгаж тулгана", () => {
    expect(normOngod("Хубилай Сэцэн Хаан Дээдэс")).toBe(normOngod("Хубилай сэцэн хаан"));
    expect(normOngod("Урбатун хатан дээдэс")).toBe(normOngod("Урбатун хатан"));
    expect(normOngod("наяа жанжин")).toBe(normOngod("Наяа жанжин"));
    expect(normOngod("Тэмүлүн Хатан")).not.toBe(normOngod("Бялхавч хатан"));
  });
  it("цаг үе буулгах", () => {
    expect(mapEra("Их Юань гүрний үе")).toBe("Их Юань");
    expect(mapEra("Их Монгол Улсын үе")).toBe("Их Монгол");
    expect(mapEra("Бага Хаадын үе")).toBe("Бага хаад");
    expect(mapEra("Хүннү гүрний үе")).toBe("Хүннү");
    expect(mapEra("Эртний цаг үе")).toBe("Эртний");
    expect(mapEra("???")).toBe("Тодорхой бус");
  });
});

describe("утас, огноо (§11.1, §11.4)", () => {
  it("утас", () => {
    expect(normPhone("9911 2233")).toEqual({ value: "+97699112233", ok: true });
    expect(normPhone("+819012345678").ok).toBe(true);
    expect(normPhone("08039035709").ok).toBe(false);
  });
  it("огноо", () => {
    expect(parseUsDate("4/1/2024")).toBe("2024-04-01");
    expect(parseUsDate("12/18/2026")).toBe("2026-12-18");
    expect(parseUsDate("байхгүй")).toBeNull();
    expect(parseTimestamp("11/18/2026 10:15:53")).toBe("2026-11-18T10:15:53+08:00");
  });
});

describe("CSV", () => {
  it("хашилт, таслал, мөр дундын шинэ мөр", () => {
    expect(parseCsv('a,"b, c","d ""e"""\r\n1,"x\ny",3\n')).toEqual([["a", "b, c", 'd "e"'], ["1", "x\ny", "3"]]);
  });
  it("гарчгийн мөрийг алгасаж, баганыг байрлалаар нь уншина", () => {
    const head = Array.from({ length: 25 }, (_, i) => `h${i}`).join(",");
    const r = Array.from({ length: 25 }, (_, i) => (i === 0 ? "11/18/2026 10:15:53" : `v${i}`)).join(",");
    const rows = rowsFromCsv(`${head}\n${r}\n`);
    expect(rows).toHaveLength(1);
    expect(rows[0].given).toBe("v3");
    expect(rows[0].email).toBe("v24");
  });
  it("олон нэр, хоосон утга", () => {
    expect(splitNames("Э.Ганзориг, Б.Сарнай")).toEqual(["Э.Ганзориг", "Б.Сарнай"]);
    expect(splitNames("-")).toEqual([]);
    expect(isNone("Байхгүй")).toBe(true);
  });
});
