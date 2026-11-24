// audit_log мөрийг хүн уншихаар богино өгүүлбэр болгоно. Нууц талбарын УТГЫГ хэзээ ч оруулахгүй (зөвхөн юу өөрчлөгдсөн).
const ENTITY: Record<string, string> = {
  person: "Хүний мэдээлэл", person_private: "Хувийн мэдээлэл", person_alias: "Нэрийн хувилбар", huyag: "Хуягийн мэдээлэл",
  person_ongod: "Онгодын холбоос", person_deedes: "Дээдсийн холбоос", relation: "Хүн хоорондын холбоо", membership: "Гишүүнчлэл",
  ongod: "Онгодын мод", deedes: "Дээдэс", urguu_deedes: "Өргөөний дээдэс", role: "Түвшин", permission: "Эрх",
  field_permission: "Талбарын эрх", status: "Явцын төлөв", knowledge_level: "Мэдлэгийн түвшин", huyag_type: "Хуягийн төрөл",
  era: "Цаг үе", relation_type: "Холбооны төрөл", form_question: "Формын асуулт", form_answer: "Формын хариулт",
  invite: "Урилга", urguu: "Өргөө",
};
const ACTION: Record<string, string> = { insert: "нэмэгдсэн", update: "засагдсан", delete: "устгагдсан" };

export function auditText(r: { entity: string; action: string; before: any; after: any }): string {
  const e = ENTITY[r.entity] || r.entity;
  const a = ACTION[r.action] || r.action;
  const row = r.after || r.before || {};
  const label = row.given_name || row.name || row.text || row.alias || row.field_key || row.key || "";
  let changed = "";
  if (r.action === "update" && r.before && r.after) {
    const keys = Object.keys(r.after).filter((k) => k !== "updated_at" && JSON.stringify(r.after[k]) !== JSON.stringify(r.before[k]));
    if (keys.length) changed = ` (${keys.slice(0, 4).join(", ")}${keys.length > 4 ? "…" : ""})`;
  }
  return `${e}${label && r.entity !== "person_private" ? ` «${label}»` : ""} ${a}${changed}`;
}

export function fmtDateTime(d: Date | string): string {
  const x = typeof d === "string" ? new Date(d) : d;
  // Улаанбаатарын цагаар
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Ulaanbaatar", dateStyle: "short", timeStyle: "short" }).format(x);
}
