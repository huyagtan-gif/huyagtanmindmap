import Link from "next/link";
import { refundPayment, saveQpayConfig, testQpay } from "@/app/actions/pay";
import { donorName } from "@/components/DonationCard";
import { Flash } from "@/components/Flash";
import { Empty, Icon } from "@/components/ui";
import { sys } from "@/lib/db";
import { finRange, financeReport } from "@/lib/finance";
import { PAYMENT_STATE, type Payment } from "@/lib/payments";
import { qpayMock } from "@/lib/qpay";
import { fmtRange, money } from "@/lib/time";
import { asViewer, requireMember } from "@/lib/viewer";
import { redirect } from "next/navigation";

export const metadata = { title: "Санхүү" };

type SP = { tab?: string; from?: string; to?: string; m?: string; st?: string; kind?: string };

/** P4.7 Санхүүгийн тайлан, P4.5 буцаалт, P4.3 тулгалт, P4.1 QPay тохиргоо. */
export default async function Finance({ searchParams }: { searchParams: Promise<SP> }) {
  const v = await requireMember();
  const canView = v.perms.has("finance.view"), canPay = v.perms.has("payment.manage");
  if (!canView && !canPay) redirect("/me");
  const sp = await searchParams;
  const tabs = ([["report", "Тайлан"], ["payments", "Гүйлгээ"], ["recon", "Тулгалт"], ["qpay", "QPay тохиргоо"]] as const)
    .filter(([k]) => (k === "qpay" ? canPay : canView));
  const tab = tabs.some(([k]) => k === sp.tab) ? sp.tab! : tabs[0][0];
  const r = finRange(sp.from, sp.to);
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, val] of Object.entries({ tab, from: r.fromYmd, to: r.toYmd, st: sp.st, kind: sp.kind, ...patch })) if (val) p.set(k, val);
    return `?${p}`;
  };
  let body: React.ReactNode = null;

  if (tab === "report") {
    const rep = await asViewer(v, (q) => financeReport(q, r));
    const net = rep.totals.training + rep.totals.donation;
    body = (
      <div className="col g16">
        <div className="kpis">
          <div className="kpi"><span className="small muted">Нийт орлого</span><b className="num">{money(net)}</b><span className="tiny muted">буцаалтыг хассан</span></div>
          <div className="kpi"><span className="small muted">Сургалтын төлбөр</span><b className="num">{money(rep.totals.training)}</b>{rep.totals.manual ? <span className="tiny muted">үүнээс гараар {money(rep.totals.manual)}</span> : null}</div>
          <div className="kpi"><span className="small muted">Хандив</span><b className="num">{money(rep.totals.donation)}</b></div>
          <div className="kpi"><span className="small muted">Буцаасан</span><b className="num">{money(rep.totals.refunded)}</b><span className="tiny muted">хүлээгдэж буй нэхэмжлэх: {rep.totals.pending}</span></div>
        </div>
        <div className="card p0">
          <div style={{ padding: "14px 16px" }}><h2>Сургалтаар</h2></div>
          {rep.trainings.length ? (
            <div className="tscroll"><table className="t">
              <thead><tr><th>Сургалт</th><th>Төлсөн</th><th>Орлого</th><th>Буцаасан</th><th>Өргөөдийн хувь</th></tr></thead>
              <tbody>{rep.trainings.map((t) => (
                <tr key={t.id}>
                  <td><Link href={`/trainings/${t.id}?tab=pay`}>{t.name}</Link></td><td className="num">{t.paid_count}</td><td className="num">{money(t.gross)}</td><td className="num">{t.refunded ? money(t.refunded) : "—"}</td>
                  <td>{t.shares.map((s) => <div key={s.urguu} className="small">{s.urguu}{s.lead ? " (хүлээн авагч)" : ""}: {s.pct}% · <span className="num">{money(s.amount)}</span></div>)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <div style={{ padding: 16 }}><Empty title="Энэ хугацаанд сургалтын төлбөр алга" /></div>}
        </div>
        {rep.partner.length ? (
          <div className="card p0">
            <div className="col g4" style={{ padding: "14px 16px" }}><h2>Хамтарсан сургалтаас авах хувь</h2><span className="small muted">Өөр өргөө хүлээн авсан төлбөрөөс танай өргөөнд ногдох хэсэг. Тооцоог өргөөд хооронд гараар хийнэ.</span></div>
            <div className="tscroll"><table className="t">
              <thead><tr><th>Сургалт</th><th>Хүлээн авсан өргөө</th><th>Нийт</th><th>Танай хувь</th></tr></thead>
              <tbody>{rep.partner.map((p) => <tr key={p.training_id}><td>{p.training_name}</td><td>{p.lead_urguu}</td><td className="num">{money(p.gross)}</td><td className="num">{p.share_pct}% · {money(p.share)}</td></tr>)}</tbody>
            </table></div>
          </div>
        ) : null}
        <div className="card p0">
          <div style={{ padding: "14px 16px" }}><h2>Хандив</h2></div>
          {rep.donations.length ? rep.donations.map((d) => (
            <div key={d.event_id || "none"} className="list-item" style={{ minHeight: 0 }}>
              <span style={{ flex: 1 }}>{d.event_id ? <Link href={`/events/${d.event_id}`}>{d.name}</Link> : d.name}</span>
              <span className="small muted">{d.count} хандив</span><b className="num">{money(d.sum)}</b>
            </div>
          )) : <div style={{ padding: 16 }}><Empty title="Энэ хугацаанд хандив алга" /></div>}
        </div>
      </div>
    );
  }

  if (tab === "payments") {
    const st = Object.keys(PAYMENT_STATE).includes(sp.st || "") ? sp.st! : "";
    const kind = sp.kind === "training" || sp.kind === "donation" ? sp.kind : "";
    const rows = await asViewer(v, (q) => q<Payment & { given_name: string | null; father_name: string | null; what: string | null }>(
      `SELECT pm.*, p.given_name, p.father_name, coalesce(t.name, e.name) AS what FROM payment pm
       LEFT JOIN person p ON p.id = pm.payer_person_id LEFT JOIN training t ON t.id = pm.training_id LEFT JOIN event e ON e.id = pm.event_id
       WHERE pm.urguu_id = app_urguu() AND pm.created_at >= $1 AND pm.created_at < $2 AND ($3 = '' OR pm.state = $3) AND ($4 = '' OR pm.kind = $4)
       ORDER BY pm.created_at DESC LIMIT 500`, [r.from, r.to, st, kind]));
    body = (
      <div className="card p0">
        <div className="row wrap" style={{ padding: "12px 16px", gap: 6 }}>
          {[["", "Бүгд"], ...Object.entries(PAYMENT_STATE).map(([k, n]) => [k, n[1]])].map(([k, n]) => <Link key={k} className={`fchip${st === k ? " on" : ""}`} href={`/admin/finance${qs({ st: k || undefined })}`}>{n}</Link>)}
          <span style={{ width: 12 }} />
          {[["", "Бүх төрөл"], ["training", "Сургалт"], ["donation", "Хандив"]].map(([k, n]) => <Link key={k} className={`fchip${kind === k ? " on" : ""}`} href={`/admin/finance${qs({ kind: k || undefined })}`}>{n}</Link>)}
        </div>
        {rows.length ? rows.map((p) => (
          <div key={p.id} className="list-item" style={{ flexWrap: "wrap", minHeight: 0 }}>
            <div className="col" style={{ flex: "1 1 220px", minWidth: 0 }}>
              <b>{p.kind === "donation" ? donorName(p) : p.given_name ? donorName({ ...p, anonymous: false }) : p.payer_name || "—"}</b>
              <span className="tiny muted">{p.kind === "training" ? "Сургалт" : "Хандив"}{p.what ? ` · ${p.what}` : ""} · {fmtRange(p.created_at)} · {p.method === "manual" ? "гараар" : "QPay"} · <span className="num">{p.sender_invoice_no}</span>{p.refund_note ? ` · ${p.refund_note}` : ""}</span>
            </div>
            <b className="num">{money(p.amount)}</b>
            <span className={`chip ${PAYMENT_STATE[p.state]?.[0] || ""}`}>{PAYMENT_STATE[p.state]?.[1]}</span>
            {canPay && p.state === "paid" ? (
              <form action={refundPayment} className="row" style={{ gap: 6 }}>
                <input type="hidden" name="payment_id" value={p.id} /><input type="hidden" name="back" value={`/admin/finance${qs({})}`} />
                <input className="inp sm" name="note" placeholder="Шалтгаан" maxLength={300} style={{ width: 150 }} aria-label="Буцаалтын тэмдэглэл" />
                <button className="btn sm danger">Буцаалт</button>
              </form>
            ) : null}
          </div>
        )) : <div style={{ padding: 16 }}><Empty title="Гүйлгээ алга" /></div>}
      </div>
    );
  }

  if (tab === "recon") {
    const recs = await sys<{ day: string; checked: number; fixed: number; mismatches: { id: string; invoice: string; expected: number; got: number; state: string }[] }>(
      "SELECT day::text, checked, fixed, mismatches FROM payment_recon ORDER BY day DESC LIMIT 60");
    const own = new Set((await asViewer(v, (q) => q<{ id: string }>("SELECT id FROM payment WHERE id = ANY($1::uuid[])", [recs.flatMap((x) => x.mismatches.map((m) => m.id))]))).map((x) => x.id));
    body = (
      <div className="card p0">
        <div className="col g4" style={{ padding: "14px 16px" }}>
          <h2>Өдөр тутмын тулгалт</h2>
          <span className="small muted">Шөнө бүр өмнөх өдрийн төлбөрийг QPay-тай дахин тулгана. Хүлээгдэж буй нэхэмжлэхийг 15 минут тутам шалгаж, 48 цагийн дараа хугацааг нь дуусгана.</span>
        </div>
        {recs.length ? recs.map((x) => {
          const mm = x.mismatches.filter((m) => own.has(m.id));
          return (
            <div key={x.day} className="list-item" style={{ flexWrap: "wrap", minHeight: 0 }}>
              <b className="num" style={{ width: 110 }}>{x.day}</b>
              <span className="small muted" style={{ flex: 1 }}>{x.checked} шалгасан{x.fixed ? ` · ${x.fixed} хоцорсон төлбөр баталгаажсан` : ""}</span>
              {mm.length ? <span className="chip bad">{mm.length} зөрүү</span> : <span className="chip ok">Таарсан</span>}
              {mm.map((m) => <div key={m.id} className="tiny" style={{ width: "100%" }}>{m.invoice}: манайд {money(m.expected)}, QPay {m.got < 0 ? "шалгаж чадсангүй" : money(m.got)}</div>)}
            </div>
          );
        }) : <div style={{ padding: 16 }}><Empty title="Тулгалт хараахан хийгдээгүй" /></div>}
      </div>
    );
  }

  if (tab === "qpay") {
    const [c] = await sys<{ base_url: string; username: string | null; has_pw: boolean; invoice_code: string | null; enabled: boolean; updated_at: Date }>(
      "SELECT base_url, username, password_enc IS NOT NULL AS has_pw, invoice_code, enabled, updated_at FROM urguu_payment_config WHERE urguu_id = $1", [v.urguu.id]);
    body = (
      <div className="card col g16" style={{ maxWidth: 640 }}>
        <div className="col g4">
          <h2>{v.urguu.name}: QPay merchant</h2>
          <span className="small muted">QPay-ээс авсан merchant нэвтрэх нэр, нууц үг, нэхэмжлэхийн кодоо оруулна. Нууц үг шифрлэгдэж хадгалагдах бөгөөд дахин харагдахгүй. Төлбөр энэ өргөөний данс руу орно.</span>
        </div>
        {qpayMock() ? <div className="banner info">Туршилтын горим (QPAY_MOCK=1): жинхэнэ QPay руу хандахгүй, mock төлбөр ашиглана.</div> : null}
        <form action={saveQpayConfig} className="col g12">
          <label className="field">API хаяг<input className="inp" name="base_url" defaultValue={c?.base_url || "https://merchant.qpay.mn"} maxLength={200} /></label>
          <div className="formgrid">
            <label className="field">Нэвтрэх нэр (username)<input className="inp" name="username" defaultValue={c?.username || ""} maxLength={120} autoComplete="off" /></label>
            <label className="field">Нууц үг<span className="hint">{c?.has_pw ? "Хадгалагдсан. Солих бол л бичнэ." : "Оруулаагүй"}</span><input className="inp" type="password" name="password" maxLength={300} autoComplete="new-password" /></label>
          </div>
          <label className="field">Нэхэмжлэхийн код (invoice_code)<input className="inp" name="invoice_code" defaultValue={c?.invoice_code || ""} maxLength={120} /></label>
          <label className="row small" style={{ gap: 8 }}><input type="checkbox" name="enabled" defaultChecked={c?.enabled ?? false} />Идэвхтэй (сургалтын төлбөр, хандивт QPay ашиглана)</label>
          <div className="row wrap"><button className="btn pri">Хадгалах</button>{c ? <span className="tiny muted">Сүүлд: {fmtRange(c.updated_at)}</span> : null}</div>
        </form>
        <form action={testQpay}><button className="btn sm">Холболт шалгах</button></form>
      </div>
    );
  }

  return (
    <>
      <div className="pagehead">
        <div className="col g4"><div className="crumb">{v.urguu.name}</div><h1>Санхүү</h1></div>
        {tab !== "qpay" && tab !== "recon" ? (
          <div className="row wrap">
            <form action="/admin/finance" className="row wrap" style={{ gap: 6 }}>
              <input type="hidden" name="tab" value={tab} />
              <input className="inp sm" type="date" name="from" defaultValue={r.fromYmd} aria-label="Эхлэх огноо" style={{ width: "auto" }} />
              <input className="inp sm" type="date" name="to" defaultValue={r.toYmd} aria-label="Дуусах огноо" style={{ width: "auto" }} />
              <button className="btn sm">Харах</button>
            </form>
            {canView ? <a className="btn sm" href={`/admin/finance/export?from=${r.fromYmd}&to=${r.toYmd}`}><Icon n="share" s={14} />CSV</a> : null}
            {canView ? <a className="btn sm" href={`/admin/finance/export?format=xlsx&from=${r.fromYmd}&to=${r.toYmd}`}><Icon n="down2" s={14} />Excel</a> : null}
          </div>
        ) : null}
      </div>
      <Flash m={sp.m} />
      <div className="tabs" role="tablist">
        {tabs.map(([k, n]) => <Link key={k} href={`/admin/finance${qs({ tab: k, st: undefined, kind: undefined })}`} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""}>{n}</Link>)}
      </div>
      {body}
    </>
  );
}
