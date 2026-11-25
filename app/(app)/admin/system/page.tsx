import Link from "next/link";
import { retryOutbox } from "@/app/actions/system";
import { Flash } from "@/components/Flash";
import { Empty } from "@/components/ui";
import { fmtDateTime } from "@/lib/audit-text";
import { sys } from "@/lib/db";
import { MAX_ATTEMPTS } from "@/lib/outbox";
import { realtimeStats } from "@/lib/realtime";
import { smsMode } from "@/lib/sms";
import { requirePlatformAdmin } from "@/lib/viewer";

export const metadata = { title: "Систем" };

const TABS = [["outbox", "Мэдэгдэл"]] as const;
const TEMPLATE: Record<string, string> = {
  magic_link: "Нэвтрэх холбоос", invite: "Урилга", admin_new_request: "Админд: шинэ хүсэлт", membership_approved: "Бүртгэл батлагдсан",
  membership_rejected: "Бүртгэл татгалзсан", otp_login: "SMS код (нэвтрэх)", otp_verify: "SMS код (утас баталгаажуулах)",
};
const STATE: Record<string, [string, string]> = { queued: ["warn", "Хүлээгдэж буй"], sent: ["ok", "Илгээгдсэн"], failed: ["bad", "Амжилтгүй"] };

type Out = { id: string; channel: string; recipient: string; template: string; state: string; attempts: number; last_error: string | null; created_at: Date; sent_at: Date | null; next_attempt_at: Date; retryable: boolean };

export default async function System({ searchParams }: { searchParams: Promise<{ tab?: string; m?: string }> }) {
  const v = await requirePlatformAdmin();
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "outbox";
  const rows = await sys<Out>(
    `SELECT id, channel, recipient, template, state, attempts, last_error, created_at, sent_at, next_attempt_at, (payload ? 'body' OR payload ? 'text') AS retryable
     FROM notification_outbox ORDER BY id DESC LIMIT 100`);
  const [c] = await sys<{ queued: number; failed: number; sent: number }>(
    `SELECT count(*) FILTER (WHERE state = 'queued')::int AS queued, count(*) FILTER (WHERE state = 'failed')::int AS failed,
            count(*) FILTER (WHERE state = 'sent' AND sent_at > now() - interval '7 days')::int AS sent FROM notification_outbox`);
  const rt = realtimeStats();
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
    </>
  );
}
