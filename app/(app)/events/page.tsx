import Link from "next/link";
import { EventForm } from "@/components/EventForm";
import { Flash } from "@/components/Flash";
import { DateBadge, Empty, Icon } from "@/components/ui";
import { loadLookups, loadOngods } from "@/lib/data";
import { EVENT_STATE, peopleOptions } from "@/lib/events";
import { fmtTime, ubDay } from "@/lib/time";
import { asViewer, requireMember } from "@/lib/viewer";

export const metadata = { title: "Үйл ажиллагаа" };

type Row = { id: string; name: string; starts_at: Date; place: string | null; state: string; type_name: string | null; n: number; mine: string | null };

export default async function Events({ searchParams }: { searchParams: Promise<{ f?: string; add?: string; m?: string }> }) {
  const v = await requireMember();
  const sp = await searchParams;
  const can = v.perms.has("event.manage");
  const f = ["planned", "done", "cancelled"].includes(sp.f || "") ? sp.f! : "";
  const d = await asViewer(v, async (q) => ({
    rows: await q<Row>(
      `SELECT e.id, e.name, e.starts_at, e.place, e.state, t.name AS type_name,
              (SELECT count(*)::int FROM event_participant ep WHERE ep.event_id = e.id AND ep.rsvp <> 'no') AS n,
              (SELECT ep.rsvp FROM event_participant ep WHERE ep.event_id = e.id AND ep.person_id = app_person()) AS mine
       FROM event e LEFT JOIN event_type t ON t.id = e.type_id
       WHERE ($1 = '' OR e.state = $1) ORDER BY e.starts_at DESC LIMIT 300`, [f]),
    form: can && sp.add
      ? {
          types: await q<{ id: string; name: string }>("SELECT id, name FROM event_type WHERE active ORDER BY sort, name"),
          people: await peopleOptions(q, v),
          ongods: (await loadOngods(q)).filter((o) => o.kind === "ongod").map((o) => ({ id: o.id, name: o.name })),
          deedes: (await loadLookups(q)).deedes.filter((x) => x.active).map((x) => ({ id: x.id, name: x.name })),
        }
      : null,
  }));
  const now = Date.now();
  const upcoming = d.rows.filter((r) => r.state === "planned" && +r.starts_at >= now - 6 * 3600_000).reverse();
  const rest = d.rows.filter((r) => !upcoming.includes(r));
  const item = (e: Row) => (
    <Link key={e.id} className="card row g16" href={`/events/${e.id}`} style={{ color: "inherit", textDecoration: "none", padding: 16 }}>
      <DateBadge ymd={ubDay(e.starts_at)} />
      <span className="col" style={{ flex: 1, minWidth: 0 }}>
        <b style={{ fontSize: 16 }}>{e.name}</b>
        <span className="small muted">{[e.type_name, fmtTime(e.starts_at), e.place, `${e.n} оролцогч`].filter(Boolean).join(" · ")}</span>
      </span>
      {e.mine === "invited" ? <span className="chip warn">Таныг урьсан</span> : e.mine === "yes" ? <span className="chip ok hide-m">Та ирнэ</span> : null}
      <span className={`chip ${EVENT_STATE[e.state]?.[0] || ""} hide-m`}>{EVENT_STATE[e.state]?.[1] || e.state}</span>
      <Icon n="right" s={18} />
    </Link>
  );
  return (
    <>
      <div className="pagehead">
        <div><div className="crumb">{v.urguu.name}</div><h1>Үйл ажиллагаа</h1></div>
        <div className="row wrap">
          <Link className="btn" href="/calendar"><Icon n="cal" s={16} /><span className="hide-m">Календарь</span></Link>
          {can ? <Link className="btn pri" href="/events?add=1"><Icon n="plus" s={16} w={2.4} />Үйл нэмэх</Link> : null}
        </div>
      </div>
      <Flash m={sp.m} />
      {d.form ? <EventForm {...d.form} cancelHref="/events" /> : null}
      <div className="row wrap">
        {[["", "Бүгд"], ["planned", "Төлөвлөсөн"], ["done", "Болсон"], ["cancelled", "Цуцалсан"]].map(([k, n]) => (
          <Link key={k} className={`fchip${f === k ? " on" : ""}`} href={k ? `/events?f=${k}` : "/events"}>{n}</Link>
        ))}
      </div>
      {d.rows.length ? (
        <>
          {upcoming.length ? <div className="col g12"><h2>Удахгүй болох</h2>{upcoming.map(item)}</div> : null}
          {rest.length ? <div className="col g12">{upcoming.length ? <h2>Өмнөх</h2> : null}{rest.map(item)}</div> : null}
        </>
      ) : <Empty title="Одоогоор үйл алга">{can ? "Анхны үйлээ нэмээд гишүүдээ урина уу." : "Үйл нэмэгдэхэд энд харагдана."}</Empty>}
    </>
  );
}
