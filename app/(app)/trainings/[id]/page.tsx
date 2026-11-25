import Link from "next/link";
import {
  bulkComplete, bulkConfirm, bulkIncomplete, bulkRemove, bulkToWaiting, bulkWaitlist, deleteSession, deleteTraining, inviteToTraining,
  rsvpTraining, saveCoUrguus, saveSession, submitSurvey, toggleAttendance, toggleQr,
} from "@/app/actions/training";
import { ActBtn } from "@/components/ActBtn";
import { ConfirmButton } from "@/components/AutoSubmit";
import { CheckAll } from "@/components/CheckAll";
import { Flash } from "@/components/Flash";
import { MultiPicker } from "@/components/Pickers";
import { Qr } from "@/components/Qr";
import { TrainingForm } from "@/components/TrainingForm";
import { TrainingPay, TrainingPayTab } from "@/components/TrainingPay";
import { Avatar, Empty, Icon } from "@/components/ui";
import { loadLookups, loadPeople } from "@/lib/data";
import { sys } from "@/lib/db";
import { peopleOptions } from "@/lib/events";
import { SITE_URL } from "@/lib/mail";
import { displayName } from "@/lib/project";
import { fmtDay, fmtRange, fmtTime, localInput, money, ubDay } from "@/lib/time";
import { PAY_STATE, P_STATE, REG, SCOPE, T_STATE, attToken, trainingAccess } from "@/lib/training";
import { asViewer, requireMember } from "@/lib/viewer";

export const metadata = { title: "Сургалт" };

type Sess = { id: string; title: string | null; starts_at: Date; ends_at: Date | null; place: string | null; qr_open: boolean; n: number };
type Part = { id: string; person_id: string; state: string; source: string; completion: string | null; pay_state: string; father_name: string | null; given_name: string; is_registered: boolean; phone?: string | null; certificate_no?: string | null };
type SP = { tab?: string; m?: string; role?: string; st?: string; kn?: string; prev?: string; f?: string };

export default async function TrainingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const v = await requireMember();
  const { id } = await params;
  const sp = await searchParams;
  const showPhone = v.fields.has("phone");
  const d = await asViewer(v, async (q) => {
    const a = await trainingAccess(q, v, id);
    if (!a) return null;
    const tab = a.manage && ["parts", "sess", "invite", "pay", "survey", "set"].includes(sp.tab || "") ? sp.tab! : "parts";
    const sessions = await q<Sess>(
      `SELECT s.id, s.title, s.starts_at, s.ends_at, s.place, s.qr_open, (SELECT count(*)::int FROM training_attendance ta WHERE ta.session_id = s.id) AS n
       FROM training_session s WHERE s.training_id = $1 ORDER BY s.starts_at`, [id]);
    const teachers = await q<{ id: string; father_name: string | null; given_name: string }>(
      "SELECT p.person_id AS id, p.father_name, p.given_name FROM training_teacher tt JOIN training_people($1) p ON p.person_id = tt.person_id WHERE tt.training_id = $1 ORDER BY p.given_name", [id]);
    const counts = Object.fromEntries((await q<{ state: string; n: number }>("SELECT state, count(*)::int AS n FROM training_participant WHERE training_id = $1 GROUP BY state", [id])).map((r) => [r.state, r.n]));
    const [mine] = await q<{ id: string; state: string; pay_state: string; completion: string | null; certificate_code?: string | null }>("SELECT * FROM training_participant WHERE training_id = $1 AND person_id = app_person()", [id]);
    const myAtt = new Set((await q<{ session_id: string }>("SELECT session_id FROM training_attendance WHERE training_id = $1 AND person_id = app_person()", [id])).map((r) => r.session_id));
    const [mySurvey] = await q<{ rating: number; comment: string | null }>("SELECT rating, comment FROM training_survey WHERE training_id = $1 AND person_id = app_person()", [id]);
    if (!a.manage) return { a, tab, sessions, teachers, counts, mine, myAtt, mySurvey, m: null };
    const parts = await q<Part>(
      `SELECT tp.*, p.father_name, p.given_name, p.is_registered${showPhone ? ", pp.phone" : ""}
       FROM training_participant tp JOIN training_people($1) p ON p.person_id = tp.person_id ${showPhone ? "LEFT JOIN person_private pp ON pp.person_id = tp.person_id" : ""}
       WHERE tp.training_id = $1
       ORDER BY array_position(ARRAY['yes','waitlist','invited','maybe','no','cancelled'], tp.state), p.given_name`, [id]);
    const att = new Set((await q<{ session_id: string; person_id: string }>("SELECT session_id, person_id FROM training_attendance WHERE training_id = $1", [id])).map((r) => `${r.session_id}:${r.person_id}`));
    const m = {
      parts, att,
      people: tab === "set" || tab === "invite" ? await peopleOptions(q, v) : [],
      surveys: tab === "survey" ? await q<{ rating: number; comment: string | null; created_at: Date }>("SELECT rating, comment, created_at FROM training_survey WHERE training_id = $1 ORDER BY created_at DESC", [id]) : [],
      co: tab === "set" ? await q<{ urguu_id: string; is_lead: boolean; share_pct: string }>("SELECT urguu_id, is_lead, share_pct FROM training_urguu WHERE training_id = $1", [id]) : [],
      inv: tab === "invite"
        ? {
            lk: await loadLookups(q),
            people: await loadPeople(q, v, { registeredOnly: true }),
            before: new Set((await q<{ person_id: string }>("SELECT DISTINCT person_id FROM training_attendance WHERE training_id <> $1", [id])).map((r) => r.person_id)),
          }
        : null,
    };
    return { a, tab, sessions, teachers, counts, mine, myAtt, mySurvey, m };
  });
  if (!d) return <Empty title="Сургалт олдсонгүй"><Link href="/trainings">Сургалт руу буцах</Link></Empty>;
  const { a, tab, sessions, teachers, counts, mine, m } = d;
  const t = a.t;
  const reg = counts.yes || 0;
  const now = Date.now();
  const cur = sessions.find((s) => s.qr_open) || sessions.find((s) => +s.starts_at > now - 6 * 3600_000) || sessions[sessions.length - 1];
  const sessLine = sessions.length ? sessions.slice(0, 4).map((s) => ubDay(s.starts_at).slice(5).replace("-", ".")).join(", ") + (sessions.length > 4 ? "…" : "") : "Хуваарь тодорхойгүй";
  const teacherLinks = teachers.map((p, i) => <span key={p.id}>{i ? ", " : ""}<Link href={`/people/${p.id}`}>{displayName(p)}</Link></span>);
  const base = `/trainings/${t.id}`;
  const others = m && tab === "set" ? await sys<{ id: string; name: string }>("SELECT id, name FROM urguu WHERE state = 'active' AND id <> $1 ORDER BY created_at", [t.urguu_id]) : [];
  const canJoin = t.state === "open" && (t.reg_mode !== "invite" || a.manage);

  /* ---------- Миний оролцоо (гишүүн бүрт) ---------- */
  const my = (
    <div className="card col g12">
      <h2>Миний оролцоо</h2>
      {mine && mine.state === "yes" ? (
        <>
          <span className="chip ok" style={{ alignSelf: "flex-start" }}>Бүртгэгдсэн{t.fee > 0 ? ` · ${PAY_STATE[mine.pay_state]?.[1]}` : ""}</span>
          <TrainingPay trainingId={t.id} participantId={mine.id} payState={mine.pay_state} fee={t.fee} v={v} />
          {sessions.length ? (
            <div className="col g4">
              {sessions.map((s, i) => (
                <div key={s.id} className="row between small"><span>{i + 1}-р хичээл · {ubDay(s.starts_at).slice(5)}</span>{d.myAtt.has(s.id) ? <span className="chip ok" style={{ height: 22 }}>Ирсэн</span> : <span className="muted">{+s.starts_at < now ? "Ирээгүй" : "—"}</span>}</div>
              ))}
            </div>
          ) : null}
          {mine.completion === "completed" ? <span className="chip ok" style={{ alignSelf: "flex-start" }}>Сургалтыг дүүргэсэн</span> : null}
          {mine.completion === "completed" && mine.certificate_code ? <Link className="btn sm" href={`/certificate/${mine.certificate_code}`}>Сертификат харах</Link> : null}
          {t.state === "open" || t.state === "closed" ? <ActBtn action={rsvpTraining} fields={{ training_id: t.id, op: "no" }} className="btn sm ghost" confirm="Оролцохоо болих уу? Таны суудал дараагийн хүнд очно.">Оролцохоо болих</ActBtn> : null}
        </>
      ) : mine && mine.state === "waitlist" ? (
        <>
          <span className="chip warn" style={{ alignSelf: "flex-start" }}>Хүлээлгийн жагсаалтад</span>
          <span className="small muted">Суудал суларвал таныг автоматаар оруулж, мэдэгдэнэ.</span>
          <ActBtn action={rsvpTraining} fields={{ training_id: t.id, op: "no" }} className="btn sm ghost">Хүлээлгээс гарах</ActBtn>
        </>
      ) : (
        <>
          {mine?.state === "invited" ? <span className="chip warn" style={{ alignSelf: "flex-start" }}>Таныг урьсан</span> : mine ? <span className="small muted">Таны хариу: {P_STATE[mine.state]?.[1]}</span> : null}
          <div className="row between"><span className="small muted">Төлбөр</span><b style={{ font: "800 22px var(--f-head)" }}>{t.fee ? money(t.fee) : "Үнэгүй"}</b></div>
          {t.capacity ? <span className="small muted">Суудал: {reg} / {t.capacity}{reg >= t.capacity ? " · дүүрсэн (хүлээлгийн жагсаалтад орно)" : ""}</span> : null}
          {mine || canJoin ? (
            t.state === "open" ? (
              <div className="row wrap">
                <ActBtn action={rsvpTraining} fields={{ training_id: t.id, op: "yes" }} className="btn pri">{mine ? "Ирнэ" : "Бүртгүүлэх"}</ActBtn>
                {mine ? <ActBtn action={rsvpTraining} fields={{ training_id: t.id, op: "maybe" }} className={`btn${mine.state === "maybe" ? " soft" : ""}`}>Магадгүй</ActBtn> : null}
                {mine ? <ActBtn action={rsvpTraining} fields={{ training_id: t.id, op: "no" }} className={`btn${mine.state === "no" ? " soft" : ""}`}>Ирэхгүй</ActBtn> : null}
              </div>
            ) : <span className="small muted">Бүртгэл хаагдсан байна.</span>
          ) : <span className="small muted">Энэ сургалтад зөвхөн урилгаар оролцоно.</span>}
        </>
      )}
      {t.survey_open && mine?.state === "yes" ? (
        <form action={submitSurvey} className="col g12" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <input type="hidden" name="training_id" value={t.id} />
          <b className="small">Сургалтыг үнэлнэ үү</b>
          <div className="row wrap" role="radiogroup" aria-label="Үнэлгээ">
            {[1, 2, 3, 4, 5].map((n) => <label key={n} className="row small" style={{ gap: 4 }}><input type="radio" name="rating" value={n} required defaultChecked={d.mySurvey?.rating === n} />{n}</label>)}
          </div>
          <textarea className="inp" name="comment" rows={2} maxLength={2000} placeholder="Сэтгэгдэл, санал (заавал биш)" defaultValue={d.mySurvey?.comment || ""} />
          <button className="btn sm" style={{ alignSelf: "flex-start" }}>{d.mySurvey ? "Үнэлгээгээ шинэчлэх" : "Илгээх"}</button>
        </form>
      ) : null}
    </div>
  );

  const info = (
    <div className="card col g12">
      {t.description ? <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{t.description}</p> : null}
      <dl className="kv">
        <dt>Хичээл</dt>
        <dd>{sessions.length ? sessions.map((s, i) => <div key={s.id}>{i + 1}. {fmtDay(s.starts_at)} · {fmtRange(s.starts_at, s.ends_at).slice(11)}{s.title ? ` · ${s.title}` : ""}</div>) : "Хуваарь тодорхойгүй"}</dd>
        {t.place ? <><dt>Байршил</dt><dd>{t.place}</dd></> : null}
        {t.online_url && mine?.state === "yes" ? <><dt>Онлайн</dt><dd><a href={t.online_url} target="_blank" rel="noopener noreferrer">{t.online_url}</a></dd></> : null}
        {teachers.length ? <><dt>Багш</dt><dd>{teacherLinks}</dd></> : null}
        <dt>Суудал</dt><dd>{t.capacity ? `${reg} / ${t.capacity}` : `${reg} бүртгэгдсэн`}</dd>
      </dl>
    </div>
  );

  const head = (
    <>
      <Link href="/trainings" className="row small" style={{ gap: 4, fontWeight: 500 }}><Icon n="back" s={14} w={2.4} />Бүх сургалт</Link>
      <div className="pagehead">
        <div className="col g4" style={{ minWidth: 0 }}>
          <h1>{t.name}</h1>
          <div className="row wrap small" style={{ gap: 8, color: "var(--ink2)" }}>
            <span className={`chip ${t.scope === "public" ? "pri" : ""}`}>{SCOPE[t.scope]}</span>
            <span className="chip">{REG[t.reg_mode]}</span>
            {t.state !== "open" ? <span className={`chip ${T_STATE[t.state]?.[0] || ""}`}>{T_STATE[t.state]?.[1]}</span> : null}
            <span>{sessLine}{teachers.length ? " · Багш: " : ""}{teachers.map(displayName).join(", ")}</span>
          </div>
          {t.topic ? <span className="muted">{t.topic}</span> : null}
        </div>
        {a.manage ? (
          <div className="row wrap">
            {t.scope === "public" ? <a className="btn" href={`/t/${t.public_code}`} target="_blank" rel="noopener noreferrer">Нийтийн хуудас</a> : null}
            <Link className="btn pri" href={`${base}?tab=invite`}><Icon n="plus" s={16} w={2.4} />Гишүүдийг урих</Link>
          </div>
        ) : null}
      </div>
      <Flash m={sp.m} />
    </>
  );

  if (!m) return <>{head}<div className="split"><div className="grow col g16">{info}</div><aside className="aside">{my}</aside></div></>;

  /* ---------- Удирдагчийн харагдац ---------- */
  const { parts, att } = m;
  const f = sp.f || "";
  const shown = f ? parts.filter((p) => p.state === f) : parts;
  let body: React.ReactNode = null;
  if (tab === "parts")
    body = (
      <>
        <form id="bulk" />
        <div className="row wrap" style={{ padding: "12px 16px", gap: 6 }}>
          {[["", `Бүгд · ${parts.length}`], ...Object.entries(P_STATE).filter(([k]) => counts[k]).map(([k, n]) => [k, `${n[1]} · ${counts[k]}`])].map(([k, n]) => (
            <Link key={k} className={`fchip${f === k ? " on" : ""}`} href={k ? `${base}?f=${k}` : base}>{n}</Link>
          ))}
        </div>
        {shown.length ? (
          <>
            <div className="row wrap" style={{ padding: "0 16px 12px", gap: 6 }}>
              <span className="small muted" style={{ marginRight: 4 }}>Сонгосон хүмүүсийг:</span>
              <button className="btn sm" form="bulk" formAction={bulkConfirm}>Оролцогч болгох</button>
              <button className="btn sm" form="bulk" formAction={bulkWaitlist}>Хүлээлгэд</button>
              <button className="btn sm" form="bulk" formAction={bulkComplete}>Дүүргэсэн</button>
              <button className="btn sm" form="bulk" formAction={bulkIncomplete}>Дутуу</button>
              <button className="btn sm pri" form="bulk" formAction={bulkToWaiting}>Waiting list рүү шилжүүлэх</button>
              <ConfirmButton className="btn sm danger" form="bulk" formAction={bulkRemove} message="Сонгосон хүмүүсийг энэ сургалтын жагсаалтаас хасах уу?">Хасах</ConfirmButton>
            </div>
            <div className="tscroll">
              <table className="t" style={{ minWidth: 560 + sessions.length * 56 }}>
                <thead>
                  <tr>
                    <th style={{ width: 40 }}><input type="hidden" name="training_id" value={t.id} form="bulk" /><CheckAll form="bulk" /></th>
                    <th>Нэр</th><th>Хариу</th>{t.fee ? <th>Төлбөр</th> : null}
                    {sessions.map((s, i) => <th key={s.id} style={{ textAlign: "center" }} title={fmtRange(s.starts_at, s.ends_at)}>{ubDay(s.starts_at).slice(5).replace("-", ".")}<span className="sr"> {i + 1}-р хичээл</span></th>)}
                    <th>Төгсөлт</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => {
                    const nm = displayName(p);
                    return (
                      <tr key={p.id}>
                        <td><input type="checkbox" name="pid" value={p.person_id} form="bulk" aria-label={`${nm} сонгох`} style={{ width: 18, height: 18, accentColor: "var(--pri)" }} /></td>
                        <td>
                          <span className="row wrap" style={{ gap: 6 }}>
                            <Link href={`/people/${p.person_id}`} style={{ fontWeight: 600 }}>{nm}</Link>
                            {p.is_registered ? null : <span className="chip" style={{ height: 20 }}>зочин</span>}
                          </span>
                          {p.phone ? <div className="tiny muted num">{p.phone}</div> : null}
                        </td>
                        <td><span className={`chip ${P_STATE[p.state]?.[0] || ""}`}>{P_STATE[p.state]?.[1] || p.state}</span></td>
                        {t.fee ? <td><span className={`chip ${PAY_STATE[p.pay_state]?.[0] || ""}`}>{PAY_STATE[p.pay_state]?.[1]}</span></td> : null}
                        {sessions.map((s) => {
                          const on = att.has(`${s.id}:${p.person_id}`);
                          return <td key={s.id} style={{ textAlign: "center" }}><ActBtn action={toggleAttendance} fields={{ training_id: t.id, session_id: s.id, person_id: p.person_id }} className={`att${on ? " on" : ""}`} pressed={on} label={`${nm} · ${ubDay(s.starts_at)}`}>{on ? <Icon n="check" s={14} w={2.6} /> : null}</ActBtn></td>;
                        })}
                        <td>{p.completion === "completed" ? <span className="chip ok">Дүүргэсэн</span> : p.completion === "incomplete" ? <span className="chip">Дутуу</span> : <span className="muted">—</span>}{p.certificate_no ? <div className="tiny muted num">{p.certificate_no}</div> : null}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="small muted" style={{ padding: "12px 16px" }}>Ирцийн нүдэн дээр дарж гараар засна. QR-аар уншуулсан ирц автоматаар орно.</div>
          </>
        ) : <div style={{ padding: 16 }}><Empty title="Оролцогч алга">«Гишүүдийг урих» товчоор урина уу.</Empty></div>}
      </>
    );
  if (tab === "sess")
    body = (
      <div className="col">
        {sessions.map((s, i) => (
          <div key={s.id} className="list-item" style={{ flexWrap: "wrap", alignItems: "flex-start" }}>
            <span className="av" style={{ width: 40, height: 40, background: "var(--pri-s)", color: "var(--pri-h)" }}>{i + 1}</span>
            <div className="col" style={{ flex: "1 1 220px", minWidth: 0 }}>
              <b>{i + 1}-р хичээл{s.title ? ` · ${s.title}` : ""}</b>
              <span className="small muted">{fmtDay(s.starts_at)} · {fmtRange(s.starts_at, s.ends_at).slice(11)}{s.place || t.place ? ` · ${s.place || t.place}` : ""}</span>
              <details>
                <summary className="small" style={{ cursor: "pointer" }}>Засах</summary>
                <form action={saveSession} className="row wrap" style={{ alignItems: "flex-end", paddingTop: 8 }}>
                  <input type="hidden" name="training_id" value={t.id} /><input type="hidden" name="id" value={s.id} />
                  <label className="field" style={{ flex: "1 1 150px" }}><span className="tiny muted">Гарчиг</span><input className="inp sm" name="title" maxLength={160} defaultValue={s.title || ""} /></label>
                  <label className="field"><span className="tiny muted">Эхлэх</span><input className="inp sm" type="datetime-local" name="starts_at" required defaultValue={localInput(s.starts_at)} /></label>
                  <label className="field"><span className="tiny muted">Дуусах</span><input className="inp sm" type="datetime-local" name="ends_at" defaultValue={localInput(s.ends_at)} /></label>
                  <label className="field" style={{ flex: "1 1 150px" }}><span className="tiny muted">Байршил</span><input className="inp sm" name="place" maxLength={200} defaultValue={s.place || ""} /></label>
                  <button className="btn sm">Хадгалах</button>
                  <ConfirmButton className="btn sm danger" formAction={deleteSession} message="Энэ хичээлийг ирцийн бүртгэлтэй нь устгах уу?">Устгах</ConfirmButton>
                </form>
              </details>
            </div>
            <span className="num small">{s.n} / {reg} ирсэн</span>
            <ActBtn action={toggleQr} fields={{ training_id: t.id, id: s.id }} className={`btn sm${s.qr_open ? " soft" : ""}`}>{s.qr_open ? "QR хаах" : "QR нээх"}</ActBtn>
            {s.qr_open ? <Link className="btn sm" href={`${base}/qr/${s.id}`}><Icon n="qr" s={14} />Дэлгэцэнд</Link> : null}
          </div>
        ))}
        <form action={saveSession} className="row wrap" style={{ padding: 16, alignItems: "flex-end" }}>
          <input type="hidden" name="training_id" value={t.id} />
          <label className="field" style={{ flex: "1 1 150px" }}><span className="tiny muted">Гарчиг (заавал биш)</span><input className="inp sm" name="title" maxLength={160} /></label>
          <label className="field"><span className="tiny muted">Эхлэх</span><input className="inp sm" type="datetime-local" name="starts_at" required /></label>
          <label className="field"><span className="tiny muted">Дуусах</span><input className="inp sm" type="datetime-local" name="ends_at" /></label>
          <label className="field" style={{ flex: "1 1 150px" }}><span className="tiny muted">Байршил</span><input className="inp sm" name="place" maxLength={200} placeholder={t.place || ""} /></label>
          <button className="btn sm pri">Хичээл нэмэх</button>
        </form>
      </div>
    );
  if (tab === "invite" && m.inv) {
    const inList = new Set(parts.map((p) => p.person_id));
    const { lk, people, before } = m.inv;
    const cand = people.filter((p) => !inList.has(p.id) && p.id !== v.personId
      && (!sp.role || p.role_name === sp.role) && (!sp.st || p.status_id === sp.st) && (!sp.kn || p.knowledge_level_id === sp.kn)
      && (!sp.prev || (sp.prev === "yes") === before.has(p.id)));
    const filtered = !!(sp.role || sp.st || sp.kn || sp.prev);
    const stBy = new Map(lk.statuses.map((s) => [s.id, s]));
    body = (
      <div className="col g16" style={{ padding: 16 }}>
        <form action={inviteToTraining} className="col g12">
          <input type="hidden" name="training_id" value={t.id} />
          <b className="small">Нэг бүрчлэн сонгож урих</b>
          <MultiPicker name="people" options={m.people.filter((p) => !inList.has(p.id))} placeholder="Нэрээр хайж нэмэх" />
          <button className="btn sm pri" style={{ alignSelf: "flex-start" }}>Урилга илгээх</button>
        </form>
        <form action={base} className="col g12" style={{ borderTop: "1px solid var(--line)", paddingTop: 16 }}>
          <input type="hidden" name="tab" value="invite" />
          <b className="small">Шүүлтүүрээр урих</b>
          <div className="row wrap">
            <select className="inp sm" name="role" defaultValue={sp.role || ""} style={{ width: "auto" }} aria-label="Түвшин"><option value="">Түвшин: бүгд</option>{lk.roles.map((r) => <option key={r.id} value={r.name}>{r.name}</option>)}</select>
            <select className="inp sm" name="st" defaultValue={sp.st || ""} style={{ width: "auto" }} aria-label="Явцын төлөв"><option value="">Төлөв: бүгд</option>{lk.statuses.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            {v.fields.has("knowledge") ? <select className="inp sm" name="kn" defaultValue={sp.kn || ""} style={{ width: "auto" }} aria-label="Мэдлэгийн түвшин"><option value="">Мэдлэг: бүгд</option>{lk.knowledge.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select> : null}
            <select className="inp sm" name="prev" defaultValue={sp.prev || ""} style={{ width: "auto" }} aria-label="Өмнө суусан эсэх"><option value="">Өмнө суусан эсэх: бүгд</option><option value="yes">Өмнө сургалтад суусан</option><option value="no">Өмнө суугаагүй</option></select>
            <button className="btn sm">Шүүх</button>
          </div>
        </form>
        {filtered ? (
          cand.length ? (
            <form action={inviteToTraining} className="col g12">
              <input type="hidden" name="training_id" value={t.id} />
              <span className="small muted">{cand.length} хүн таарлаа. Урихгүй хүнийхээ чагтыг авна уу.</span>
              <div className="checks" style={{ maxHeight: 320, overflow: "auto" }}>
                {cand.slice(0, 500).map((p) => (
                  <label key={p.id} className="row small" style={{ gap: 8 }}><input type="checkbox" name="pid" value={p.id} defaultChecked />{p.name}<span className="muted">{stBy.get(p.status_id || "")?.name || ""}</span></label>
                ))}
              </div>
              <button className="btn pri" style={{ alignSelf: "flex-start" }}>Сонгосон хүмүүст урилга илгээх</button>
            </form>
          ) : <Empty title="Шүүлтэд таарах хүн алга" />
        ) : null}
      </div>
    );
  }
  if (tab === "pay") body = <TrainingPayTab t={t} v={v} />;
  if (tab === "survey") {
    const n = m.surveys.length;
    const avg = n ? m.surveys.reduce((s, r) => s + r.rating, 0) / n : 0;
    body = (
      <div className="col g12" style={{ padding: 16 }}>
        <div className="kpis">
          <div className="kpi"><span className="small muted">Дундаж үнэлгээ</span><b className="num">{n ? avg.toFixed(1) : "—"} <span style={{ fontSize: 15, color: "var(--muted)" }}>/ 5</span></b></div>
          <div className="kpi"><span className="small muted">Хариулсан</span><b className="num">{n} <span style={{ fontSize: 15, color: "var(--muted)" }}>/ {reg}</span></b></div>
          <div className="kpi"><span className="small muted">Санал асуулга</span><b style={{ fontSize: 18 }}>{t.survey_open ? "Нээлттэй" : "Хаалттай"}</b><span className="tiny muted">«Тохиргоо» хэсгээс нээнэ</span></div>
        </div>
        {m.surveys.filter((s) => s.comment).map((s, i) => (
          <div key={i} className="list-item" style={{ alignItems: "flex-start" }}><span className="chip pri">{s.rating} / 5</span><span style={{ flex: 1, whiteSpace: "pre-wrap" }}>{s.comment}</span></div>
        ))}
        {n ? <span className="tiny muted">Үнэлгээг нэргүйгээр харуулж байна.</span> : <Empty title="Одоогоор үнэлгээ алга" />}
      </div>
    );
  }
  if (tab === "set") {
    const coBy = new Map(m.co.map((c) => [c.urguu_id, c]));
    const lead = m.co.find((c) => c.is_lead);
    body = (
      <div className="col g24" style={{ padding: 16, maxWidth: 760 }}>
        <TrainingForm t={t} people={m.people} teachers={teachers.map((p) => ({ id: p.id, label: displayName(p) }))} />
        {others.length && v.perms.has("training.manage") ? (
          <form action={saveCoUrguus} className="col g12" style={{ borderTop: "1px solid var(--line)", paddingTop: 16 }}>
            <input type="hidden" name="training_id" value={t.id} />
            <div className="col g4">
              <h2>Хамтран зохион байгуулагч өргөө</h2>
              <span className="small muted">Сонгосон өргөөний гишүүдэд сургалт харагдана. Төлбөрийг {v.urguu.name} хүлээн авч, доорх хувиар тооцоог гараар хийнэ (санхүүгийн тайланд гарна). Одоо {v.urguu.name}-ийн хувь: {lead ? Number(lead.share_pct) : 100}%.</span>
            </div>
            {others.map((u) => (
              <div key={u.id} className="row wrap">
                <label className="row small" style={{ gap: 8, flex: "1 1 200px" }}><input type="checkbox" name={`u_${u.id}`} defaultChecked={coBy.has(u.id)} />{u.name}</label>
                <label className="row small" style={{ gap: 6 }}>Орлогын хувь<input className="inp sm" name={`pct_${u.id}`} inputMode="decimal" defaultValue={coBy.has(u.id) ? Number(coBy.get(u.id)!.share_pct) : 0} style={{ width: 80 }} aria-label={`${u.name}: орлогын хувь`} />%</label>
              </div>
            ))}
            <button className="btn sm" style={{ alignSelf: "flex-start" }}>Хадгалах</button>
          </form>
        ) : null}
        {v.perms.has("training.manage") ? <div><ActBtn action={deleteTraining} fields={{ training_id: t.id }} className="btn sm danger" confirm={`«${t.name}» сургалтыг бүх бүртгэлтэй нь устгах уу?`}>Сургалтыг устгах</ActBtn></div> : null}
      </div>
    );
  }
  const TABS: [string, string][] = [["parts", `Оролцогчид · ${parts.length}`], ["sess", `Хичээл ба ирц · ${sessions.length}`], ["invite", "Урих"], ["pay", "Төлбөр"], ["survey", "Санал асуулга"], ["set", "Тохиргоо"]];
  return (
    <>
      {head}
      <div className="kpis">
        <div className="kpi"><span className="small muted">Бүртгүүлсэн</span><b className="num">{reg}{t.capacity ? <span style={{ fontSize: 15, color: "var(--muted)" }}> / {t.capacity}</span> : null}</b>{t.capacity ? <div className="bar" style={{ height: 6 }}><span style={{ width: `${Math.min(100, Math.round((reg / t.capacity) * 100))}%` }} /></div> : null}</div>
        <div className="kpi"><span className="small muted">Хариу хүлээж буй</span><b className="num">{(counts.invited || 0) + (counts.maybe || 0)}</b><span className="tiny muted">урьсан, магадгүй</span></div>
        <div className="kpi"><span className="small muted">Хүлээлгийн жагсаалт</span><b className="num" style={counts.waitlist ? { color: "var(--warn-ink)" } : undefined}>{counts.waitlist || 0}</b></div>
        {cur ? <div className="kpi"><span className="small muted">{sessions.indexOf(cur) + 1}-р хичээлийн ирц</span><b className="num">{cur.n} <span style={{ fontSize: 15, color: "var(--muted)" }}>/ {reg}</span></b><span className="tiny muted">{ubDay(cur.starts_at)} · {fmtTime(cur.starts_at)}</span></div> : null}
      </div>
      <div className="split">
        <section className="grow card p0">
          <div className="tabs" role="tablist" style={{ padding: "0 12px" }}>
            {TABS.filter(([k]) => k !== "pay" || t.fee > 0).map(([k, n]) => <Link key={k} href={`${base}?tab=${k}`} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""}>{n}</Link>)}
          </div>
          {body}
        </section>
        <aside className="aside">
          {cur ? (
            <div className="card col g12">
              <div className="row between"><h2>Ирцийн QR</h2>{cur.qr_open ? <span className="live"><span className="dot" />Идэвхтэй</span> : null}</div>
              <span className="small" style={{ color: "var(--ink2)" }}>{sessions.indexOf(cur) + 1}-р хичээл · {ubDay(cur.starts_at)}. Оролцогч утсаараа уншуулж ирцээ бүртгүүлнэ.</span>
              {cur.qr_open ? (
                <>
                  <Qr text={`${SITE_URL}/a/${cur.id}/${attToken(cur.id)}`} />
                  <Link className="btn" href={`${base}/qr/${cur.id}`}>Дэлгэцэнд томоор харуулах</Link>
                  <ActBtn action={toggleQr} fields={{ training_id: t.id, id: cur.id, back: `${base}?tab=${tab}` }} className="btn ghost sm">QR хаах</ActBtn>
                </>
              ) : <ActBtn action={toggleQr} fields={{ training_id: t.id, id: cur.id, back: `${base}?tab=${tab}` }} className="btn pri">QR нээх</ActBtn>}
            </div>
          ) : null}
          {my}
          {info}
        </aside>
      </div>
    </>
  );
}
