import { sys, withCtx, type Q } from "./db";
import { loadPeople } from "./data";
import type { ProjectedPerson } from "./project";
import type { Viewer } from "./viewer";

export type UrguuRow = { id: string; name: string; description: string | null; state: "active" | "closed"; created_at: Date };

/**
 * P2.4: шинэ өргөө үүсгэнэ. Загвар өргөөнөөс түвшин, үйлдлийн эрх, харагдац, талбарын эрх, дээдсийн жагсаалтыг хуулна.
 * ongodFromId өгвөл тэр өргөөний онгодын модыг (хянагдаагүй зангилаагүйгээр) загвар болгон хуулна. Хүмүүс хуулагдахгүй.
 * Системийн транзакц (sysTx) дотор дуудна.
 */
export async function createUrguu(q: Q, o: { name: string; description: string | null; templateId: string; ongodFromId: string | null }): Promise<string> {
  const [u] = await q<{ id: string }>("INSERT INTO urguu (name, description) VALUES ($1, $2) RETURNING id", [o.name, o.description]);
  const roles = await q<{ id: string; name: string; sort: number; is_system: boolean }>("SELECT id, name, sort, is_system FROM role WHERE urguu_id = $1 ORDER BY sort, name", [o.templateId]);
  if (!roles.some((r) => r.is_system)) roles.unshift({ id: "", name: "Супер админ", sort: 0, is_system: true });
  for (const r of roles) {
    const [n] = await q<{ id: string }>("INSERT INTO role (urguu_id, name, sort, is_system) VALUES ($1,$2,$3,$4) RETURNING id", [u.id, r.name, r.sort, r.is_system]);
    if (!r.id) continue;
    await q("INSERT INTO permission (role_id, urguu_id, key) SELECT $1, $2, key FROM permission WHERE role_id = $3", [n.id, u.id, r.id]);
    await q("INSERT INTO role_view (role_id, urguu_id, view) SELECT $1, $2, view FROM role_view WHERE role_id = $3", [n.id, u.id, r.id]);
    await q("INSERT INTO field_permission (urguu_id, field_key, role_id) SELECT $2, field_key, $1 FROM field_permission WHERE role_id = $3", [n.id, u.id, r.id]);
  }
  await q("INSERT INTO urguu_deedes (urguu_id, deedes_id) SELECT $1, deedes_id FROM urguu_deedes WHERE urguu_id = $2", [u.id, o.templateId]);
  if (o.ongodFromId)
    await q(
      `WITH src AS MATERIALIZED (SELECT id, gen_random_uuid() AS nid FROM ongod WHERE urguu_id = $2 AND NOT needs_review)
       INSERT INTO ongod (id, urguu_id, parent_id, name, era_id, title, note, kind, sort)
       SELECT s.nid, $1, ps.nid, o.name, o.era_id, o.title, o.note, o.kind, o.sort
       FROM ongod o JOIN src s ON s.id = o.id LEFT JOIN src ps ON ps.id = o.parent_id`,
      [u.id, o.ongodFromId],
    );
  // Платформын супер админууд шинэ өргөөнд системийн түвшнээр шууд гишүүн болно.
  await q(
    `INSERT INTO membership (person_id, urguu_id, role_id, state, decided_at)
     SELECT us.person_id, $1, r.id, 'approved', now() FROM users us, role r
     WHERE us.is_platform_admin AND us.person_id IS NOT NULL AND r.urguu_id = $1 AND r.is_system
     ON CONFLICT (person_id, urguu_id) DO NOTHING`,
    [u.id],
  );
  return u.id;
}

/**
 * P2.5: үзэгчид харагдах өргөөнүүд: өөрийн өргөө + өөрийн өргөөнд харах эрх олгосон өргөөнүүд.
 * Платформын супер админд бүх идэвхтэй өргөө.
 */
export async function visibleUrguus(v: Viewer): Promise<{ id: string; name: string; own: boolean }[]> {
  if (!v.urguu) return [];
  const rows = await sys<{ id: string; name: string }>(
    v.isPlatformAdmin && !v.viewAs
      ? "SELECT id, name FROM urguu WHERE state = 'active' ORDER BY created_at"
      : `SELECT u.id, u.name FROM urguu u
         WHERE u.state = 'active' AND (u.id = $1 OR EXISTS (SELECT 1 FROM cross_urguu_grant g WHERE g.owner_urguu_id = u.id AND g.grantee_urguu_id = $1))
         ORDER BY u.created_at`,
    v.isPlatformAdmin && !v.viewAs ? [] : [v.urguu.id],
  );
  return rows.map((r) => ({ ...r, own: r.id === v.urguu!.id })).sort((a, b) => Number(b.own) - Number(a.own));
}

export type WorldPerson = { id: string; name: string; status_id: string | null; clan_name: string | null; urguus: string[]; ongods: string[]; own: boolean; search: string };

/**
 * P2.5 «Дэлхийн үрс»: харагдах бүх өргөөний бүртгэлтэй хүмүүс, хүн давхардалгүй (хүн платформ даяар нэг мөр, D37).
 * Өргөө бүрийг тухайн өргөөний RLS контекстоор уншина. Өөр өргөөний хүнд талбарын эрх ХООСОН: зөвхөн нийтэд нээлттэй талбар.
 */
export async function loadWorld(v: Viewer): Promise<{ urguus: { id: string; name: string; own: boolean; count: number }[]; people: WorldPerson[] }> {
  const us = await visibleUrguus(v);
  const by = new Map<string, WorldPerson>();
  const out: { id: string; name: string; own: boolean; count: number }[] = [];
  for (const u of us) {
    const { people, po } = await withCtx({ userId: v.userId, personId: v.personId, urguuId: u.id }, async (q) => ({
      people: (await loadPeople(q, { personId: v.personId, fields: u.own ? v.fields : new Set<string>() }, { registeredOnly: true })) as ProjectedPerson[],
      po: await q<{ person_id: string; name: string }>("SELECT po.person_id, o.name FROM person_ongod po JOIN ongod o ON o.id = po.ongod_id ORDER BY po.is_primary DESC, po.sort"),
    }));
    out.push({ ...u, count: people.length });
    for (const p of people) {
      let w = by.get(p.id);
      if (!w) by.set(p.id, (w = { id: p.id, name: p.name, status_id: p.status_id ?? null, clan_name: p.clan_name ?? null, urguus: [], ongods: [], own: false, search: "" }));
      w.urguus.push(u.name);
      w.own ||= u.own;
    }
    for (const x of po) {
      const w = by.get(x.person_id);
      if (w && !w.ongods.includes(x.name)) w.ongods.push(x.name);
    }
  }
  const people = [...by.values()].sort((a, b) => a.name.localeCompare(b.name, "mn"));
  for (const p of people) p.search = [p.name, p.clan_name, ...p.ongods, ...p.urguus].filter(Boolean).join(" ").toLowerCase();
  return { urguus: out, people };
}
