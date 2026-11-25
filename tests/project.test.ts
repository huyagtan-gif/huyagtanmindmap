import { describe, expect, it } from "vitest";
import { FIELD_GATE, projectPerson, type PersonRow } from "@/lib/project";

// N10: нууц талбар задрахгүйг баталгаажуулах тест.
const row: PersonRow = {
  id: "11111111-1111-1111-1111-111111111111",
  clan_name: "Овог", father_name: "Эцэг", given_name: "Нэр", ongod_nickname: "хоч", ulaach_name: "УЛААЧ-НУУЦ",
  status_id: "s", knowledge_level_id: "МЭДЛЭГ-НУУЦ", field_training: true, sutra: false, info_source: "x",
  comment: "СЭТГЭГДЭЛ-НУУЦ", suggestion: "САНАЛ-НУУЦ", teacher_note: "БАГШ-НУУЦ", huyag_today: null, is_registered: true,
  phone: "+97699000000", email: "secret@example.com", facebook: "https://facebook.com/secret",
  met_teacher_on: "2024-01-01", huyag_on: "2024-02-02", huyag_type_id: "t", huyag_note: null,
};
const viewer = (fields: string[], personId = "someone-else") => ({ personId, fields: new Set(fields) });
const MEMBER = ["ulaach", "knowledge", "huyag_dates"];
const TEACHER = [...MEMBER, "teacher_note", "comment", "suggestion"];
const ADMIN = [...TEACHER, "phone", "email", "facebook", "donation"];

describe("projectPerson: талбарын шүүлт", () => {
  it("Гишүүн: утас, имэйл, FB хариуд ОГТ байхгүй (P1.11)", () => {
    const p = projectPerson(row, viewer(MEMBER));
    const json = JSON.stringify(p);
    for (const k of ["phone", "email", "facebook", "comment", "suggestion", "teacher_note"]) expect(k in p).toBe(false);
    for (const secret of ["99000000", "secret@example.com", "facebook.com/secret", "СЭТГЭГДЭЛ-НУУЦ", "САНАЛ-НУУЦ", "БАГШ-НУУЦ"]) expect(json).not.toContain(secret);
    expect(p.hidden).toEqual(expect.arrayContaining(["phone", "email", "facebook", "comment", "suggestion", "teacher_note"]));
    expect(p.huyag_on).toBe("2024-02-02");
    expect(p.ulaach_name).toBe("УЛААЧ-НУУЦ");
  });

  it("Багш: тэмдэглэл, сэтгэгдэл харна, холбоо барих мэдээлэл харахгүй", () => {
    const p = projectPerson(row, viewer(TEACHER));
    expect(p.comment).toBe("СЭТГЭГДЭЛ-НУУЦ");
    expect(p.teacher_note).toBe("БАГШ-НУУЦ");
    expect(JSON.stringify(p)).not.toMatch(/99000000|secret@example\.com|facebook\.com/);
  });

  it("Админ: бүгдийг харна", () => {
    const p = projectPerson(row, viewer(ADMIN));
    expect(p.hidden).toEqual([]);
    expect(p.phone).toBe("+97699000000");
  });

  it("Ямар ч эрхгүй түвшин: gate-тэй талбар нэг ч гарахгүй", () => {
    const p = projectPerson(row, viewer([]));
    for (const k of Object.keys(FIELD_GATE)) expect(k in p).toBe(false);
    expect(p.hidden.sort()).toEqual(Object.keys(FIELD_GATE).sort());
    expect(p.name).toBe("Э.Нэр");
  });

  it("Хүн өөрийн бүх мэдээллийг үргэлж харна (D14)", () => {
    const p = projectPerson(row, viewer([], row.id));
    expect(p.hidden).toEqual([]);
    expect(p.email).toBe("secret@example.com");
    expect(p.is_self).toBe(true);
  });

  it("Нууц талбар бүр gate-тэй (шинэ нууц багана нэмэхэд тест унана)", () => {
    for (const k of ["phone", "email", "facebook", "teacher_note", "comment", "suggestion"]) expect(FIELD_GATE[k]).toBeTruthy();
  });
});
