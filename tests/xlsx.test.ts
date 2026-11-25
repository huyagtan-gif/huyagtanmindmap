import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildXlsx } from "@/lib/xlsx";

/** ZIP-ийн төв лавлахаас файлуудыг уншина. */
function unzip(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(eocd).toBeGreaterThan(0);
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < n; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    expect(method).toBe(8);
    expect(buf.readUInt32LE(off)).toBe(0x04034b50);
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const data = inflateRawSync(buf.subarray(start, start + csize));
    expect(data.length).toBe(usize);
    out.set(name, data.toString("utf8"));
    p += 46 + nlen;
  }
  return out;
}

describe("Excel экспорт (P2.6)", () => {
  it("хүчинтэй xlsx бүтэц үүсгэнэ, кирилл болон тусгай тэмдэгтийг зөв бичнэ", () => {
    const buf = buildXlsx("Хүмүүс", ["Нэр", "Утас", "Тэмдэглэл"], [
      ["Ганзориг", "+97699110000", "A & B <tag> \"q\""],
      ["Сарнай", null, "=SUM(A1:A9)"],
      ["Номин", undefined, "мөр\nшилжсэн\u0001"],
    ]);
    expect(buf.subarray(0, 2).toString()).toBe("PK");
    const files = unzip(buf);
    expect([...files.keys()].sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"]);
    const sheet = files.get("xl/worksheets/sheet1.xml")!;
    expect(sheet).toContain("<t xml:space=\"preserve\">Ганзориг</t>");
    expect(sheet).toContain("A &amp; B &lt;tag&gt; &quot;q&quot;");
    // Томьёо шиг харагдах утга бичвэр хэвээр үлдэнэ (inline string): Excel тооцоолохгүй.
    expect(sheet).toContain("t=\"inlineStr\"><is><t xml:space=\"preserve\">=SUM(A1:A9)</t>");
    expect(sheet).not.toContain("<f>");
    expect(sheet).not.toContain("\u0001");
    expect(sheet).toContain('<c r="C4"');
    expect(sheet).not.toContain('<c r="B3"'); // хоосон нүд бичигдэхгүй
    expect(files.get("xl/workbook.xml")).toContain('name="Хүмүүс"');
  });
});
