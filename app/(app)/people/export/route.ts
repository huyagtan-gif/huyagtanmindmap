import { loadPeopleList } from "@/lib/people-list";
import { asViewer, getViewer } from "@/lib/viewer";
import { buildXlsx } from "@/lib/xlsx";

export const dynamic = "force-dynamic";

const cell = (v: unknown) => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // spreadsheet formula injection-оос сэргийлнэ
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** P1.13 / P2.6: CSV эсвэл Excel (?format=xlsx) экспорт (export.csv эрхтэй түвшинд). Багана бүр талбарын эрхээр шүүгдэнэ. */
export async function GET(req: Request) {
  const v = await getViewer();
  if (!v || v.membershipState !== "approved" || !v.perms.has("export.csv") || !v.perms.has("person.view")) return new Response("Forbidden", { status: 403 });
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const { rows, lk } = await asViewer(v, (q) => loadPeopleList(q, v, sp));
  const st = new Map(lk.statuses.map((s) => [s.id, s.name]));
  const kn = new Map(lk.knowledge.map((s) => [s.id, s.name]));
  const ht = new Map(lk.huyagTypes.map((s) => [s.id, s.name]));
  const cols: [string, (r: (typeof rows)[number]) => unknown, string?][] = [
    ["Ургийн овог", (r) => r.clan_name], ["Эцгийн нэр", (r) => r.father_name], ["Өөрийн нэр", (r) => r.given_name],
    ["Төлөв", (r) => st.get(r.status_id || "")], ["Түвшин", (r) => r.role_name],
    ["Эрэмбийн онгод", (r) => r.ongodNames.join("; ")], ["Онгодын дууддаг нэр", (r) => r.ongod_nickname],
    ["Улаачийн тэнгэрийн алдар", (r) => r.ulaach_name, "ulaach"],
    ["Хуягласан дээдэс", (r) => r.deedesNames.join("; ")],
    ["Багштай золгосон", (r) => r.met_teacher_on, "huyag_dates"], ["Хуяглуулсан", (r) => r.huyag_on, "huyag_dates"],
    ["Хуягийн төрөл", (r) => ht.get(r.huyag_type_id || "")], ["Түшсэн", (r) => r.supporters.join("; ")],
    ["Мэдлэг", (r) => kn.get(r.knowledge_level_id || ""), "knowledge"],
    ["Утас", (r) => r.phone, "phone"], ["Имэйл", (r) => r.email, "email"], ["Фэйсбүүк", (r) => r.facebook, "facebook"],
    ["Сэтгэгдэл", (r) => r.comment, "comment"], ["Санал", (r) => r.suggestion, "suggestion"],
  ];
  const use = cols.filter(([, , gate]) => !gate || v.fields.has(gate));
  const day = new Date().toISOString().slice(0, 10);
  if (sp.format === "xlsx") {
    const buf = buildXlsx("Хүмүүс", use.map(([h]) => h), rows.map((r) => use.map(([, f]) => f(r))));
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="huyagtan-${day}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  }
  const csv = [use.map(([h]) => cell(h)).join(","), ...rows.map((r) => use.map(([, f]) => cell(f(r))).join(","))].join("\r\n");
  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="huyagtan-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
