"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { verifyCaptcha } from "@/lib/captcha";
import { openJson, sealJson } from "@/lib/codes";
import { sys, sysTx } from "@/lib/db";
import { SITE_URL, escHtml, sendMail } from "@/lib/mail";
import { normPhone } from "@/lib/norm";
import { notifyPromoted } from "@/lib/notify";
import { checkOtp, issueOtp } from "@/lib/otp";
import { UUID } from "@/lib/people-write";
import { checkIn, participantByPhone, participantByToken, registerPublic, resolveGuest, type GuestInput, type PublicTraining } from "@/lib/public";
import { rateLimit } from "@/lib/ratelimit";
import { sendSms, smsMode } from "@/lib/sms";
import { attTokenValid, joinTraining, leaveTraining } from "@/lib/training";
import { getViewer } from "@/lib/viewer";

// Phase 3: нэвтрэлтгүй хүний хийх үйлдлүүд (P3.4 нийтийн бүртгэл, P3.5 QR ирц). Бүгд captcha / rate limit-тэй,
// өгөгдлийг зөвхөн системийн транзакцаар, шаардлагатай хамгийн бага хэмжээнд бичнэ.

const str = (fd: FormData, k: string, max = 200) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
};
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
async function clientIp() {
  const h = await headers();
  return (h.get("x-forwarded-for") || "").split(",")[0].trim() || h.get("x-real-ip") || "local";
}
const COOKIE = "pubreg";
type Pending = GuestInput & { code: string };

const publicTraining = async (code: string) =>
  /^[a-z0-9]{6,20}$/.test(code)
    ? (await sys<PublicTraining>("SELECT id, urguu_id, name, state, scope, reg_mode, fee, capacity, public_code FROM training WHERE public_code = $1 AND scope = 'public' AND state <> 'draft'", [code]))[0] || null
    : null;

/** Бүртгэлийг гүйцээж, зочинд «миний бүртгэл» холбоосыг өгнө (дэлгэц + имэйл / SMS). */
async function finish(t: PublicTraining, g: GuestInput): Promise<never> {
  const r = await sysTx({ urguuId: t.urguu_id }, (q) => registerPublic(q, t, g));
  const url = `${SITE_URL}/t/${t.public_code}/r/${r.token}`;
  const line = r.state === "waitlist" ? "Суудал дүүрсэн тул та хүлээлгийн жагсаалтад орлоо. Суудал суларвал мэдэгдэнэ." : t.fee > 0 ? "Та бүртгэгдлээ. Төлбөрөө төлж бүртгэлээ баталгаажуулна уу." : "Та бүртгэгдлээ.";
  try {
    if (g.email)
      await sendMail({ to: g.email, template: "training_public", urguuId: t.urguu_id, subject: `Хуягтан: «${t.name}» сургалтын бүртгэл`, title: "Сургалтын бүртгэл",
        body: `<b>${escHtml(t.name)}</b>: ${line} Доорх холбоосоор бүртгэлээ харж, цуцалж болно. Холбоосыг бусдад бүү дамжуулаарай.`, cta: { label: "Миний бүртгэл", url } });
    else if (smsMode() !== "off") await sendSms(g.phone, `Хуягтан: «${t.name}» ${r.state === "waitlist" ? "хүлээлгийн жагсаалтад орлоо" : "сургалтад бүртгэгдлээ"}. ${url}`.slice(0, 300), "training_public", { urguuId: t.urguu_id });
  } catch (e) {
    console.error("[public] мэдэгдэл:", e instanceof Error ? e.message : e);
  }
  revalidatePath("/", "layout");
  redirect(`/t/${t.public_code}/r/${r.token}?new=1`);
}

/** P3.4: нийтийн хуудаснаас бүртгүүлэх. SMS гарцтай бол утсыг кодоор баталгаажуулна. */
export async function publicRegister(fd: FormData) {
  const code = str(fd, "code", 20);
  const back: (e: string) => never = (e) => redirect(`/t/${code}?e=${e}`);
  const t = await publicTraining(code);
  if (!t) redirect("/");
  if (t.state !== "open") back("closed");
  const given = str(fd, "given_name", 80), father = str(fd, "father_name", 80);
  const phone = normPhone(str(fd, "phone", 20));
  const email = str(fd, "email", 254).toLowerCase();
  if (!fd.get("consent")) back("consent");
  if (!given) back("name");
  if (!phone.value || !phone.ok) back("phone");
  if (email && !isEmail(email)) back("email");
  const ip = await clientIp();
  if (!rateLimit(`pub:ip:${ip}`, 8) || !rateLimit(`pub:${phone.value}`, 5)) back("rate");
  if (!(await verifyCaptcha(fd, ip))) back("captcha");
  const g: GuestInput = { father: father || null, given, phone: phone.value, email: email || null, phoneVerified: false };
  if (smsMode() === "off") await finish(t, g);
  const sent = await issueOtp(phone.value, "public", null);
  if (sent === "rate") back("rate");
  if (sent === "fail") back("sms");
  (await cookies()).set(COOKIE, sealJson({ ...g, code } satisfies Pending, 15 * 60), { httpOnly: true, sameSite: "lax", path: "/t", maxAge: 15 * 60, secure: SITE_URL.startsWith("https") });
  redirect(`/t/${code}?step=code`);
}

/** P3.4: SMS кодоо оруулж бүртгэлээ гүйцээнэ. */
export async function publicConfirm(fd: FormData) {
  const code = str(fd, "code", 20);
  const jar = await cookies();
  const p = openJson<Pending>(jar.get(COOKIE)?.value);
  const t = await publicTraining(code);
  if (!t) redirect("/");
  if (!p || p.code !== code) redirect(`/t/${code}?e=expired`);
  const ip = await clientIp();
  if (!rateLimit(`pubotp:ip:${ip}`, 10)) redirect(`/t/${code}?step=code&e=rate`);
  const r = await checkOtp(p.phone, "public", str(fd, "otp", 10).replace(/\s/g, ""));
  if (!r.ok) redirect(`/t/${code}?step=code&e=otp`);
  if (t.state !== "open") redirect(`/t/${code}?e=closed`);
  jar.delete({ name: COOKIE, path: "/t" });
  await finish(t, { father: p.father, given: p.given, phone: p.phone, email: p.email, phoneVerified: true });
}

/** Зочин өөрийн холбоосоор бүртгэлээ цуцлах / дахин бүртгүүлэх. */
export async function guestRsvp(fd: FormData) {
  const code = str(fd, "code", 20), token = str(fd, "token", 80), op = str(fd, "op", 10);
  const t = await publicTraining(code);
  if (!t) redirect("/");
  const ip = await clientIp();
  if (!rateLimit(`guest:ip:${ip}`, 20)) redirect(`/t/${code}/r/${token}?m=rate`);
  let promoted: string[] = [];
  const m = await sysTx({ urguuId: t.urguu_id }, async (q) => {
    const p = await participantByToken(q, code, token);
    if (!p) return "none";
    if (op === "cancel") {
      promoted = await leaveTraining(q, t.id, p.person_id, "cancelled");
      return "cancelled";
    }
    if (t.state !== "open") return "closed";
    return (await joinTraining(q, { trainingId: t.id, personId: p.person_id, source: "public" })).state;
  });
  if (promoted.length) await notifyPromoted(t, promoted);
  revalidatePath("/", "layout");
  redirect(m === "none" ? `/t/${code}` : `/t/${code}/r/${token}?m=${m}`);
}

/* ---------- P3.5 QR ирц ---------- */
type Sess = { id: string; training_id: string; qr_open: boolean; urguu_id: string; scope: string; state: string };
async function openSession(sid: string, token: string): Promise<Sess | null> {
  if (!UUID.test(sid) || !/^[\w-]{16}$/.test(token) || !attTokenValid(sid, token)) return null;
  const [s] = await sys<Sess>(
    "SELECT s.id, s.training_id, s.qr_open, t.urguu_id, t.scope, t.state FROM training_session s JOIN training t ON t.id = s.training_id WHERE s.id = $1", [sid]);
  return s && s.qr_open ? s : null;
}

/** Нэвтэрсэн гишүүн: нэг товшилтоор ирцээ бүртгүүлнэ. */
export async function checkinMember(fd: FormData) {
  const sid = str(fd, "sid", 40), token = str(fd, "token", 40);
  const here = `/a/${sid}/${token}`;
  const v = await getViewer();
  if (!v?.personId) redirect(`/login?next=${encodeURIComponent(here)}`);
  const s = await openSession(sid, token);
  if (!s) redirect(`${here}?r=expired`);
  const r = await sysTx({ userId: v.userId, personId: v.personId, urguuId: s.urguu_id }, async (q) => {
    // Жагсаалтад байхгүй бол: зохион байгуулагч өргөөний батлагдсан гишүүн эсвэл нийтэд нээлттэй сургалт байх ёстой.
    const member = await q(
      `SELECT 1 FROM membership m WHERE m.person_id = $1 AND m.state = 'approved'
         AND (m.urguu_id = $2 OR m.urguu_id IN (SELECT urguu_id FROM training_urguu WHERE training_id = $3))`, [v.personId, s.urguu_id, s.training_id]);
    return checkIn(q, { trainingId: s.training_id, sessionId: s.id, personId: v.personId!, allowNew: member.length > 0 || s.scope === "public" });
  });
  revalidatePath("/", "layout");
  redirect(`${here}?r=${r}`);
}

/** Зочин (нэвтрээгүй): утасны дугаараар. Нийтэд нээлттэй сургалтад жагсаалтад байхгүй бол нэрээ оруулж шинээр бүртгүүлнэ. */
export async function checkinGuest(fd: FormData) {
  const sid = str(fd, "sid", 40), token = str(fd, "token", 40);
  const here = `/a/${sid}/${token}`;
  const s = await openSession(sid, token);
  if (!s) redirect(`${here}?r=expired`);
  const phone = normPhone(str(fd, "phone", 20));
  if (!phone.value || !phone.ok) redirect(`${here}?r=phone`);
  const ip = await clientIp();
  if (!rateLimit(`att:ip:${ip}`, 30) || !rateLimit(`att:${phone.value}`, 6)) redirect(`${here}?r=rate`);
  const given = str(fd, "given_name", 80), father = str(fd, "father_name", 80);
  const r = await sysTx({ urguuId: s.urguu_id }, async (q) => {
    let p = await participantByPhone(q, s.training_id, phone.value);
    if (!p) {
      if (s.scope !== "public") return "not_listed";
      if (!given) return "need_name";
      if (!fd.get("consent")) return "need_name";
      const g = await resolveGuest(q, s.urguu_id, { father: father || null, given, phone: phone.value, email: null, phoneVerified: false });
      p = { person_id: g.personId, given_name: given };
    }
    return checkIn(q, { trainingId: s.training_id, sessionId: s.id, personId: p.person_id, allowNew: true });
  });
  revalidatePath("/", "layout");
  redirect(r === "need_name" ? `${here}?r=need_name&p=${encodeURIComponent(str(fd, "phone", 20))}` : `${here}?r=${r}`);
}
