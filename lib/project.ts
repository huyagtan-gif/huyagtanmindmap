import type { FieldKey } from "./fields";

/** DB-ээс уншсан хүний бүрэн мөр (нууц талбартай). Клиент рүү ХЭЗЭЭ Ч шууд явуулахгүй. */
export type PersonRow = {
  id: string;
  clan_name: string | null;
  father_name: string | null;
  given_name: string;
  ongod_nickname: string | null;
  ulaach_name: string | null;
  status_id: string | null;
  knowledge_level_id: string | null;
  field_training: boolean | null;
  sutra: boolean | null;
  info_source: string | null;
  comment: string | null;
  suggestion: string | null;
  teacher_note: string | null;
  huyag_today: string | null;
  is_registered: boolean;
  phone: string | null;
  email: string | null;
  facebook: string | null;
  met_teacher_on: string | null;
  huyag_on: string | null;
  huyag_type_id: string | null;
  huyag_note: string | null;
  role_name?: string | null;
  membership_state?: string | null;
  created_at?: string | null;
};

export type ViewerLike = { personId: string | null; fields: ReadonlySet<string> };

/** Талбар → шаардагдах эрхийн түлхүүр. Энд байхгүй талбар батлагдсан гишүүн бүрт харагдана. */
export const FIELD_GATE: Record<string, FieldKey> = {
  phone: "phone",
  email: "email",
  facebook: "facebook",
  teacher_note: "teacher_note",
  comment: "comment",
  suggestion: "suggestion",
  ulaach_name: "ulaach",
  knowledge_level_id: "knowledge",
  met_teacher_on: "huyag_dates",
  huyag_on: "huyag_dates",
};

export type ProjectedPerson = Partial<PersonRow> & {
  id: string;
  given_name: string;
  name: string;
  is_self: boolean;
  /** Эрхгүйгээс нуугдсан талбарууд. UI-д "Нууцлагдсан" гэж харуулна. */
  hidden: string[];
};

export function displayName(p: { father_name?: string | null; given_name: string }): string {
  const f = (p.father_name || "").trim();
  return (f ? f[0].toUpperCase() + "." : "") + p.given_name;
}

/**
 * A1: ТАЛБАРЫН ШҮҮЛТ — НЭГ ГАЗАР. Хүний мэдээллийг үзэгчийн эрхээр шүүж буцаана.
 * Эрхгүй талбарын утга хариуд огт орохгүй (null ч биш, түлхүүр нь байхгүй), зөвхөн `hidden` жагсаалтад нэр нь орно.
 * Хүн өөрийн бүх мэдээллийг үргэлж харна (D14).
 */
export function projectPerson(row: PersonRow, viewer: ViewerLike): ProjectedPerson {
  const isSelf = !!viewer.personId && viewer.personId === row.id;
  const out: Record<string, unknown> = {};
  const hidden: string[] = [];
  for (const [k, v] of Object.entries(row)) {
    const gate = FIELD_GATE[k];
    if (gate && !isSelf && !viewer.fields.has(gate)) {
      hidden.push(k);
      continue;
    }
    out[k] = v;
  }
  out.name = displayName(row);
  out.is_self = isSelf;
  out.hidden = hidden;
  return out as ProjectedPerson;
}

export function projectPeople(rows: PersonRow[], viewer: ViewerLike): ProjectedPerson[] {
  return rows.map((r) => projectPerson(r, viewer));
}
