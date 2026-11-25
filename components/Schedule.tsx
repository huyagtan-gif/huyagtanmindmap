import Link from "next/link";
import { rsvpEvent } from "@/app/actions/events";
import { rsvpTraining } from "@/app/actions/training";
import { ActBtn } from "@/components/ActBtn";
import { DateBadge } from "@/components/ui";
import { RSVP } from "@/lib/events";
import { fmtTime, ubDay } from "@/lib/time";
import { P_STATE, PAY_STATE } from "@/lib/training";
import { asViewer, type Member } from "@/lib/viewer";

type Row = { kind: "ev" | "tr"; id: string; name: string; at: Date | null; place: string | null; state: string; pay?: string; fee?: number; open?: boolean };

/** P3.8 «Миний хуваарь»: миний оролцох (урьсан, хариу өгсөн) ирэх үйл, сургалтууд. Хариугаа эндээс шууд өгнө. */
export async function MySchedule({ v }: { v: Member }) {
  const rows = await asViewer(v, async (q) => {
    const evs = await q<{ id: string; name: string; starts_at: Date; place: string | null; rsvp: string }>(
      `SELECT e.id, e.name, e.starts_at, e.place, ep.rsvp FROM event_participant ep JOIN event e ON e.id = ep.event_id
       WHERE ep.person_id = app_person() AND e.state = 'planned' AND e.starts_at > now() - interval '6 hours' ORDER BY e.starts_at LIMIT 30`);
    const trs = await q<{ id: string; name: string; place: string | null; state: string; pay_state: string; fee: number; t_state: string; next_at: Date | null }>(
      `SELECT t.id, t.name, t.place, tp.state, tp.pay_state, t.fee, t.state AS t_state,
         (SELECT min(s.starts_at) FROM training_session s WHERE s.training_id = t.id AND s.starts_at > now() - interval '6 hours') AS next_at
       FROM training_participant tp JOIN training t ON t.id = tp.training_id
       WHERE tp.person_id = app_person() AND tp.state IN ('invited','yes','maybe','waitlist') AND t.state IN ('open','closed') LIMIT 30`);
    const out: Row[] = [
      ...evs.map((e) => ({ kind: "ev" as const, id: e.id, name: e.name, at: e.starts_at, place: e.place, state: e.rsvp })),
      ...trs.filter((t) => t.next_at || t.state === "invited").map((t) => ({ kind: "tr" as const, id: t.id, name: t.name, at: t.next_at, place: t.place, state: t.state, pay: t.pay_state, fee: t.fee, open: t.t_state === "open" })),
    ];
    return out.sort((a, b) => (a.at ? +a.at : Infinity) - (b.at ? +b.at : Infinity));
  });
  return (
    <div className="card p0" id="schedule">
      <div className="row between" style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
        <h2>Миний хуваарь</h2>
        <Link className="small" href="/calendar">Календарь</Link>
      </div>
      {rows.length ? rows.map((r) => {
        const href = r.kind === "ev" ? `/events/${r.id}` : `/trainings/${r.id}`;
        const label = r.kind === "ev" ? RSVP[r.state] : P_STATE[r.state];
        const ask = r.state === "invited" || r.state === "maybe";
        return (
          <div key={r.kind + r.id} className="list-item" style={{ flexWrap: "wrap" }}>
            {r.at ? <DateBadge ymd={ubDay(r.at)} /> : <span className="datebadge"><b>?</b></span>}
            <div className="col" style={{ minWidth: 0, flex: "1 1 180px" }}>
              <Link href={href} style={{ fontWeight: 600, color: "inherit" }}>{r.name}</Link>
              <span className="small muted">{r.kind === "tr" ? "Сургалт · " : ""}{r.at ? fmtTime(r.at) : "Хуваарь тодорхойгүй"}{r.place ? ` · ${r.place}` : ""}</span>
            </div>
            <span className={`chip ${label?.[0] || ""}`}>{label?.[1] || r.state}</span>
            {r.kind === "tr" && r.state === "yes" && r.pay === "pending" ? <Link className="btn sm pri" href={href}>{PAY_STATE.pending[1]}: төлөх</Link> : null}
            {ask && (r.kind === "ev" || r.open) ? (
              <span className="row" style={{ gap: 6 }}>
                {r.kind === "ev" ? (
                  <>
                    <ActBtn action={rsvpEvent} fields={{ event_id: r.id, rsvp: "yes", back: "me" }} className="btn sm pri">Ирнэ</ActBtn>
                    <ActBtn action={rsvpEvent} fields={{ event_id: r.id, rsvp: "no", back: "me" }} className="btn sm">Ирэхгүй</ActBtn>
                  </>
                ) : (
                  <>
                    <ActBtn action={rsvpTraining} fields={{ training_id: r.id, op: "yes", back: "me" }} className="btn sm pri">Ирнэ</ActBtn>
                    <ActBtn action={rsvpTraining} fields={{ training_id: r.id, op: "no", back: "me" }} className="btn sm">Ирэхгүй</ActBtn>
                  </>
                )}
              </span>
            ) : null}
          </div>
        );
      }) : <div style={{ padding: 16 }}><div className="empty"><span className="small">Одоогоор таны оролцох үйл, сургалт алга. <Link href="/calendar">Календарь харах</Link></span></div></div>}
    </div>
  );
}

/** P3.8: хүний картан дээрх оролцооны түүх (үйл, сургалт). */
export async function Participation({ v, personId }: { v: Member; personId: string }) {
  const d = await asViewer(v, async (q) => ({
    evs: await q<{ id: string; name: string; starts_at: Date; state: string; role_name: string | null; attended: boolean | null; rsvp: string }>(
      `SELECT e.id, e.name, e.starts_at, e.state, r.name AS role_name, ep.attended, ep.rsvp
       FROM event_participant ep JOIN event e ON e.id = ep.event_id LEFT JOIN event_role r ON r.id = ep.role_id
       WHERE ep.person_id = $1 AND e.state <> 'cancelled' AND (e.state = 'planned' OR ep.attended) ORDER BY e.starts_at DESC LIMIT 40`, [personId]),
    trs: await q<{ id: string; name: string; state: string; completion: string | null; att: number; total: number; first_at: Date | null }>(
      `SELECT t.id, t.name, tp.state, tp.completion,
         (SELECT count(*)::int FROM training_attendance ta WHERE ta.training_id = t.id AND ta.person_id = tp.person_id) AS att,
         (SELECT count(*)::int FROM training_session s WHERE s.training_id = t.id) AS total,
         (SELECT min(s.starts_at) FROM training_session s WHERE s.training_id = t.id) AS first_at
       FROM training_participant tp JOIN training t ON t.id = tp.training_id
       WHERE tp.person_id = $1 AND tp.state = 'yes' AND t.state <> 'draft' ORDER BY first_at DESC NULLS LAST LIMIT 40`, [personId]),
  }));
  if (!d.evs.length && !d.trs.length) return null;
  return (
    <div className="card p0" id="history">
      <div style={{ padding: "16px 16px 8px" }}><h2>Оролцсон үйл, сургалт</h2></div>
      {d.trs.map((t) => (
        <Link key={t.id} href={`/trainings/${t.id}`} className="list-item" style={{ color: "inherit", textDecoration: "none", minHeight: 0 }}>
          <div className="col" style={{ flex: 1, minWidth: 0 }}>
            <b>{t.name}</b>
            <span className="small muted">Сургалт{t.first_at ? ` · ${ubDay(t.first_at)}` : ""} · ирц {t.att}/{t.total}</span>
          </div>
          {t.completion === "completed" ? <span className="chip ok">Дүүргэсэн</span> : t.completion === "incomplete" ? <span className="chip">Дутуу</span> : null}
        </Link>
      ))}
      {d.evs.map((e) => (
        <Link key={e.id} href={`/events/${e.id}`} className="list-item" style={{ color: "inherit", textDecoration: "none", minHeight: 0 }}>
          <div className="col" style={{ flex: 1, minWidth: 0 }}>
            <b>{e.name}</b>
            <span className="small muted">{ubDay(e.starts_at)}{e.role_name ? ` · ${e.role_name}` : ""}</span>
          </div>
          {e.state === "planned" ? <span className={`chip ${RSVP[e.rsvp]?.[0] || ""}`}>{RSVP[e.rsvp]?.[1]}</span> : <span className="chip ok">Ирсэн</span>}
        </Link>
      ))}
    </div>
  );
}
