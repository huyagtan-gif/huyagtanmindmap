import { MapView, type MEvent, type MPerson } from "@/components/MapView";
import { auditText, fmtDateTime } from "@/lib/audit-text";
import { loadLookups, loadOngods, loadPeople, loadPersonLinks, groupBy } from "@/lib/data";
import { VIEWS, type ViewKey } from "@/lib/fields";
import { ubDay } from "@/lib/time";
import { asViewer, requirePerm } from "@/lib/viewer";

export const metadata = { title: "Mind map" };

export default async function MapPage({ searchParams }: { searchParams: Promise<{ view?: string; ego?: string; ev?: string }> }) {
  const v = await requirePerm("person.view");
  const sp = await searchParams;
  const d = await asViewer(v, async (q) => {
    const [lk, ongods, people, links, since, aliases, recent] = await Promise.all([
      loadLookups(q), loadOngods(q), loadPeople(q, v), loadPersonLinks(q),
      q<{ person_id: string; at: string }>("SELECT person_id, max(at)::text AS at FROM status_history GROUP BY person_id"),
      q<{ person_id: string; alias: string }>("SELECT person_id, alias FROM person_alias"),
      v.perms.has("audit.view")
        ? q<any>(`SELECT a.entity, a.action, a.before, a.after, a.at, p.given_name AS who FROM audit_log a LEFT JOIN person p ON p.id = a.actor_person_id
                  WHERE a.entity IN ('person','membership','ongod') ORDER BY a.id DESC LIMIT 5`)
        : Promise.resolve([]),
    ]);
    // P3.8 «Үйлээр» харагдац: сүүлийн үйлүүд ба оролцогчид (ирэх үйлд хариу өгсөн, болсон үйлд ирсэн хүмүүс).
    const evs = v.views.has("event")
      ? await q<{ id: string; name: string; starts_at: Date; parts: { pid: string; role: string | null }[] | null }>(
          `SELECT e.id, e.name, e.starts_at,
             (SELECT json_agg(json_build_object('pid', ep.person_id, 'role', r.name) ORDER BY r.sort NULLS LAST)
              FROM event_participant ep LEFT JOIN event_role r ON r.id = ep.role_id
              WHERE ep.event_id = e.id AND (CASE WHEN e.state = 'done' THEN ep.attended IS TRUE ELSE ep.rsvp <> 'no' END)) AS parts
           FROM event e WHERE e.state <> 'cancelled' ORDER BY e.starts_at DESC LIMIT 40`)
      : [];
    return { lk, ongods, people, links, since, aliases, recent, evs };
  });
  const dName = new Map(d.lk.deedes.map((x) => [x.id, x.name]));
  const po = groupBy(d.links.po, (x) => x.person_id);
  const pd = groupBy(d.links.pd, (x) => x.person_id);
  const relFrom = groupBy(d.links.rel, (x) => x.from_person_id);
  const relTo = groupBy(d.links.rel, (x) => x.to_person_id);
  const sinceBy = new Map(d.since.map((x) => [x.person_id, x.at]));
  const al = groupBy(d.aliases, (x) => x.person_id);
  const vis = new Set(d.people.map((p) => p.id));
  const people: MPerson[] = d.people.map((p) => {
    const rf = relFrom.get(p.id) || [];
    const rt = relTo.get(p.id) || [];
    const of = (k: string) => rf.filter((r) => r.key === k && vis.has(r.to_person_id)).map((r) => r.to_person_id);
    const n = (k: string) => rt.filter((r) => r.key === k).length;
    return {
      id: p.id, name: p.name, reg: !!p.is_registered, clan: p.clan_name ?? null, status_id: p.status_id ?? null,
      ongods: (po.get(p.id) || []).map((x) => x.ongod_id),
      deedes: (pd.get(p.id) || []).map((x) => dName.get(x.deedes_id)).filter(Boolean) as string[],
      supporters: of("supporter"), teachers: of("teacher"), introducers: of("introducer"),
      search: [p.name, p.father_name, p.given_name, p.clan_name, ...(al.get(p.id) || []).map((a) => a.alias)].filter(Boolean).join(" ").toLowerCase(),
      // Эрхгүй талбар projectPerson-оос огт ирэхгүй (undefined) → клиент рүү очихгүй.
      huyag_on: p.huyag_on, phone: p.phone, email: p.email, hidden: p.hidden,
      since: sinceBy.get(p.id) || p.created_at || null,
      nStudents: n("teacher"), nIntroduced: n("introducer"), nSupported: n("supporter"),
    };
  });
  // P2.2: түвшин бүрт зөвшөөрөгдсөн харагдац (role_view).
  const views = VIEWS.map((x) => x.key).filter((k) => v.views.has(k)) as ViewKey[];
  const initialView = views.includes(sp.view as ViewKey) ? (sp.view as ViewKey) : views[0] ?? "tree";
  return (
    <MapView
      urguuName={v.urguu.name}
      statuses={d.lk.statuses.filter((s) => s.active).map(({ id, name, pal, shape, description }) => ({ id, name, pal, shape, description }))}
      eras={d.lk.eras.filter((e) => e.active).map(({ id, name }) => ({ id, name }))}
      ongods={d.ongods.map(({ id, parent_id, name, kind, era_id, needs_review }) => ({ id, parent_id, name, kind, era_id, needs_review }))}
      people={people}
      canStatus={v.perms.has("status.change")}
      canEdit={v.perms.has("person.edit")}
      canExport={v.perms.has("export.csv")}
      views={views}
      initialView={initialView}
      meId={v.personId}
      initialEgo={sp.ego && vis.has(sp.ego) ? sp.ego : null}
      events={d.evs.map((e): MEvent => ({ id: e.id, name: e.name, date: ubDay(e.starts_at), parts: (e.parts || []).filter((x) => vis.has(x.pid)) }))}
      initialEvent={sp.ev || null}
      recent={d.recent.map((a: any) => ({ what: auditText(a), who: a.who || "Систем", at: fmtDateTime(a.at) }))}
    />
  );
}
