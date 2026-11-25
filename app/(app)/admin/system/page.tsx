import Link from "next/link";
import { assignUrguuAdmin, createUrguuAction, resolveError, retryOutbox, saveUrguu, setUrguuState } from "@/app/actions/system";
import { ConfirmButton } from "@/components/AutoSubmit";
import { Flash } from "@/components/Flash";
import { Empty } from "@/components/ui";
import { fmtDateTime } from "@/lib/audit-text";
import { sys } from "@/lib/db";
import { MAX_ATTEMPTS } from "@/lib/outbox";
import { realtimeStats } from "@/lib/realtime";
import { smsMode } from "@/lib/sms";
import { requirePlatformAdmin } from "@/lib/viewer";

export const metadata = { title: "Систем" };

const TABS = [["urguu", "Өргөөнүүд"], ["outbox", "Мэдэгдэл"], ["errors", "Алдаа, төлөв"]] as const;
const SOURCE: Record<string, string> = { server: "Сервер", worker: "Дэвсгэр ажил", client: "Хөтөч" };
type Err = { id: string; source: string; message: string; stack: string | null; route: string | null; digest: string | null; build: string | null; count: number; first_at: Date; last_at: Date };
const TEMPLATE: Record<string, string> = {
  magic_link: "Нэвтрэх холбоос", invite: "Урилга", admin_new_request: "Админд: шинэ хүсэлт", membership_approved: "Бүртгэл батлагдсан",
  membership_rejected: "Бүртгэл татгалзсан", otp_login: "SMS код (нэвтрэх)", otp_verify: "SMS код (утас баталгаажуулах)",
};
const STATE: Record<string, [string, string]> = { queued: ["warn", "Хүлээгдэж буй"], sent: ["ok", "Илгээгдсэн"], failed: ["bad", "Амжилтгүй"] };

type Out = { id: string; channel: string; recipient: string; template: string; state: string; attempts: number; last_error: string | null; created_at: Date; sent_at: Date | null; next_attempt_at: Date; retryable: boolean };

export default async function System({ searchParams }: { searchParams: Promise<{ tab?: string; m?: string }> }) {
  const v = await requirePlatformAdmin();
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "urguu";
  const rows = await sys<Out>(
    `SELECT id, channel, recipient, template, state, attempts, last_error, created_at, sent_at, next_attempt_at, (payload ? 'body' OR payload ? 'text') AS retryable
     FROM notification_outbox ORDER BY id DESC LIMIT 100`);
  const [c] = await sys<{ queued: number; failed: number; sent: number }>(
    `SELECT count(*) FILTER (WHERE state = 'queued')::int AS queued, count(*) FILTER (WHERE state = 'failed')::int AS failed,
            count(*) FILTER (WHERE state = 'sent' AND sent_at > now() - interval '7 days')::int AS sent FROM notification_outbox`);
  const rt = realtimeStats();
  const urguus = tab === "urguu"
    ? await sys<{ id: string; name: string; description: string | null; state: string; created_at: Date; members: number; pending: number; ongods: number; admins: string | null }>(
        `SELECT u.id, u.name, u.description, u.state, u.created_at,
           (SELECT count(*)::int FROM membership m WHERE m.urguu_id = u.id AND m.state = 'approved') AS members,
           (SELECT count(*)::int FROM membership m WHERE m.urguu_id = u.id AND m.state = 'pending') AS pending,
           (SELECT count(*)::int FROM ongod o WHERE o.urguu_id = u.id) AS ongods,
           (SELECT string_agg(coalesce(left(p.father_name, 1) || '.', '') || p.given_name, ', ' ORDER BY p.given_name)
              FROM membership m JOIN person p ON p.id = m.person_id JOIN role r ON r.id = m.role_id
              WHERE m.urguu_id = u.id AND m.state = 'approved' AND NOT r.is_system
                AND EXISTS (SELECT 1 FROM permission pm WHERE pm.role_id = r.id AND pm.key = 'settings.manage')) AS admins
         FROM urguu u ORDER BY u.created_at`)
    : [];
  const errs = tab === "errors" ? await sys<Err>("SELECT id, source, message, stack, route, digest, build, count, first_at, last_at FROM error_log ORDER BY last_at DESC LIMIT 100") : [];
  const [st] = tab === "errors"
    ? await sys<{ db: string; day: number; people: number }>(
        `SELECT pg_size_pretty(pg_database_size(current_database())) AS db,
                (SELECT count(*)::int FROM error_log WHERE last_at > now() - interval '24 hours') AS day,
                (SELECT count(*)::int FROM person) AS people`)
    : [null];
  const up = Math.floor(process.uptime());
  const upText = up >= 86400 ? `${Math.floor(up / 86400)} хоног` : up >= 3600 ? `${Math.floor(up / 3600)} цаг` : `${Math.max(1, Math.floor(up / 60))} мин`;
  return (
    <>
      <div className="pagehead"><div><div className="crumb">Платформ · {v.personName}</div><h1>Систем</h1></div></div>
      <div className="tabs" role="tablist">
        {TABS.map(([k, n]) => <Link key={k} href={`/admin/system?tab=${k}`} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""}>{n}</Link>)}
      </div>
      <Flash m={sp.m} />
      {tab === "outbox" ? (
        <>
          <div className="kpis">
            <div className="kpi"><span className="small muted">Хүлээгдэж буй</span><b className="num">{c.queued}</b></div>
            <div className="kpi"><span className="small muted">Амжилтгүй</span><b className="num">{c.failed}</b></div>
            <div className="kpi"><span className="small muted">Илгээгдсэн (7 хоног)</span><b className="num">{c.sent}</b></div>
            <div className="kpi"><span className="small muted">Шууд холболт</span><b className="num">{rt.subscribers}</b></div>
          </div>
          <div className="card p0">
            <div className="row wrap between" style={{ padding: "16px 16px 8px" }}>
              <div className="col g4">
                <h2>Мэдэгдлийн дараалал</h2>
                <span className="small muted">
                  Амжилтгүй болсон мэдэгдлийг систем {MAX_ATTEMPTS} удаа хүртэл дахин оролдоно (1, 5, 30, 120 минутын зайтай). Нэвтрэх холбоос, урилга, SMS кодын агуулга хадгалагдахгүй тул дахин илгээгдэхгүй.
                  {" "}Имэйл: {process.env.EMAIL_SERVER ? "тохируулсан" : "тохируулаагүй (лог руу бичнэ)"} · SMS: {{ http: "тохируулсан", log: "туршилтын горим (лог руу бичнэ)", off: "тохируулаагүй" }[smsMode()]}.
                </span>
              </div>
              {c.queued ? <form action={retryOutbox}><button className="btn sm">Одоо оролдох</button></form> : null}
            </div>
            {rows.length ? (
              <div className="tscroll">
                <table className="t">
                  <thead><tr><th>Огноо</th><th>Суваг</th><th>Хүлээн авагч</th><th>Төрөл</th><th>Төлөв</th><th>Оролдлого</th><th /></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td className="num small">{fmtDateTime(r.created_at)}</td>
                        <td>{r.channel === "sms" ? "SMS" : "Имэйл"}</td>
                        <td style={{ overflowWrap: "anywhere" }}>{r.recipient}</td>
                        <td>{TEMPLATE[r.template] || r.template}</td>
                        <td>
                          <span className={`chip ${STATE[r.state]?.[0] || ""}`} style={{ height: 22 }}>{STATE[r.state]?.[1] || r.state}</span>
                          {r.last_error ? <div className="tiny muted" style={{ maxWidth: 260, overflowWrap: "anywhere" }}>{r.last_error}</div> : null}
                          {r.state === "queued" && r.attempts ? <div className="tiny muted">Дараагийн оролдлого: {fmtDateTime(r.next_attempt_at)}</div> : null}
                        </td>
                        <td className="num">{r.attempts}</td>
                        <td>{r.state === "failed" && r.retryable ? <form action={retryOutbox}><input type="hidden" name="id" value={r.id} /><button className="btn sm">Дахин илгээх</button></form> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty title="Мэдэгдэл алга" />}
          </div>
        </>
      ) : null}
      {tab === "errors" && st ? (
        <>
          <div className="kpis">
            <div className="kpi"><span className="small muted">Алдаа (24 цаг)</span><b className="num">{st.day}</b></div>
            <div className="kpi"><span className="small muted">Тасралтгүй ажилласан</span><b className="num">{upText}</b></div>
            <div className="kpi"><span className="small muted">Санах ой (апп)</span><b className="num">{Math.round(process.memoryUsage().rss / 1048576)} MB</b></div>
            <div className="kpi"><span className="small muted">Өгөгдлийн сан</span><b className="num">{st.db}</b></div>
          </div>
          <div className="card p0">
            <div className="row wrap between" style={{ padding: "16px 16px 8px" }}>
              <div className="col g4">
                <h2>Алдааны бүртгэл</h2>
                <span className="small muted">
                  Серверт болон хөтөч дээр гарсан алдаа автоматаар бүртгэгдэнэ. Ижил алдаа нэг мөрөнд тоологдоно. Шинэ алдаа гарвал супер админд имэйл очно (ижил алдаанд 24 цагт нэг удаа). 30 хоногийн дараа автоматаар устна.
                  {" "}Орчин: {process.env.APP_ENV === "staging" ? "туршилтын (staging)" : "үндсэн"} · Хувилбар: {(process.env.NEXT_PUBLIC_BUILD_SHA || "local").slice(0, 7)} · Шууд холболт: {rt.subscribers}
                </span>
              </div>
              {errs.length ? <form action={resolveError}><input type="hidden" name="all" value="1" /><ConfirmButton className="btn sm" message="Алдааны жагсаалтыг бүхэлд нь цэвэрлэх үү?">Бүгдийг цэвэрлэх</ConfirmButton></form> : null}
            </div>
            {errs.length ? errs.map((e) => (
              <div key={e.id} className="list-item" style={{ flexWrap: "wrap", alignItems: "flex-start" }}>
                <div className="col g4" style={{ flex: "1 1 320px", minWidth: 0 }}>
                  <div className="row wrap" style={{ gap: 8 }}>
                    <span className={`chip ${e.source === "client" ? "" : "bad"}`} style={{ height: 22 }}>{SOURCE[e.source] || e.source}</span>
                    {e.count > 1 ? <span className="chip warn" style={{ height: 22 }}>{e.count} удаа</span> : null}
                    <span className="tiny muted num">{fmtDateTime(e.last_at)}{e.count > 1 ? ` (анх ${fmtDateTime(e.first_at)})` : ""}</span>
                  </div>
                  <b style={{ overflowWrap: "anywhere" }}>{e.message}</b>
                  <span className="tiny muted" style={{ overflowWrap: "anywhere" }}>{[e.route, e.digest ? `код ${e.digest}` : null, e.build ? `хувилбар ${e.build.slice(0, 7)}` : null].filter(Boolean).join(" · ")}</span>
                  {e.stack ? (
                    <details>
                      <summary className="small" style={{ cursor: "pointer" }}>Дэлгэрэнгүй</summary>
                      <pre className="tiny" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: "8px 0 0", padding: 12, background: "var(--sunk)", borderRadius: 8, maxHeight: 280, overflow: "auto" }}>{e.stack}</pre>
                    </details>
                  ) : null}
                </div>
                <form action={resolveError}><input type="hidden" name="id" value={e.id} /><button className="btn sm">Шийдвэрлэсэн</button></form>
              </div>
            )) : <Empty title="Алдаа бүртгэгдээгүй" />}
          </div>
        </>
      ) : null}
      {tab === "urguu" ? (
        <>
          {urguus.map((u) => (
            <div className="card col g12" key={u.id}>
              <div className="row wrap between">
                <div className="row wrap" style={{ gap: 8 }}>
                  <h2>{u.name}</h2>
                  <span className={`chip ${u.state === "active" ? "ok" : "bad"}`} style={{ height: 22 }}>{u.state === "active" ? "Идэвхтэй" : "Хаагдсан"}</span>
                  {u.id === v.urguu.id ? <span className="chip pri" style={{ height: 22 }}>Одоо энд</span> : null}
                </div>
                <span className="small muted num">{u.members} гишүүн · {u.pending} хүлээгдэж буй · {u.ongods} онгодын зангилаа</span>
              </div>
              <span className="small"><span className="muted">Админ: </span>{u.admins || <span className="muted">томилогдоогүй</span>}</span>
              <form action={saveUrguu} className="row wrap" style={{ alignItems: "flex-end" }}>
                <input type="hidden" name="id" value={u.id} />
                <label className="field" style={{ flex: "1 1 180px" }}><span className="tiny muted">Нэр</span><input className="inp sm" name="name" required defaultValue={u.name} maxLength={120} /></label>
                <label className="field" style={{ flex: "2 1 220px" }}><span className="tiny muted">Тайлбар</span><input className="inp sm" name="description" defaultValue={u.description || ""} maxLength={500} /></label>
                <button className="btn sm">Хадгалах</button>
                <input type="hidden" name="state" value={u.state === "active" ? "closed" : "active"} />
                {u.state === "active"
                  ? <ConfirmButton className="btn sm danger" formAction={setUrguuState} message={`«${u.name}» өргөөг хаах уу? Өгөгдөл хадгалагдана, гэхдээ гишүүд нь нэвтэрч харах боломжгүй болно.`}>Хаах</ConfirmButton>
                  : <button className="btn sm soft" formAction={setUrguuState}>Дахин нээх</button>}
              </form>
              {u.state === "active" ? (
                <form action={assignUrguuAdmin} className="row wrap" style={{ alignItems: "flex-end" }}>
                  <input type="hidden" name="urguu_id" value={u.id} />
                  <label className="field" style={{ flex: "1 1 240px" }}><span className="tiny muted">Админ томилох (имэйлээр)</span><input className="inp sm" type="email" name="email" required placeholder="admin@example.com" maxLength={254} /></label>
                  <button className="btn sm soft">Томилох</button>
                  <span className="tiny muted" style={{ flexBasis: "100%" }}>Бүртгэлтэй хүн бол шууд админ болно. Бүртгэлгүй бол 7 хоногийн урилга очно.</span>
                </form>
              ) : null}
            </div>
          ))}
          <form action={createUrguuAction} className="card col g12">
            <div className="col g4"><h2>Шинэ өргөө үүсгэх</h2><span className="small muted">Түвшин, үйлдлийн эрх, харагдац, талбарын эрх, дээдсийн жагсаалт загвар өргөөнөөс хуулагдана. Хүмүүс хуулагдахгүй.</span></div>
            <div className="formgrid">
              <label className="field"><span>Нэр <span className="req">*</span></span><input className="inp" name="name" required maxLength={120} /></label>
              <label className="field">Тайлбар<input className="inp" name="description" maxLength={500} /></label>
              <label className="field">Тохиргооны загвар
                <select className="inp" name="template_id" defaultValue={urguus[0]?.id}>{urguus.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
              </label>
              <label className="field">Онгодын мод
                <select className="inp" name="ongod_from" defaultValue="">
                  <option value="">Хоосноор эхлэх</option>
                  {urguus.map((u) => <option key={u.id} value={u.id}>{u.name}-ийн модыг хуулах ({u.ongods})</option>)}
                </select>
              </label>
            </div>
            <div><button className="btn pri">Өргөө үүсгэх</button></div>
          </form>
        </>
      ) : null}
    </>
  );
}
