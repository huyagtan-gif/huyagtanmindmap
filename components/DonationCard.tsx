import { donate } from "@/app/actions/pay";
import { PayBox } from "@/components/PayBox";
import { sys } from "@/lib/db";
import { SITE_URL } from "@/lib/mail";
import type { Payment } from "@/lib/payments";
import { displayName } from "@/lib/project";
import { paymentsEnabled } from "@/lib/qpay";
import { money, ubDay } from "@/lib/time";
import { asViewer, type Member } from "@/lib/viewer";

export const donorName = (d: { anonymous: boolean; given_name?: string | null; father_name?: string | null; payer_name?: string | null }) =>
  d.anonymous ? "Нэрээ нууцалсан" : d.given_name ? displayName({ father_name: d.father_name ?? null, given_name: d.given_name }) : d.payer_name || "Зочин";

/**
 * P4.4: үйлийн хандив. Хандивлагчийн нэр (нууцалсан бол «Нэрээ нууцалсан»), дүнг зөвхөн «Хандивын дүн» талбарын эрхтэй хүн харна.
 */
export async function DonationCard({ eventId, v }: { eventId: string; v: Member }) {
  const d = await asViewer(v, async (q) => {
    const [e] = await q<{ id: string; urguu_id: string; donations_open: boolean; public_code: string | null; state: string }>("SELECT id, urguu_id, donations_open, public_code, state FROM event WHERE id = $1", [eventId]);
    if (!e) return null;
    const list = await q<{ id: string; amount: number; anonymous: boolean; payer_name: string | null; message: string | null; paid_at: Date; given_name: string | null; father_name: string | null }>(
      `SELECT pm.id, pm.amount, pm.anonymous, pm.payer_name, pm.message, pm.paid_at, p.given_name, p.father_name
       FROM payment pm LEFT JOIN person p ON p.id = pm.payer_person_id WHERE pm.event_id = $1 AND pm.kind = 'donation' AND pm.state = 'paid' ORDER BY pm.paid_at DESC LIMIT 100`, [eventId]);
    return { e, list };
  });
  if (!d || (!d.e.donations_open && !d.list.length)) return null;
  const { e, list } = d;
  const seeAmt = v.fields.has("donation");
  const [mine] = await sys<Payment>(
    "SELECT * FROM payment WHERE event_id = $1 AND payer_person_id = $2 AND kind = 'donation' AND state = 'pending' AND qpay_invoice_id IS NOT NULL ORDER BY created_at DESC LIMIT 1", [eventId, v.personId]);
  const enabled = e.donations_open && e.state !== "cancelled" && (await paymentsEnabled(e.urguu_id));
  return (
    <div className="card col g12" id="donate">
      <div className="row between"><h2>Хандив</h2>{seeAmt && list.length ? <b className="num">{money(list.reduce((s, x) => s + x.amount, 0))}</b> : null}</div>
      {mine ? <PayBox p={mine} back={`/events/${eventId}`} /> : enabled ? (
        <form action={donate} className="col g12">
          <input type="hidden" name="event_id" value={eventId} />
          <label className="field">Дүн (₮)<input className="inp" name="amount" inputMode="numeric" required placeholder="10000" maxLength={12} /></label>
          <label className="field">Ерөөл, үг<span className="hint">Заавал биш</span><input className="inp" name="message" maxLength={300} /></label>
          <label className="row small" style={{ gap: 8 }}><input type="checkbox" name="anonymous" />Нэрээ нууцлах</label>
          <button className="btn pri">QPay-ээр хандив өгөх</button>
        </form>
      ) : e.donations_open ? <span className="small muted">Өргөөнд QPay тохируулагдаагүй байна.</span> : null}
      {e.donations_open && e.public_code && v.perms.has("event.manage") ? <span className="tiny muted">Гишүүн бус хүмүүст: <a href={`/e/${e.public_code}`} target="_blank" rel="noopener noreferrer">{SITE_URL.replace(/^https?:\/\//, "")}/e/{e.public_code}</a></span> : null}
      {list.length ? (
        <div className="col" style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
          {list.map((x) => (
            <div key={x.id} className="row between small" style={{ padding: "6px 0", alignItems: "flex-start" }}>
              <span className="col" style={{ minWidth: 0 }}><b>{donorName(x)}</b>{x.message ? <span className="muted">{x.message}</span> : null}</span>
              <span className="num muted" style={{ flexShrink: 0 }}>{seeAmt ? money(x.amount) : ubDay(x.paid_at)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
