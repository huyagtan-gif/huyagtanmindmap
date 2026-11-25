import type { Q } from "./db";
import { capFirst, normPerson, splitName } from "./norm";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Нэрээр дурдагдсан хүнийг олох эсвэл "бүртгэлгүй хүн" болгон үүсгэх (P1.6, §11.3).
 * Эхлээд alias-ийн нормчилсон түлхүүрээр, дараа нь өөрийн нэрээр хайна.
 */
export async function findOrCreateNamed(q: Q, urguuId: string, raw: string, opts: { createIfMissing?: boolean } = { createIfMissing: true }): Promise<{ id: string; created: boolean } | null> {
  const text = raw.trim().replace(/\s+/g, " ").slice(0, 120);
  const norm = normPerson(text);
  if (!norm) return null;
  const [a] = await q<{ person_id: string }>(
    `SELECT coalesce(p.merged_into_id, p.id) AS person_id FROM person_alias pa JOIN person p ON p.id = pa.person_id WHERE pa.norm = $1 LIMIT 1`, [norm]);
  if (a) return { id: a.person_id, created: false };
  // Нормчилсон өөрийн нэр таарах хүн (ганц байвал)
  const cands = await q<{ id: string; father_name: string | null; given_name: string }>(
    "SELECT id, father_name, given_name FROM person WHERE merged_into_id IS NULL");
  const { father } = splitName(text);
  let hits = cands.filter((c) => normPerson(c.given_name) === norm || normPerson(`${c.father_name || ""} ${c.given_name}`) === normPerson(text.replace(/\./g, " ")));
  if (hits.length > 1 && father) {
    const f = hits.filter((c) => (c.father_name || "")[0]?.toLowerCase() === father[0].toLowerCase());
    if (f.length) hits = f;
  }
  if (hits.length === 1) {
    await q("INSERT INTO person_alias (person_id, alias, norm) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [hits[0].id, text, norm]);
    return { id: hits[0].id, created: false };
  }
  if (!opts.createIfMissing) return null;
  const sp = splitName(text);
  const [p] = await q<{ id: string }>(
    "INSERT INTO person (father_name, given_name, is_registered, created_urguu_id) VALUES ($1,$2,false,$3) RETURNING id",
    [sp.father, capFirst(sp.given), urguuId],
  );
  await q("INSERT INTO person_alias (person_id, alias, norm) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [p.id, text, norm]);
  return { id: p.id, created: true };
}

/** Хүний өөрийн нэрийг alias болгон хадгална (хайлт, тулгалтад). */
export async function syncOwnAlias(q: Q, personId: string, father: string | null, given: string) {
  const full = [father, given].filter(Boolean).join(" ");
  for (const a of new Set([given, full])) {
    const n = normPerson(a);
    if (n) await q("INSERT INTO person_alias (person_id, alias, norm) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [personId, a, n]);
  }
}

/**
 * Хоёр хүний бүртгэлийг нэгтгэнэ (нэр нэгтгэл, §11.3): `fromId`-ийн бүх холбоос `intoId` руу шилжиж,
 * from нь merged_into_id-аар тэмдэглэгдэнэ (устгахгүй — audit-д үлдэнэ).
 */
export async function mergePersons(q: Q, fromId: string, intoId: string) {
  if (fromId === intoId) return;
  await q("UPDATE relation r SET from_person_id = $2 WHERE from_person_id = $1 AND NOT EXISTS (SELECT 1 FROM relation x WHERE x.from_person_id = $2 AND x.to_person_id = r.to_person_id AND x.type_id = r.type_id)", [fromId, intoId]);
  await q("UPDATE relation r SET to_person_id = $2 WHERE to_person_id = $1 AND NOT EXISTS (SELECT 1 FROM relation x WHERE x.to_person_id = $2 AND x.from_person_id = r.from_person_id AND x.type_id = r.type_id)", [fromId, intoId]);
  await q("DELETE FROM relation WHERE from_person_id = $1 OR to_person_id = $1 OR from_person_id = to_person_id", [fromId]);
  await q("INSERT INTO person_ongod (person_id, ongod_id, is_primary, sort) SELECT $2, ongod_id, false, sort + 100 FROM person_ongod WHERE person_id = $1 ON CONFLICT DO NOTHING", [fromId, intoId]);
  await q("DELETE FROM person_ongod WHERE person_id = $1", [fromId]);
  await q("INSERT INTO person_deedes (person_id, deedes_id) SELECT $2, deedes_id FROM person_deedes WHERE person_id = $1 ON CONFLICT DO NOTHING", [fromId, intoId]);
  await q("DELETE FROM person_deedes WHERE person_id = $1", [fromId]);
  await q("UPDATE person_alias a SET person_id = $2 WHERE person_id = $1 AND NOT EXISTS (SELECT 1 FROM person_alias x WHERE x.person_id = $2 AND x.norm = a.norm)", [fromId, intoId]);
  await q("DELETE FROM person_alias WHERE person_id = $1", [fromId]);
  await q("UPDATE import_issue SET person_id = $2 WHERE person_id = $1", [fromId, intoId]);
  await q("UPDATE person SET merged_into_id = $2 WHERE id = $1", [fromId, intoId]);
}
