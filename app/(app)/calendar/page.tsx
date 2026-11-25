import Link from "next/link";
import { Empty, Icon, DateBadge } from "@/components/ui";
import { EVENT_STATE } from "@/lib/events";
import { MONTHS, WEEKDAYS, dayStart, fmtTime, ubDay } from "@/lib/time";
import { asViewer, requireMember } from "@/lib/viewer";

export const metadata = { title: "Календарь" };

type Item = { key: string; ymd: string; time: string; name: string; href: string; kind: "ev" | "tr"; off: boolean; mine: boolean; sub: string };
const pad = (n: number) => String(n).padStart(2, "0");
const addDays = (ymd: string, n: number) => new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10) + n)).toISOString().slice(0, 10);

/** P3.8: сарын календарь: өргөөний үйл ажиллагаа ба сургалтын хичээлүүд. */
export default async function Calendar({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const v = await requireMember();
  const sp = await searchParams;
  const today = ubDay(new Date());
  const ym = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.m || "") ? sp.m! : today.slice(0, 7);
  const [y, mo] = ym.split("-").map(Number);
  const first = `${ym}-01`;
  const next = mo === 12 ? `${y + 1}-01` : `${y}-${pad(mo + 1)}`;
  const prev = mo === 1 ? `${y - 1}-12` : `${y}-${pad(mo - 1)}`;
  // Даваа гарагаар эхэлсэн 6 хүртэл долоо хоног
  const lead = (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 6) % 7;
  const gridStart = addDays(first, -lead);
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const weeks = Math.ceil((lead + daysInMonth) / 7);
  const gridEnd = addDays(gridStart, weeks * 7);
  const canTr = v.perms.has("training.manage");
  const items = await asViewer(v, async (q) => {
    const evs = await q<{ id: string; name: string; starts_at: Date; state: string; place: string | null; type_name: string | null; mine: boolean }>(
      `SELECT e.id, e.name, e.starts_at, e.state, e.place, t.name AS type_name,
         EXISTS (SELECT 1 FROM event_participant ep WHERE ep.event_id = e.id AND ep.person_id = app_person() AND ep.rsvp <> 'no') AS mine
       FROM event e LEFT JOIN event_type t ON t.id = e.type_id WHERE e.starts_at >= $1 AND e.starts_at < $2 ORDER BY e.starts_at`, [dayStart(gridStart), dayStart(gridEnd)]);
    const trs = await q<{ id: string; sid: string; name: string; title: string | null; starts_at: Date; state: string; place: string | null; mine: boolean; n: number }>(
      `SELECT t.id, s.id AS sid, t.name, s.title, s.starts_at, t.state, coalesce(s.place, t.place) AS place,
         EXISTS (SELECT 1 FROM training_participant tp WHERE tp.training_id = t.id AND tp.person_id = app_person() AND tp.state IN ('yes','waitlist','invited','maybe')) AS mine,
         (SELECT count(*)::int FROM training_session x WHERE x.training_id = t.id AND x.starts_at <= s.starts_at) AS n
       FROM training_session s JOIN training t ON t.id = s.training_id
       WHERE s.starts_at >= $1 AND s.starts_at < $2 AND (t.state <> 'draft' OR ($3 AND t.urguu_id = app_urguu())) ORDER BY s.starts_at`, [dayStart(gridStart), dayStart(gridEnd), canTr]);
    const out: Item[] = [
      ...evs.map((e) => ({ key: e.id, ymd: ubDay(e.starts_at), time: fmtTime(e.starts_at), name: e.name, href: `/events/${e.id}`, kind: "ev" as const, off: e.state === "cancelled", mine: e.mine,
        sub: [e.type_name, e.place, e.state === "cancelled" ? EVENT_STATE.cancelled[1] : null].filter(Boolean).join(" · ") })),
      ...trs.map((s) => ({ key: s.sid, ymd: ubDay(s.starts_at), time: fmtTime(s.starts_at), name: s.name, href: `/trainings/${s.id}`, kind: "tr" as const, off: s.state === "cancelled", mine: s.mine,
        sub: [`Сургалт · ${s.n}-р хичээл`, s.title, s.place].filter(Boolean).join(" · ") })),
    ];
    return out.sort((a, b) => (a.ymd + a.time).localeCompare(b.ymd + b.time));
  });
  const by = new Map<string, Item[]>();
  for (const it of items) by.set(it.ymd, [...(by.get(it.ymd) || []), it]);
  const inMonth = items.filter((i) => i.ymd.startsWith(ym));
  return (
    <>
      <div className="pagehead">
        <div className="col g4"><h1>Календарь</h1><span className="muted">Үйл ажиллагаа, сургалтын хуваарь</span></div>
        <div className="row wrap">
          <Link className="btn" href="/events" aria-label="Үйл ажиллагаа"><Icon n="heart" s={16} /><span className="hide-m">Үйл ажиллагаа</span></Link>
          <Link className="btn" href="/trainings" aria-label="Сургалт"><Icon n="cap" s={16} /><span className="hide-m">Сургалт</span></Link>
          <Link className="btn" href="/me#schedule"><Icon n="me" s={16} />Миний хуваарь</Link>
        </div>
      </div>
      <div className="card p0">
        <div className="row between" style={{ padding: "12px 16px" }}>
          <Link className="btn sm" href={`/calendar?m=${prev}`} aria-label="Өмнөх сар"><Icon n="back" s={14} w={2.4} /></Link>
          <div className="row"><h2>{y} оны {MONTHS[mo - 1]}</h2>{ym !== today.slice(0, 7) ? <Link className="small" href="/calendar">Өнөөдөр</Link> : null}</div>
          <Link className="btn sm" href={`/calendar?m=${next}`} aria-label="Дараагийн сар"><span style={{ display: "inline-flex", transform: "scaleX(-1)" }}><Icon n="back" s={14} w={2.4} /></span></Link>
        </div>
        <div className="cal" role="grid" aria-label={`${y} оны ${MONTHS[mo - 1]}`}>
          {WEEKDAYS.map((w) => <div key={w} className="hd" role="columnheader">{w}</div>)}
          {Array.from({ length: weeks * 7 }, (_, i) => {
            const ymd = addDays(gridStart, i);
            const list = by.get(ymd) || [];
            return (
              <div key={ymd} role="gridcell" className={`${ymd.startsWith(ym) ? "" : "out"}${ymd === today ? " today" : ""}`}>
                <span className="dn">{+ymd.slice(8)}</span>
                {list.slice(0, 3).map((it) => (
                  <Link key={it.key} href={it.href} className={`ev${it.kind === "tr" ? " tr" : ""}${it.off ? " off" : ""}`} title={`${it.time} ${it.name}`} style={it.mine ? { fontWeight: 700 } : undefined}>
                    <span className="num">{it.time}</span> {it.name}
                  </Link>
                ))}
                {list.length > 3 ? <span className="tiny muted">+{list.length - 3}</span> : null}
              </div>
            );
          })}
        </div>
        <div className="row wrap small muted" style={{ padding: "10px 16px", gap: 16 }}>
          <span className="row" style={{ gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 4, background: "var(--pri-s)", border: "1px solid var(--pri)" }} />Үйл ажиллагаа</span>
          <span className="row" style={{ gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 4, background: "var(--gold-s)", border: "1px solid var(--gold-ink)" }} />Сургалт</span>
          <span><b>Тод</b>: таны оролцох</span>
        </div>
      </div>
      <div className="card p0">
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)" }}><h2>{MONTHS[mo - 1]}ын хуваарь · {inMonth.length}</h2></div>
        {inMonth.length ? inMonth.map((it) => (
          <Link key={it.key} href={it.href} className="list-item" style={{ textDecoration: "none", color: "inherit", opacity: it.off ? 0.55 : 1 }}>
            <DateBadge ymd={it.ymd} />
            <div className="col" style={{ minWidth: 0, flex: 1 }}>
              <b style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{it.name}</b>
              <span className="small muted">{it.time}{it.sub ? ` · ${it.sub}` : ""}</span>
            </div>
            {it.mine ? <span className="chip pri">Та оролцоно</span> : null}
          </Link>
        )) : <div style={{ padding: 16 }}><Empty title="Энэ сард хуваарьт үйл алга" /></div>}
      </div>
    </>
  );
}
