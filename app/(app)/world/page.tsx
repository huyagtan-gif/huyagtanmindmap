import Link from "next/link";
import { Avatar, Empty, Icon, Shape, StatusChip } from "@/components/ui";
import { loadLookups } from "@/lib/data";
import { loadWorld } from "@/lib/urguu";
import { asViewer, requirePerm } from "@/lib/viewer";

export const metadata = { title: "Дэлхийн үрс" };

/** P2.5: нэгдсэн «Дэлхийн үрс» харагдац — харах эрхтэй бүх өргөөний хүмүүс, хүн давхардалгүй. */
export default async function World({ searchParams }: { searchParams: Promise<{ q?: string; u?: string; st?: string }> }) {
  const v = await requirePerm("world.view");
  const sp = await searchParams;
  const [{ urguus, people }, lk] = await Promise.all([loadWorld(v), asViewer(v, loadLookups)]);
  const stBy = new Map(lk.statuses.map((s) => [s.id, s]));
  const active = lk.statuses.filter((s) => s.active);
  const uName = urguus.find((u) => u.id === sp.u)?.name;
  const t = (sp.q || "").trim().toLowerCase();
  let rows = people;
  if (uName) rows = rows.filter((p) => p.urguus.includes(uName));
  const counts: Record<string, number> = {};
  for (const p of rows) if (p.status_id) counts[p.status_id] = (counts[p.status_id] || 0) + 1;
  const total = rows.length;
  if (sp.st) rows = rows.filter((p) => p.status_id === sp.st);
  if (t) rows = rows.filter((p) => p.search.includes(t));
  const multi = people.filter((p) => p.urguus.length > 1).length;
  const href = (o: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, val] of Object.entries({ q: sp.q, u: sp.u, st: sp.st, ...o })) if (val) q.set(k, val);
    const s = q.toString();
    return s ? `/world?${s}` : "/world";
  };
  return (
    <>
      <div className="pagehead">
        <div className="col g4">
          <div className="crumb">{urguus.length} өргөө{multi ? ` · ${multi} хүн хэд хэдэн өргөөнд (нэг удаа тоологдсон)` : ""}</div>
          <h1>Дэлхийн үрс</h1>
        </div>
        <form className="row wrap" action="/world">
          {sp.u ? <input type="hidden" name="u" value={sp.u} /> : null}
          {sp.st ? <input type="hidden" name="st" value={sp.st} /> : null}
          <label className="search" style={{ width: 300, maxWidth: "100%", flex: "1 1 220px" }}>
            <Icon n="search" s={16} /><input type="search" name="q" placeholder="Хүн, онгод, өргөө хайх" aria-label="Хайх" defaultValue={sp.q || ""} />
          </label>
        </form>
      </div>
      <div className="kpis" role="group" aria-label="Тойм ба төлвөөр шүүх">
        <Link className="kpi" href={href({ st: undefined })} style={{ color: "inherit", textDecoration: "none", ...(sp.st ? {} : { boxShadow: "inset 0 -3px 0 var(--pri)" }) }}>
          <span className="small muted">Нийт хүн</span><b className="num">{total}</b>
        </Link>
        {[...active].reverse().map((s) => (
          <Link key={s.id} className="kpi" href={href({ st: sp.st === s.id ? undefined : s.id })} style={{ color: "inherit", textDecoration: "none", ...(sp.st === s.id ? { boxShadow: "inset 0 -3px 0 var(--pri)" } : {}) }}>
            <span className="row small" style={{ gap: 6, color: "var(--ink2)" }}><Shape st={s} s={13} />{s.name}</span><b className="num">{counts[s.id] || 0}</b>
          </Link>
        ))}
      </div>
      <div className="row wrap" role="group" aria-label="Өргөөгөөр шүүх">
        <Link className={`fchip${sp.u ? "" : " on"}`} href={href({ u: undefined })}>Бүх өргөө</Link>
        {urguus.map((u) => <Link key={u.id} className={`fchip${sp.u === u.id ? " on" : ""}`} href={href({ u: u.id })}>{u.name} · {u.count}</Link>)}
      </div>
      {urguus.length < 2 ? (
        <div className="banner info">Одоогоор танд зөвхөн өөрийн өргөө харагдаж байна. Өөр өргөөний админ «Тохиргоо → Өргөө хоорондын эрх»-ээс танай өргөөнд харах эрх олгоход тэдний хүмүүс энд нэмэгдэнэ.</div>
      ) : null}
      <div className="card p0">
        {rows.length ? (
          <div className="tscroll">
            <table className="t">
              <thead><tr><th>Нэр</th><th>Өргөө</th><th>Төлөв</th><th>Эрэмбийн онгод</th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <span className="row" style={{ gap: 10 }}>
                        <Avatar name={p.name} st={stBy.get(p.status_id || "")} size={32} />
                        <span className="col">
                          {p.own ? <Link href={`/people/${p.id}`} style={{ fontWeight: 600 }}>{p.name}</Link> : <b>{p.name}</b>}
                          {p.clan_name ? <span className="tiny muted">{p.clan_name}</span> : null}
                        </span>
                      </span>
                    </td>
                    <td><span className="row wrap" style={{ gap: 4 }}>{p.urguus.map((u) => <span key={u} className="chip">{u}</span>)}</span></td>
                    <td><StatusChip st={stBy.get(p.status_id || "")} /></td>
                    <td className="small">{p.ongods.join(", ") || <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty title="Илэрц алга" />}
      </div>
    </>
  );
}
