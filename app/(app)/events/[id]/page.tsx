import Link from "next/link";
import { addEventParticipants, deleteEvent, rsvpEvent, setEventState, updateEventParticipant } from "@/app/actions/events";
import { ActBtn } from "@/components/ActBtn";
import { DonationCard } from "@/components/DonationCard";
import { EventForm, type EventRow } from "@/components/EventForm";
import { Flash } from "@/components/Flash";
import { MultiPicker } from "@/components/Pickers";
import { Avatar, Empty, Icon } from "@/components/ui";
import { loadLookups, loadOngods } from "@/lib/data";
import { EVENT_STATE, RSVP, peopleOptions } from "@/lib/events";
import { displayName } from "@/lib/project";
import { fmtDay, fmtRange } from "@/lib/time";
import { asViewer, requireMember } from "@/lib/viewer";

export const metadata = { title: "Үйл" };

type Part = { id: string; person_id: string; role_id: string | null; role_name: string | null; rsvp: string; attended: boolean | null; note: string | null; father_name: string | null; given_name: string; is_registered: boolean };

export default async function EventPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string; m?: string }> }) {
  const v = await requireMember();
  const { id } = await params;
  const sp = await searchParams;
  const can = v.perms.has("event.manage");
  const d = /^[0-9a-f-]{36}$/i.test(id)
    ? await asViewer(v, async (q) => {
        const [ev] = await q<EventRow & { type_name: string | null; ongod_name: string | null; deedes_name: string | null; org_father: string | null; org_given: string | null }>(
          `SELECT e.*, t.name AS type_name, o.name AS ongod_name, dd.name AS deedes_name, op.father_name AS org_father, op.given_name AS org_given
           FROM event e LEFT JOIN event_type t ON t.id = e.type_id LEFT JOIN ongod o ON o.id = e.ongod_id LEFT JOIN deedes dd ON dd.id = e.deedes_id
             LEFT JOIN person op ON op.id = e.organizer_id WHERE e.id = $1`, [id]);
        if (!ev) return null;
        const parts = await q<Part>(
          `SELECT ep.id, ep.person_id, ep.role_id, r.name AS role_name, ep.rsvp, ep.attended, ep.note, p.father_name, p.given_name, p.is_registered
           FROM event_participant ep JOIN person p ON p.id = ep.person_id LEFT JOIN event_role r ON r.id = ep.role_id
           WHERE ep.event_id = $1 ORDER BY r.sort NULLS LAST, p.given_name`, [id]);
        const roles = await q<{ id: string; name: string }>("SELECT id, name FROM event_role WHERE active ORDER BY sort, name");
        const people = can ? await peopleOptions(q, v) : [];
        const form = can && sp.edit
          ? {
              types: await q<{ id: string; name: string }>("SELECT id, name FROM event_type WHERE active OR id = $1 ORDER BY sort, name", [ev.type_id]),
              ongods: (await loadOngods(q)).filter((o) => o.kind === "ongod").map((o) => ({ id: o.id, name: o.name })),
              deedes: (await loadLookups(q)).deedes.map((x) => ({ id: x.id, name: x.name })),
            }
          : null;
        return { ev, parts, roles, people, form };
      })
    : null;
  if (!d) return <Empty title="Үйл олдсонгүй"><Link href="/events">Үйл ажиллагаа руу буцах</Link></Empty>;
  const { ev, parts } = d;
  const past = ev.state === "done";
  const planned = ev.state === "planned";
  const mine = parts.find((p) => p.person_id === v.personId);
  const going = parts.filter((p) => p.rsvp === "yes").length;
  const came = parts.filter((p) => p.attended).length;
  const inList = new Set(parts.map((p) => p.person_id));
  return (
    <>
      <Link href="/events" className="row small" style={{ gap: 4, fontWeight: 500 }}><Icon n="back" s={14} w={2.4} />Үйл ажиллагаа</Link>
      <div className="pagehead">
        <div className="col g4" style={{ minWidth: 0 }}>
          <div className="row wrap">
            <span className={`chip ${EVENT_STATE[ev.state]?.[0] || ""}`}>{EVENT_STATE[ev.state]?.[1]}</span>
            {ev.type_name ? <span className="chip">{ev.type_name}</span> : null}
          </div>
          <h1>{ev.name}</h1>
          <span className="row wrap small" style={{ color: "var(--ink2)", gap: 16 }}>
            <span className="row" style={{ gap: 6 }}><Icon n="cal" s={16} />{fmtDay(ev.starts_at)} · {fmtRange(ev.starts_at, ev.ends_at).slice(11)}</span>
            {ev.place ? <span className="row" style={{ gap: 6 }}><Icon n="pin" s={16} />{ev.place}</span> : null}
          </span>
        </div>
        {can ? (
          <div className="row wrap">
            <Link className="btn" href={`/events/${ev.id}?edit=1`}><Icon n="edit" s={16} />Засах</Link>
            {planned ? <ActBtn action={setEventState} fields={{ id: ev.id, state: "done" }} className="btn pri">Болсон гэж тэмдэглэх</ActBtn> : null}
            {planned ? <ActBtn action={setEventState} fields={{ id: ev.id, state: "cancelled" }} className="btn" confirm="Энэ үйлийг цуцлах уу?">Цуцлах</ActBtn> : null}
            {!planned ? <ActBtn action={setEventState} fields={{ id: ev.id, state: "planned" }} className="btn">Төлөвлөсөн болгох</ActBtn> : null}
          </div>
        ) : null}
      </div>
      <Flash m={sp.m} />
      {d.form ? <EventForm ev={ev} people={d.people} {...d.form} cancelHref={`/events/${ev.id}`} /> : null}
      <div className="split">
        <div className="grow col g16">
          {ev.description || ev.org_given || ev.ongod_name || ev.deedes_name ? (
            <div className="card col g12">
              {ev.description ? <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{ev.description}</p> : null}
              <dl className="kv">
                {ev.org_given ? <><dt>Зохион байгуулагч</dt><dd><Link href={`/people/${ev.organizer_id}`}>{displayName({ father_name: ev.org_father, given_name: ev.org_given })}</Link></dd></> : null}
                {ev.ongod_name ? <><dt>Онгод</dt><dd>{ev.ongod_name}</dd></> : null}
                {ev.deedes_name ? <><dt>Дээдэс</dt><dd>{ev.deedes_name}</dd></> : null}
              </dl>
            </div>
          ) : null}
          {planned ? (
            <div className="card row wrap between">
              <div className="col">
                <b>Та ирэх үү?</b>
                <span className="small muted">{mine ? `Таны хариу: ${RSVP[mine.rsvp]?.[1]}` : "Хариугаа өгвөл зохион байгуулагчид амар болно."}</span>
              </div>
              <div className="row wrap">
                {(["yes", "maybe", "no"] as const).map((k) => (
                  <ActBtn key={k} action={rsvpEvent} fields={{ event_id: ev.id, rsvp: k }} className={`btn sm${mine?.rsvp === k ? " pri" : ""}`} pressed={mine?.rsvp === k}>{RSVP[k][1]}</ActBtn>
                ))}
              </div>
            </div>
          ) : null}
          <div className="card p0">
            <div className="row between" style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
              <h2>Оролцогчид · {parts.length}</h2>
              <span className="small muted">{past ? `${came} ирсэн` : `${going} ирнэ`}</span>
            </div>
            {parts.length ? (
              <div className="tscroll">
                <table className="t">
                  <thead><tr><th>Нэр</th><th>Үүрэг</th><th>{past ? "Ирц" : "Хариу"}</th>{can ? <th /> : null}</tr></thead>
                  <tbody>
                    {parts.map((p) => {
                      const nm = displayName(p);
                      return (
                        <tr key={p.id}>
                          <td>
                            <span className="row">
                              <Avatar name={nm} size={30} />
                              <Link href={`/people/${p.person_id}`} style={{ fontWeight: 600 }}>{nm}</Link>
                              {p.is_registered ? null : <span className="chip" style={{ height: 20 }}>бүртгэлгүй</span>}
                            </span>
                            {p.note && can ? <div className="tiny muted">{p.note}</div> : null}
                          </td>
                          <td>
                            {can ? (
                              <form action={updateEventParticipant} className="row" style={{ gap: 6 }}>
                                <input type="hidden" name="id" value={p.id} /><input type="hidden" name="event_id" value={ev.id} /><input type="hidden" name="note" value={p.note || ""} />
                                <select className="inp sm" name="role_id" defaultValue={p.role_id || ""} aria-label={`${nm}: үүрэг`} style={{ width: "auto" }}>
                                  <option value="">—</option>{d.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                                </select>
                                <button className="btn sm ghost">Хадгалах</button>
                              </form>
                            ) : p.role_name || "—"}
                          </td>
                          <td>
                            {past ? (
                              can ? (
                                <ActBtn action={updateEventParticipant} fields={{ id: p.id, event_id: ev.id, op: "attend" }} className={`btn sm${p.attended ? " soft" : ""}`} pressed={!!p.attended}>{p.attended ? "Ирсэн" : "Ирээгүй"}</ActBtn>
                              ) : <span className={`chip ${p.attended ? "ok" : ""}`}>{p.attended ? "Ирсэн" : "Ирээгүй"}</span>
                            ) : <span className={`chip ${RSVP[p.rsvp]?.[0] || ""}`}>{RSVP[p.rsvp]?.[1] || p.rsvp}</span>}
                          </td>
                          {can ? (
                            <td>
                              <ActBtn action={updateEventParticipant} fields={{ id: p.id, event_id: ev.id, op: "remove" }} className="btn sm ghost" confirm={`«${nm}»-г оролцогчдоос хасах уу?`} label={`${nm} хасах`}><Icon n="x" s={14} /></ActBtn>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <div style={{ padding: 16 }}><Empty title="Оролцогч алга" /></div>}
            {can ? (
              <form action={addEventParticipants} className="col g12" style={{ padding: 16, borderTop: "1px solid var(--line)" }}>
                <input type="hidden" name="event_id" value={ev.id} />
                <b className="small">Оролцогч нэмэх</b>
                <MultiPicker name="people" options={d.people.filter((p) => !inList.has(p.id))} placeholder="Нэрээр хайж нэмэх" allowNew newHint="Бүртгэлгүй хүн болгон нэмнэ" />
                <div className="row wrap">
                  <select className="inp sm" name="role_id" defaultValue={d.roles[d.roles.length - 1]?.id || ""} aria-label="Үүрэг" style={{ width: "auto" }}>{d.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
                  {planned ? <label className="row small" style={{ gap: 6 }}><input type="checkbox" name="invite" />Урилга болгож нэмэх (хариугаа өөрсдөө өгнө)</label> : null}
                  <button className="btn sm pri">Нэмэх</button>
                </div>
              </form>
            ) : null}
          </div>
          {can ? (
            <div><ActBtn action={deleteEvent} fields={{ id: ev.id }} className="btn sm danger" confirm={`«${ev.name}» үйлийг оролцогчдын бүртгэлтэй нь устгах уу?`}>Үйлийг устгах</ActBtn></div>
          ) : null}
        </div>
        <aside className="aside"><DonationCard eventId={ev.id} v={v} /></aside>
      </div>
    </>
  );
}
