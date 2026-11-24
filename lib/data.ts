import type { Q } from "./db";
import { projectPeople, projectPerson, type PersonRow, type ProjectedPerson, type ViewerLike } from "./project";

export type Status = { id: string; name: string; pal: number; shape: string; description: string | null; sort: number; active: boolean };
export type Lookup = { id: string; name: string; sort: number; active: boolean };
export type Era = Lookup & { color: string | null };
export type OngodNode = {
  id: string; parent_id: string | null; name: string; era_id: string | null; title: string | null; note: string | null;
  kind: "group" | "ongod"; needs_review: boolean; sort: number;
};
export type Lookups = {
  statuses: Status[]; eras: Era[]; knowledge: Lookup[]; huyagTypes: Lookup[];
  relationTypes: (Lookup & { key: string | null })[]; deedes: (Lookup & { description: string | null })[];
  roles: { id: string; name: string; sort: number; is_system: boolean }[];
};

export async function loadLookups(q: Q): Promise<Lookups> {
  const [statuses, eras, knowledge, huyagTypes, relationTypes, deedes, roles] = await Promise.all([
    q<Status>("SELECT * FROM status ORDER BY sort, name"),
    q<Era>("SELECT * FROM era ORDER BY sort, name"),
    q<Lookup>("SELECT * FROM knowledge_level ORDER BY sort, name"),
    q<Lookup>("SELECT * FROM huyag_type ORDER BY sort, name"),
    q<any>("SELECT * FROM relation_type ORDER BY sort, name"),
    q<any>("SELECT d.* FROM deedes d JOIN urguu_deedes ud ON ud.deedes_id = d.id ORDER BY d.sort, d.name"),
    q<any>("SELECT id, name, sort, is_system FROM role ORDER BY sort, name"),
  ]);
  return { statuses, eras, knowledge, huyagTypes, relationTypes, deedes, roles };
}

export const loadOngods = (q: Q) =>
  q<OngodNode>("SELECT id, parent_id, name, era_id, title, note, kind, needs_review, sort FROM ongod ORDER BY sort, name");

/** Онгодын бүтэн зам: "Их Монгол › Хатад › Бялхавч хатан" */
export function ongodPaths(nodes: OngodNode[]): Map<string, string> {
  const by = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, string>();
  for (const n of nodes) {
    const parts: string[] = [];
    let c: OngodNode | undefined = n;
    let guard = 0;
    while (c && guard++ < 50) {
      parts.unshift(c.name);
      c = c.parent_id ? by.get(c.parent_id) : undefined;
    }
    out.set(n.id, parts.join(" › "));
  }
  return out;
}

export function ongodEra(nodes: OngodNode[], id: string): string | null {
  const by = new Map(nodes.map((n) => [n.id, n]));
  let c = by.get(id);
  let guard = 0;
  while (c && guard++ < 50) {
    if (c.era_id) return c.era_id;
    c = c.parent_id ? by.get(c.parent_id) : undefined;
  }
  return null;
}

const PERSON_SQL = `
  SELECT p.id, p.clan_name, p.father_name, p.given_name, p.ongod_nickname, p.ulaach_name, p.status_id, p.knowledge_level_id,
         p.field_training, p.sutra, p.info_source, p.comment, p.suggestion, p.teacher_note, p.huyag_today, p.is_registered, p.created_at::text,
         pp.phone, pp.email, pp.facebook,
         h.met_teacher_on::text, h.huyag_on::text, h.huyag_type_id, h.note AS huyag_note,
         r.name AS role_name, m.state AS membership_state
  FROM person p
  LEFT JOIN person_private pp ON pp.person_id = p.id
  LEFT JOIN huyag h ON h.person_id = p.id
  LEFT JOIN membership m ON m.person_id = p.id AND m.urguu_id = app_urguu()
  LEFT JOIN role r ON r.id = m.role_id
  WHERE p.merged_into_id IS NULL`;

/** Өргөөний хүмүүс: батлагдсан гишүүд + энэ өргөөнд нэрээр дурдагдсан бүртгэлгүй хүмүүс. Эрхээр шүүсэн. */
export async function loadPeople(q: Q, viewer: ViewerLike, opts: { registeredOnly?: boolean } = {}): Promise<ProjectedPerson[]> {
  const rows = await q<PersonRow>(
    `${PERSON_SQL} AND (m.state = 'approved' OR (m.id IS NULL AND NOT p.is_registered AND p.created_urguu_id = app_urguu()))
     ${opts.registeredOnly ? "AND p.is_registered" : ""}
     ORDER BY p.given_name`,
  );
  return projectPeople(rows, viewer);
}

export async function loadPerson(q: Q, viewer: ViewerLike, id: string): Promise<ProjectedPerson | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await q<PersonRow>(`${PERSON_SQL} AND p.id = $1`, [id]);
  return row ? projectPerson(row, viewer) : null;
}

export type Link = { person_id: string; other_id: string };
export async function loadPersonLinks(q: Q) {
  const [po, pd, rel] = await Promise.all([
    q<{ person_id: string; ongod_id: string; is_primary: boolean }>("SELECT person_id, ongod_id, is_primary FROM person_ongod ORDER BY is_primary DESC, sort"),
    q<{ person_id: string; deedes_id: string }>("SELECT person_id, deedes_id FROM person_deedes"),
    q<{ from_person_id: string; to_person_id: string; type_id: string; key: string | null }>(
      "SELECT r.from_person_id, r.to_person_id, r.type_id, t.key FROM relation r JOIN relation_type t ON t.id = r.type_id"),
  ]);
  return { po, pd, rel };
}

export function groupBy<T>(arr: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const a of arr) {
    const k = key(a);
    const l = m.get(k);
    if (l) l.push(a);
    else m.set(k, [a]);
  }
  return m;
}
