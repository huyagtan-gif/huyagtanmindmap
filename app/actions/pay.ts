"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { verifyCaptcha } from "@/lib/captcha";
import { sys } from "@/lib/db";
import { PaymentError, markManualPaid, markRefunded, startPayment, verifyPayment } from "@/lib/payments";
import { UUID } from "@/lib/people-write";
import { participantByToken } from "@/lib/public";
import { loadConfig, testConnection } from "@/lib/qpay";
import { rateLimit } from "@/lib/ratelimit";
import { encrypt } from "@/lib/secret";
import { trainingAccess } from "@/lib/training";
import { asViewer, getViewer, requireMember, requirePerm } from "@/lib/viewer";

// Phase 4: төлбөр, хандивын үйлдлүүд. Мөнгөний мөрийг зөвхөн lib/payments.ts (системийн транзакц) бичнэ.

const str = (fd: FormData, k: string, max = 300) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
};
const uuid = (s: string) => (UUID.test(s) ? s : null);
const amountOf = (s: string) => {
  const n = Number(s.replace(/[\s’',₮]/g, ""));
  return Number.isInteger(n) && n >= 100 && n <= 100_000_000 ? n : null;
};
const safeBack = (s: string, dflt: string) => (s.startsWith("/") && !s.startsWith("//") && s.length < 300 ? s : dflt);
const go = (path: string, msg?: string): never => {
  revalidatePath("/", "layout");
  const [p, hash] = path.split("#");
  redirect(`${p}${msg ? `${p.includes("?") ? "&" : "?"}m=${encodeURIComponent(msg)}` : ""}${hash ? `#${hash}` : ""}`);
};
async function clientIp() {
  const h = await headers();
  return (h.get("x-forwarded-for") || "").split(",")[0].trim() || h.get("x-real-ip") || "local";
}
const errMsg = (e: unknown) => (e instanceof PaymentError ? e.message : "Төлбөр эхлүүлэхэд алдаа гарлаа");

/* ---------- P4.2 Сургалтын төлбөр ---------- */
export async function payTraining(fd: FormData) {
  const v = await requireMember();
  const id = uuid(str(fd, "training_id"));
  if (!id) go("/trainings");
  const a = await asViewer(v, (q) => trainingAccess(q, v, id!));
  if (!a) go("/trainings", "Сургалт олдсонгүй");
  const [part] = await sys<{ id: string; state: string; pay_state: string }>("SELECT id, state, pay_state FROM training_participant WHERE training_id = $1 AND person_id = $2", [id, v.personId]);
  const back = `/trainings/${id}#pay`;
  if (!part || part.state !== "yes" || part.pay_state !== "pending" || a!.t.fee <= 0) go(back, "Төлөх төлбөр алга");
  if (!rateLimit(`pay:${v.personId}`, 10)) go(back, "Хэт олон оролдлого. Түр хүлээнэ үү");
  let msg: string | undefined;
  try {
    await startPayment({ userId: v.userId, personId: v.personId, urguuId: a!.t.urguu_id }, {
      urguuId: a!.t.urguu_id, kind: "training", amount: a!.t.fee, description: `Сургалт: ${a!.t.name}`,
      payerPersonId: v.personId, trainingId: id, participantId: part!.id, createdBy: v.personId,
    });
  } catch (e) {
    msg = errMsg(e);
  }
  go(back, msg);
}

/** Зочин (нийтийн бүртгэлийн нууц холбоосоор) сургалтын төлбөрөө төлнө. */
export async function payTrainingGuest(fd: FormData) {
  const code = str(fd, "code", 20), token = str(fd, "token", 80);
  const back = `/t/${code}/r/${token}`;
  const p = await participantByToken(sys, code, token);
  if (!p) redirect(`/t/${code}`);
  const [t] = await sys<{ id: string; urguu_id: string; name: string; fee: number }>("SELECT id, urguu_id, name, fee FROM training WHERE id = $1", [p.training_id]);
  if (p.state !== "yes" || p.pay_state !== "pending" || t.fee <= 0) redirect(back);
  if (!rateLimit(`pay:ip:${await clientIp()}`, 15)) redirect(`${back}?m=rate`);
  try {
    await startPayment({ urguuId: t.urguu_id }, { urguuId: t.urguu_id, kind: "training", amount: t.fee, description: `Сургалт: ${t.name}`, payerPersonId: p.person_id, trainingId: t.id, participantId: p.id });
  } catch {
    redirect(`${back}?m=payerr`);
  }
  revalidatePath("/", "layout");
  redirect(`${back}#pay`);
}

/** «Төлбөрөө шалгах»: QPay-аас шууд асууна. Хэн ч дарж болно (зөвхөн жинхэнэ төлөлтийг баталгаажуулдаг), хязгаартай. */
export async function checkPayment(fd: FormData) {
  const id = uuid(str(fd, "payment_id"));
  const back = safeBack(str(fd, "back"), "/");
  const guest = back.startsWith("/t/") || back.startsWith("/e/");
  if (!id || !rateLimit(`paycheck:${await clientIp()}`, 30, 5 * 60_000)) go(back, guest ? undefined : "Түр хүлээгээд дахин шалгана уу");
  let st = "pending";
  try {
    st = await verifyPayment(id!);
  } catch (e) {
    console.error("[qpay] шалгах:", e instanceof Error ? e.message : e);
  }
  if (guest) {
    revalidatePath("/", "layout");
    redirect(`${back.split("?")[0]}?m=${st === "paid" ? "paid" : "unpaid"}`);
  }
  go(back, st === "paid" ? "Төлбөр баталгаажлаа. Баярлалаа!" : "Төлбөр хараахан орж ирээгүй байна. Төлсөн бол хэдэн минутын дараа дахин шалгана уу");
}

/* ---------- P4.4 Хандив ---------- */
export async function donate(fd: FormData) {
  const v = await requireMember();
  const id = uuid(str(fd, "event_id"));
  if (!id) go("/events");
  const back = `/events/${id}#donate`;
  const amount = amountOf(str(fd, "amount", 20));
  if (!amount) go(back, "Хандивын дүнг 100₮-өөс дээш бүхэл тоогоор оруулна уу");
  const [e] = await asViewer(v, (q) => q<{ id: string; name: string; urguu_id: string; donations_open: boolean; state: string }>("SELECT id, name, urguu_id, donations_open, state FROM event WHERE id = $1", [id]));
  if (!e?.donations_open || e.state === "cancelled") go(back, "Энэ үйлд хандив авахгүй байна");
  if (!rateLimit(`don:${v.personId}`, 10)) go(back, "Хэт олон оролдлого. Түр хүлээнэ үү");
  let msg: string | undefined;
  try {
    await startPayment({ userId: v.userId, personId: v.personId, urguuId: e!.urguu_id }, {
      urguuId: e!.urguu_id, kind: "donation", amount: amount!, description: `Хандив: ${e!.name}`, payerPersonId: v.personId,
      anonymous: fd.get("anonymous") === "on", message: str(fd, "message", 300) || null, eventId: e!.id, createdBy: v.personId,
    });
  } catch (err) {
    msg = errMsg(err);
  }
  go(back, msg);
}

/** Гишүүн бус хүн үйлийн нийтийн хуудаснаас хандив өгнө. */
export async function donatePublic(fd: FormData) {
  const code = str(fd, "code", 20);
  const back: (e: string) => never = (e) => redirect(`/e/${code}?e=${e}`);
  const [e] = /^[a-z0-9]{6,20}$/.test(code) ? await sys<{ id: string; name: string; urguu_id: string; donations_open: boolean; state: string }>(
    "SELECT id, name, urguu_id, donations_open, state FROM event WHERE public_code = $1", [code]) : [];
  if (!e?.donations_open || e.state === "cancelled") redirect("/");
  const amount = amountOf(str(fd, "amount", 20));
  if (!amount) back("amount");
  const ip = await clientIp();
  if (!rateLimit(`don:ip:${ip}`, 6)) back("rate");
  if (!(await verifyCaptcha(fd, ip))) back("captcha");
  const v = await getViewer();
  let token: string | null = null;
  try {
    const r = await startPayment({ userId: v?.userId ?? null, personId: v?.personId ?? null, urguuId: e.urguu_id }, {
      urguuId: e.urguu_id, kind: "donation", amount: amount!, description: `Хандив: ${e.name}`, payerPersonId: v?.personId ?? null,
      payerName: v?.personId ? null : str(fd, "payer_name", 80) || null, anonymous: fd.get("anonymous") === "on", message: str(fd, "message", 300) || null,
      eventId: e.id, guestLink: true,
    });
    token = r.token;
  } catch {
    back("payerr");
  }
  redirect(`/e/${code}/d/${token}`);
}

/* ---------- P4.5 Буцаалт, гараар тэмдэглэх ---------- */
export async function refundPayment(fd: FormData) {
  const v = await requirePerm("payment.manage");
  const id = uuid(str(fd, "payment_id"));
  const back = safeBack(str(fd, "back"), "/admin/finance?tab=payments");
  if (!id) go(back);
  const ok = await markRefunded({ userId: v.userId, personId: v.personId, urguuId: v.urguu.id }, v.urguu.id, id!, str(fd, "note", 300) || null);
  go(back, ok ? "Буцаалт тэмдэглэгдлээ. Мөнгийг төлөгчид өөрөө шилжүүлнэ үү" : "Зөвхөн төлөгдсөн төлбөрийг буцаана");
}

export async function markPaidManual(fd: FormData) {
  const v = await requirePerm("payment.manage");
  const id = uuid(str(fd, "training_id"));
  if (!id) go("/trainings");
  const ids = fd.getAll("part").filter((x): x is string => typeof x === "string" && UUID.test(x)).slice(0, 500);
  const back = `/trainings/${id}?tab=pay`;
  if (!ids.length) go(back, "Хүмүүсээ сонгоно уу");
  const n = await markManualPaid({ userId: v.userId, personId: v.personId, urguuId: v.urguu.id }, { urguuId: v.urguu.id, trainingId: id!, participantIds: ids, note: str(fd, "note", 200) || "Бэлнээр / дансаар" });
  go(back, `${n} хүний төлбөрийг гараар тэмдэглэлээ`);
}

/* ---------- P4.1 QPay тохиргоо ---------- */
export async function saveQpayConfig(fd: FormData) {
  const v = await requirePerm("payment.manage");
  const back = "/admin/finance?tab=qpay";
  const base = str(fd, "base_url", 200) || "https://merchant.qpay.mn";
  if (!/^https:\/\/[\w.-]+(:\d+)?(\/[\w./-]*)?$/.test(base)) go(back, "Хаяг https://-ээр эхлэх ёстой");
  const username = str(fd, "username", 120), invoiceCode = str(fd, "invoice_code", 120), password = str(fd, "password", 300);
  const enabled = fd.get("enabled") === "on";
  const [cur] = await sys<{ password_enc: string | null }>("SELECT password_enc FROM urguu_payment_config WHERE urguu_id = $1", [v.urguu.id]);
  if (enabled && (!username || !invoiceCode || (!password && !cur?.password_enc))) go(back, "Идэвхжүүлэхийн тулд нэвтрэх нэр, нууц үг, нэхэмжлэхийн код бүгдийг оруулна уу");
  await sys(
    `INSERT INTO urguu_payment_config (urguu_id, base_url, username, password_enc, invoice_code, enabled, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now())
     ON CONFLICT (urguu_id) DO UPDATE SET base_url = EXCLUDED.base_url, username = EXCLUDED.username, password_enc = coalesce(EXCLUDED.password_enc, urguu_payment_config.password_enc),
       invoice_code = EXCLUDED.invoice_code, enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [v.urguu.id, base, username || null, password ? encrypt(password) : null, invoiceCode || null, enabled, v.personId]);
  // Нууц утгагүй audit
  await sys("INSERT INTO audit_log (actor_user_id, actor_person_id, urguu_id, entity, action, after) VALUES ($1,$2,$3,'urguu_payment_config','update',$4)",
    [v.userId, v.personId, v.urguu.id, JSON.stringify({ base_url: base, username, invoice_code: invoiceCode, enabled, password_changed: !!password })]);
  go(back, "QPay тохиргоо хадгалагдлаа");
}

export async function testQpay() {
  const v = await requirePerm("payment.manage");
  const back = "/admin/finance?tab=qpay";
  let msg = "Холболт амжилттай";
  try {
    const c = await loadConfig(v.urguu.id);
    if (!c) msg = "Тохиргоо идэвхгүй эсвэл дутуу байна";
    else await testConnection(c);
  } catch (e) {
    msg = `Холбогдож чадсангүй: ${e instanceof Error ? e.message.slice(0, 120) : "алдаа"}`;
  }
  go(back, msg);
}
