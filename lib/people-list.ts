import type { Q } from "./db";
import { groupBy, loadLookups, loadOngods, loadPeople, loadPersonLinks, ongodEra } from "./data";
import type { ProjectedPerson, ViewerLike } from "./project";

export type ListRow = ProjectedPerson & { ongodNames: string[]; ongodIds: string[]; eraIds: string[]; supporters: string[]; deedesNames: string[]; search: string };
export type ListFilter = { q?: string; st?: string; era?: string; ongod?: string; reg?: string; sort?: string; dir?: string };

/** P1.12 / P1.13: хүмүүсийн жагсаалт — хайлт (alias орно), шүүлт (онгод, төлөв, цаг үе), эрэмбэ. */
export async function loadPeopleList(q: Q, viewer: ViewerLike, f: ListFilter) {
  const [lk, ongods, people, links, aliases] = await Promise.all([
    loadLookups(q), loadOngods(q), loadPeople(q, viewer), loadPersonLinks(q),
    q<{ person_id: string; alias: string }>("SELECT person_id, alias FROM person_alias"),
  ]);
  const oBy = new Map(ongods.map((o) => [o.id, o]));
  const dBy = new Map(lk.deedes.map((d) => [d.id, d.name]));
  const po = groupBy(links.po, (x) => x.person_id);
  const pd = groupBy(links.pd, (x) => x.person_id);
  const rf = groupBy(links.rel, (x) => x.from_person_id);
  const al = groupBy(aliases, (x) => x.person_id);
  const nameBy = new Map(people.map((p) => [p.id, p.name]));
  let rows: ListRow[] = people.map((p) => {
    const oids = (po.get(p.id) || []).map((x) => x.ongod_id).filter((id) => oBy.has(id));
    const ongodNames = oids.map((id) => oBy.get(id)!.name);
    return {
      ...p,
      ongodIds: oids,
      ongodNames,
      eraIds: oids.map((id) => ongodEra(ongods, id)).filter(Boolean) as string[],
      supporters: (rf.get(p.id) || []).filter((r) => r.key === "supporter").map((r) => nameBy.get(r.to_person_id)).filter(Boolean) as string[],
      deedesNames: (pd.get(p.id) || []).map((x) => dBy.get(x.deedes_id)).filter(Boolean) as string[],
      search: [p.name, p.father_name, p.given_name, p.clan_name, ...ongodNames, ...(al.get(p.id) || []).map((a) => a.alias)].filter(Boolean).join(" ").toLowerCase(),
    };
  });
  const total = rows.length;
  const counts: Record<string, number> = {};
  for (const r of rows) if (r.status_id) counts[r.status_id] = (counts[r.status_id] || 0) + 1;
  const t = (f.q || "").trim().toLowerCase();
  if (t) rows = rows.filter((r) => r.search.includes(t));
  if (f.st) rows = rows.filter((r) => r.status_id === f.st);
  if (f.era) rows = rows.filter((r) => r.eraIds.includes(f.era!));
  if (f.ongod) rows = rows.filter((r) => r.ongodIds.includes(f.ongod!));
  if (f.reg === "0") rows = rows.filter((r) => !r.is_registered);
  else if (f.reg !== "all") rows = rows.filter((r) => r.is_registered);
  const stSort = new Map(lk.statuses.map((s) => [s.id, s.sort]));
  const keyFn: Record<string, (r: ListRow) => string | number> = {
    name: (r) => r.given_name.toLowerCase(),
    clan: (r) => (r.clan_name || "").toLowerCase(),
    status: (r) => stSort.get(r.status_id || "") ?? 999,
    ongod: (r) => (r.ongodNames[0] || "").toLowerCase(),
    huyag: (r) => r.huyag_on || "",
    created: (r) => r.created_at || "",
  };
  const kf = keyFn[f.sort || "name"] || keyFn.name;
  const dir = f.dir === "desc" ? -1 : 1;
  rows.sort((a, b) => {
    const x = kf(a), y = kf(b);
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "mn")) * dir;
  });
  return { rows, lk, ongods, total, counts };
}
