import { markPaidManual, payTraining, payTrainingGuest, refundPayment } from "@/app/actions/pay";
import { ActBtn } from "@/components/ActBtn";
import { CheckAll } from "@/components/CheckAll";
import { PayBox } from "@/components/PayBox";
import { getT } from "@/lib/i18n";
import { Empty } from "@/components/ui";
import { sys } from "@/lib/db";
import { PAYMENT_STATE, type Payment } from "@/lib/payments";
import { displayName } from "@/lib/project";
import { paymentsEnabled } from "@/lib/qpay";
import { fmtRange, money } from "@/lib/time";
import { PAY_STATE, type Training } from "@/lib/training";
import { asViewer, type Member } from "@/lib/viewer";

const pendingOf = async (participantId: string) =>
  (await sys<Payment>("SELECT * FROM payment WHERE participant_id = $1 AND state = 'pending' AND qpay_invoice_id IS NOT NULL ORDER BY created_at DESC LIMIT 1", [participantId]))[0];

/** P4.2: оролцогчийн төлбөрийн хэсэг («Миний оролцоо» картанд). */
export async function TrainingPay({ trainingId, participantId, payState, fee }: { trainingId: string; participantId: string; payState: string; fee: number; v: Member }) {
  if (fee <= 0 || payState !== "pending") return null;
  const [{ urguu_id }] = await sys<{ urguu_id: string }>("SELECT urguu_id FROM training WHERE id = $1", [trainingId]);
  if (!(await paymentsEnabled(urguu_id))) return <span className="small muted">Төлбөр {money(fee)}. Зохион байгуулагчид бэлнээр эсвэл дансаар төлнө үү.</span>;
  const p = await pendingOf(participantId);
  if (p) return <PayBox p={p} back={`/trainings/${trainingId}`} />;
  return <ActBtn action={payTraining} fields={{ training_id: trainingId }} className="btn pri">QPay-ээр {money(fee)} төлөх</ActBtn>;
}

/** Зочны төлбөрийн хэсэг (нийтийн бүртгэлийн нууц холбоосоор). */
export async function GuestPay({ code, token, participantId, payState, fee }: { code: string; token: string; participantId: string; payState: string; fee: number }) {
  if (fee <= 0 || payState !== "pending") return null;
  const t = await getT();
  const [{ urguu_id }] = await sys<{ urguu_id: string }>("SELECT t.urguu_id FROM training_participant tp JOIN training t ON t.id = tp.training_id WHERE tp.id = $1", [participantId]);
  if (!(await paymentsEnabled(urguu_id))) return <span className="small muted">{t("Төлбөрөө зохион байгуулагчид бэлнээр эсвэл дансаар төлнө үү.")}</span>;
  const p = await pendingOf(participantId);
  if (p) return <PayBox p={p} back={`/t/${code}/r/${token}`} />;
  return <ActBtn action={payTrainingGuest} fields={{ code, token }} className="btn pri">{t("QPay-ээр {amount} төлөх", { amount: money(fee) })}</ActBtn>;
}

/** Удирдагчийн «Төлбөр» таб: оролцогчдын төлбөрийн төлөв, гараар тэмдэглэх, буцаалт. */
export async function TrainingPayTab({ t, v }: { t: Training; v: Member }) {
  const canPay = v.perms.has("payment.manage");
  const d = await asViewer(v, async (q) => ({
    parts: await q<{ id: string; person_id: string; pay_state: string; father_name: string | null; given_name: string }>(
      `SELECT tp.id, tp.person_id, tp.pay_state, p.father_name, p.given_name FROM training_participant tp JOIN training_people($1) p ON p.person_id = tp.person_id
       WHERE tp.training_id = $1 AND tp.state = 'yes' ORDER BY array_position(ARRAY['pending','paid','refunded','none'], tp.pay_state), p.given_name`, [t.id]),
    pays: await q<Payment & { given_name: string | null; father_name: string | null }>(
      `SELECT pm.*, p.given_name, p.father_name FROM payment pm LEFT JOIN training_people($1) p ON p.person_id = pm.payer_person_id
       WHERE pm.training_id = $1 AND pm.state IN ('paid','refunded','pending') ORDER BY pm.created_at DESC LIMIT 300`, [t.id]),
  }));
  const paid = d.pays.filter((p) => p.state === "paid");
  const sum = paid.reduce((s, p) => s + p.amount, 0);
  const enabled = await paymentsEnabled(t.urguu_id);
  return (
    <div className="col g16" style={{ padding: 16 }}>
      <div className="kpis">
        <div className="kpi"><span className="small muted">Орсон төлбөр</span><b className="num">{money(sum)}</b><span className="tiny muted">{paid.length} төлөлт</span></div>
        <div className="kpi"><span className="small muted">Төлөөгүй</span><b className="num">{d.parts.filter((p) => p.pay_state === "pending").length}</b><span className="tiny muted">хүн · {money(t.fee)} тус бүр</span></div>
        <div className="kpi"><span className="small muted">QPay</span><b style={{ fontSize: 18 }}>{enabled ? "Идэвхтэй" : "Тохируулаагүй"}</b>{!enabled && canPay ? <a className="tiny" href="/admin/finance?tab=qpay">Тохируулах</a> : null}</div>
      </div>
      <div className="col g12">
        <div className="tscroll">
          <table className="t">
            <thead><tr>{canPay ? <th style={{ width: 40 }}><CheckAll form="paypick" name="part" /></th> : null}<th>Оролцогч</th><th>Төлбөр</th></tr></thead>
            <tbody>
              {d.parts.map((p) => (
                <tr key={p.id}>
                  {canPay ? <td>{p.pay_state === "pending" ? <input type="checkbox" name="part" value={p.id} form="paypick" aria-label={`${displayName(p)} сонгох`} style={{ width: 18, height: 18 }} /> : null}</td> : null}
                  <td>{displayName(p)}</td>
                  <td><span className={`chip ${PAY_STATE[p.pay_state]?.[0] || ""}`}>{PAY_STATE[p.pay_state]?.[1] || p.pay_state}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canPay && d.parts.some((p) => p.pay_state === "pending") ? (
          <div className="row wrap">
            <input className="inp sm" name="note" placeholder="Тэмдэглэл (жишээ нь: бэлнээр)" maxLength={200} style={{ width: 240 }} form="paypick" />
            <button className="btn sm" form="paypick">Сонгосныг бэлнээр / дансаар төлсөн гэж тэмдэглэх</button>
          </div>
        ) : null}
      </div>
      <form id="paypick" action={markPaidManual}><input type="hidden" name="training_id" value={t.id} /></form>
      <div className="col g4">
        <h2>Гүйлгээ</h2>
        {d.pays.length ? d.pays.map((p) => (
          <div key={p.id} className="list-item" style={{ flexWrap: "wrap", minHeight: 0 }}>
            <div className="col" style={{ flex: "1 1 200px", minWidth: 0 }}>
              <b>{p.given_name ? displayName({ father_name: p.father_name, given_name: p.given_name }) : p.payer_name || "—"}</b>
              <span className="tiny muted num">{fmtRange(p.paid_at || p.created_at)} · {p.method === "manual" ? "гараар" : "QPay"} · {p.sender_invoice_no}{p.refund_note ? ` · ${p.refund_note}` : ""}</span>
            </div>
            <b className="num">{money(p.amount)}</b>
            <span className={`chip ${PAYMENT_STATE[p.state]?.[0] || ""}`}>{PAYMENT_STATE[p.state]?.[1]}</span>
            {canPay && p.state === "paid" ? (
              <form action={refundPayment} className="row" style={{ gap: 6 }}>
                <input type="hidden" name="payment_id" value={p.id} /><input type="hidden" name="back" value={`/trainings/${t.id}?tab=pay`} />
                <input className="inp sm" name="note" placeholder="Буцаасан шалтгаан" maxLength={300} style={{ width: 170 }} aria-label="Буцаалтын тэмдэглэл" />
                <button className="btn sm danger">Буцаалт тэмдэглэх</button>
              </form>
            ) : null}
          </div>
        )) : <Empty title="Гүйлгээ алга" />}
      </div>
    </div>
  );
}
