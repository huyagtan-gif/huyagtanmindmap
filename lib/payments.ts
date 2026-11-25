import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { newToken } from "./codes";
import { sys, sysTx, type DbCtx } from "./db";
import { SITE_URL, escHtml, sendMail } from "./mail";
import { notifyPerson } from "./notify";
import { cancelInvoice, checkInvoice, createInvoice, loadConfig } from "./qpay";
import { money } from "./time";

// Phase 4: төлбөрийн үйлчилгээ. Бүх бичилт системийн транзакцаар; дуудагч тал эрхийг шалгасан байна.
// Зарчим (P4.3): callback ба хэрэглэгчийн «шалгах» дарахад шууд итгэхгүй, QPay-аас payment/check-ээр заавал асууна.
// Төлөгдсөн гэж тэмдэглэх нь «WHERE state = 'pending'» нөхцөлтэй тул давхар callback ирсэн ч нэг л удаа хийгдэнэ (idempotent).

export type Payment = {
  id: string; urguu_id: string; kind: "training" | "donation"; method: "qpay" | "manual"; amount: number; state: string;
  payer_person_id: string | null; payer_name: string | null; anonymous: boolean; message: string | null;
  training_id: string | null; participant_id: string | null; event_id: string | null;
  sender_invoice_no: string; qpay_invoice_id: string | null; qpay_payment_id: string | null;
  qr_text: string | null; short_url: string | null; deeplinks: { name: string; description: string; logo: string; link: string }[] | null;
  paid_at: Date | null; verified_at: Date | null; refunded_at: Date | null; refund_note: string | null; note: string | null; created_at: Date;
};
export const PAYMENT_STATE: Record<string, [string, string]> = {
  pending: ["warn", "Хүлээгдэж буй"], paid: ["ok", "Төлсөн"], refunded: ["bad", "Буцаасан"], cancelled: ["", "Цуцалсан"], expired: ["", "Хугацаа дууссан"],
};
const PENDING_HOURS = 48;

const secret = () => process.env.PAYMENT_SECRET || process.env.AUTH_SECRET || "dev-secret";
export const callbackSig = (id: string) => createHmac("sha256", secret()).update(`qpay-cb:${id}`).digest("base64url").slice(0, 22);
export function callbackSigValid(id: string, sig: string): boolean {
  const a = Buffer.from(callbackSig(id)), b = Buffer.from(sig || "");
  return a.length === b.length && timingSafeEqual(a, b);
}
const invoiceNo = () => `HT${new Date().toISOString().slice(2, 10).replace(/-/g, "")}${randomBytes(6).toString("hex").toUpperCase()}`;

export class PaymentError extends Error {}

export type NewPayment = {
  urguuId: string; kind: "training" | "donation"; amount: number; description: string;
  payerPersonId?: string | null; payerName?: string | null; anonymous?: boolean; message?: string | null;
  trainingId?: string | null; participantId?: string | null; eventId?: string | null; createdBy?: string | null;
  /** Нэвтрээгүй хандивлагчид нууц холбоос үүсгэх эсэх */ guestLink?: boolean;
};

/**
 * P4.2 / P4.4: нэхэмжлэх үүсгэнэ. Сургалтын оролцогчид хүлээгдэж буй нэхэмжлэх аль хэдийн байвал түүнийг буцаана (давхар үүсгэхгүй).
 * Буцаах: төлбөрийн мөр ба (guestLink үед) нууц холбоосын токен.
 */
export async function startPayment(ctx: DbCtx, o: NewPayment): Promise<{ payment: Payment; token: string | null }> {
  if (!Number.isInteger(o.amount) || o.amount < 100 || o.amount > 100_000_000) throw new PaymentError("Дүн буруу байна");
  const cfg = await loadConfig(o.urguuId);
  if (!cfg) throw new PaymentError("Энэ өргөөнд QPay төлбөр тохируулагдаагүй байна");
  if (o.participantId) {
    const [ex] = await sys<Payment>("SELECT * FROM payment WHERE participant_id = $1 AND state = 'pending' AND qpay_invoice_id IS NOT NULL", [o.participantId]);
    if (ex && ex.amount === o.amount) return { payment: ex, token: null };
    if (ex) await expire(ex, "cancelled"); // үнэ өөрчлөгдсөн бол хуучныг цуцалж шинээр үүсгэнэ
  }
  const tok = o.guestLink ? newToken() : null;
  let p: Payment;
  try {
    [p] = await sysTx(ctx, (q) => q<Payment>(
      `INSERT INTO payment (urguu_id, kind, amount, payer_person_id, payer_name, anonymous, message, training_id, participant_id, event_id, sender_invoice_no, access_hash, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [o.urguuId, o.kind, o.amount, o.payerPersonId ?? null, o.payerName ?? null, !!o.anonymous, o.message ?? null, o.trainingId ?? null, o.participantId ?? null,
        o.eventId ?? null, invoiceNo(), tok?.hash ?? null, o.createdBy ?? null]));
  } catch (e: any) {
    // Зэрэг дарсан: нөгөө хүсэлт үүсгэсэн нэхэмжлэхийг буцаана
    if (e?.code === "23505" && o.participantId) {
      const [ex] = await sys<Payment>("SELECT * FROM payment WHERE participant_id = $1 AND state = 'pending'", [o.participantId]);
      if (ex) return { payment: ex, token: null };
    }
    throw e;
  }
  try {
    const inv = await createInvoice(cfg, { senderInvoiceNo: p.sender_invoice_no, amount: o.amount, description: o.description, callbackUrl: `${SITE_URL}/api/qpay/callback?p=${p.id}&s=${callbackSig(p.id)}` });
    [p] = await sysTx(ctx, (q) => q<Payment>(
      "UPDATE payment SET qpay_invoice_id = $2, qr_text = $3, short_url = $4, deeplinks = $5 WHERE id = $1 RETURNING *",
      [p.id, inv.invoiceId, inv.qrText, inv.shortUrl, JSON.stringify(inv.urls)]));
  } catch (e) {
    await sysTx(ctx, (q) => q("UPDATE payment SET state = 'cancelled', note = 'Нэхэмжлэх үүсгэж чадсангүй' WHERE id = $1", [p.id]));
    console.error("[qpay] нэхэмжлэх:", e instanceof Error ? e.message : e);
    throw new PaymentError("QPay нэхэмжлэх үүсгэж чадсангүй. Түр хүлээгээд дахин оролдоно уу");
  }
  return { payment: p, token: tok?.token ?? null };
}

/** P4.3: нэхэмжлэхийг QPay-аас шалгаж, бүрэн төлөгдсөн бол «Төлсөн» болгоно. Шинэ төлөв буцаана. */
export async function verifyPayment(id: string): Promise<string> {
  const [p] = await sys<Payment>("SELECT * FROM payment WHERE id = $1", [id]);
  if (!p) return "missing";
  if (p.state !== "pending" || !p.qpay_invoice_id) return p.state;
  const cfg = await loadConfig(p.urguu_id);
  if (!cfg) return p.state;
  const r = await checkInvoice(cfg, p.qpay_invoice_id);
  if (r.paidAmount < p.amount) return "pending";
  const done = await sysTx({ urguuId: p.urguu_id }, async (q) => {
    const [u] = await q<Payment>(
      "UPDATE payment SET state = 'paid', paid_at = now(), verified_at = now(), qpay_payment_id = $2 WHERE id = $1 AND state = 'pending' RETURNING *",
      [id, r.rows.filter((x) => x.payment_status === "PAID").map((x) => x.payment_id).join(",").slice(0, 200) || null]);
    if (u?.participant_id) await q("UPDATE training_participant SET pay_state = 'paid' WHERE id = $1", [u.participant_id]);
    return u;
  });
  if (done) await notifyPaid(done);
  return "paid";
}

async function notifyPaid(p: Payment) {
  if (!p.payer_person_id) return;
  const [t] = p.training_id ? await sys<{ name: string }>("SELECT name FROM training WHERE id = $1", [p.training_id]) : p.event_id ? await sys<{ name: string }>("SELECT name FROM event WHERE id = $1", [p.event_id]) : [];
  const what = p.kind === "training" ? `«${t?.name || "сургалт"}» сургалтын төлбөр` : `${t ? `«${t.name}»-д ` : ""}өгсөн хандив`;
  await notifyPerson(p.payer_person_id, {
    template: "payment_paid", urguuId: p.urguu_id, subject: "Хуягтан: төлбөр баталгаажлаа", title: "Төлбөр баталгаажлаа",
    body: `${escHtml(what)} <b>${money(p.amount)}</b> баталгаажлаа. Баярлалаа!`,
    cta: p.training_id ? { label: "Сургалтыг харах", url: `${SITE_URL}/trainings/${p.training_id}` } : undefined,
  });
}

async function expire(p: Payment, state: "expired" | "cancelled") {
  const cfg = await loadConfig(p.urguu_id).catch(() => null);
  if (cfg && p.qpay_invoice_id) await cancelInvoice(cfg, p.qpay_invoice_id).catch(() => {});
  await sys("UPDATE payment SET state = $2 WHERE id = $1 AND state = 'pending'", [p.id, state]);
}

/** P4.3: 15 минут тутам: хүлээгдэж буй нэхэмжлэхүүдийг QPay-тай тулгана, 48 цагаас хуучныг хугацаа дуусгана. */
export async function reconcilePending(): Promise<{ checked: number; paid: number; expired: number }> {
  const rows = await sys<Payment>("SELECT * FROM payment WHERE state = 'pending' AND qpay_invoice_id IS NOT NULL ORDER BY created_at LIMIT 300");
  let paid = 0, expired = 0;
  for (const p of rows) {
    try {
      if ((await verifyPayment(p.id)) === "paid") paid++;
      else if (+p.created_at < Date.now() - PENDING_HOURS * 3600_000) {
        await expire(p, "expired");
        expired++;
      }
    } catch (e) {
      console.error("[qpay] тулгалт:", p.id, e instanceof Error ? e.message : e);
    }
  }
  return { checked: rows.length, paid, expired };
}

/**
 * P4.3: өдөр бүрийн тулгалт (Улаанбаатарын өчигдрийн өдөр, нэг удаа). Тухайн өдөр «Төлсөн» болсон QPay төлбөр бүрийг дахин шалгаж,
 * QPay дээрх дүн таарахгүй бол зөрүү болгон бүртгэнэ. Зөрүүтэй бол супер админд имэйл.
 */
export async function dailyReconciliation(now = new Date()): Promise<{ day: string; checked: number; mismatches: number } | null> {
  const day = new Date(now.getTime() + 8 * 3600_000 - 86400_000).toISOString().slice(0, 10);
  const [{ n }] = await sys<{ n: number }>("SELECT count(*)::int AS n FROM payment_recon WHERE day = $1", [day]);
  if (n) return null;
  const from = new Date(`${day}T00:00:00+08:00`), to = new Date(+from + 86400_000);
  const rows = await sys<Payment>("SELECT * FROM payment WHERE method = 'qpay' AND qpay_invoice_id IS NOT NULL AND ((paid_at >= $1 AND paid_at < $2) OR (state = 'pending' AND created_at < $2))", [from, to]);
  const mism: { id: string; invoice: string; expected: number; got: number; state: string }[] = [];
  let fixed = 0;
  for (const p of rows) {
    const cfg = await loadConfig(p.urguu_id).catch(() => null);
    if (!cfg) continue;
    try {
      const r = await checkInvoice(cfg, p.qpay_invoice_id!);
      if (p.state === "pending") {
        if (r.paidAmount >= p.amount && (await verifyPayment(p.id)) === "paid") fixed++;
      } else if (p.state === "paid" && r.paidAmount !== p.amount) mism.push({ id: p.id, invoice: p.sender_invoice_no, expected: p.amount, got: r.paidAmount, state: p.state });
    } catch (e) {
      mism.push({ id: p.id, invoice: p.sender_invoice_no, expected: p.amount, got: -1, state: "check_failed" });
    }
  }
  const ins = await sys("INSERT INTO payment_recon (day, checked, fixed, mismatches) VALUES ($1,$2,$3,$4) ON CONFLICT (day) DO NOTHING RETURNING id", [day, rows.length, fixed, JSON.stringify(mism)]);
  if (ins.length && mism.length) {
    const to2 = (await sys<{ email: string }>("SELECT email FROM users WHERE is_platform_admin AND email IS NOT NULL")).map((r) => r.email);
    for (const email of to2)
      await sendMail({ to: email, template: "recon_alert", subject: `Хуягтан: ${day}-ний төлбөрийн тулгалтад ${mism.length} зөрүү`, title: "Төлбөрийн тулгалтын зөрүү",
        body: `${day}-нд шалгасан ${rows.length} төлбөрөөс ${mism.length} нь QPay-тай таарсангүй. Санхүүгийн тайлангийн «Тулгалт» хэсгээс харна уу.`,
        cta: { label: "Тулгалт харах", url: `${SITE_URL}/admin/finance?tab=recon` } });
  }
  return { day, checked: rows.length, mismatches: mism.length };
}

/** P4.5: буцаалтыг гараар тэмдэглэнэ (QPay-д буцаалтын API зөвхөн картын төлбөрт байдаг тул мөнгийг өргөө өөрөө буцаана). */
export async function markRefunded(ctx: DbCtx, urguuId: string, paymentId: string, note: string | null): Promise<boolean> {
  return sysTx(ctx, async (q) => {
    const [p] = await q<Payment>(
      "UPDATE payment SET state = 'refunded', refunded_at = now(), refund_note = $3, refunded_by = $4 WHERE id = $1 AND urguu_id = $2 AND state = 'paid' RETURNING *",
      [paymentId, urguuId, note, ctx.personId ?? null]);
    if (p?.participant_id) await q("UPDATE training_participant SET pay_state = 'refunded' WHERE id = $1", [p.participant_id]);
    return !!p;
  });
}

/** Бэлнээр / дансаар авсан төлбөрийг гараар тэмдэглэнэ. */
export async function markManualPaid(ctx: DbCtx, o: { urguuId: string; trainingId: string; participantIds: string[]; note: string | null }): Promise<number> {
  return sysTx(ctx, async (q) => {
    const parts = await q<{ id: string; person_id: string; fee: number }>(
      `SELECT tp.id, tp.person_id, t.fee FROM training_participant tp JOIN training t ON t.id = tp.training_id
       WHERE tp.training_id = $1 AND t.urguu_id = $2 AND tp.id = ANY($3::uuid[]) AND tp.pay_state IN ('none','pending') AND t.fee > 0`,
      [o.trainingId, o.urguuId, o.participantIds]);
    for (const p of parts) {
      await q("UPDATE payment SET state = 'cancelled', note = 'Гараар төлсөн гэж тэмдэглэсэн' WHERE participant_id = $1 AND state = 'pending'", [p.id]);
      await q(
        `INSERT INTO payment (urguu_id, kind, method, amount, state, payer_person_id, training_id, participant_id, sender_invoice_no, paid_at, verified_at, note, created_by)
         VALUES ($1, 'training', 'manual', $2, 'paid', $3, $4, $5, $6, now(), now(), $7, $8)`,
        [o.urguuId, p.fee, p.person_id, o.trainingId, p.id, invoiceNo(), o.note, ctx.personId ?? null]);
      await q("UPDATE training_participant SET pay_state = 'paid' WHERE id = $1", [p.id]);
    }
    return parts.length;
  });
}
