"use server";
import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/lib/auth";
import { sys, sysTx } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";
import { getViewer } from "@/lib/viewer";
import { capFirst, capWords, normPhone } from "@/lib/norm";
import { verifyCaptcha } from "@/lib/captcha";
import { checkOtp, issueOtp } from "@/lib/otp";
import { createSession } from "@/lib/session";
import { smsMode } from "@/lib/sms";

const CONSENT_VERSION = "2026-11";

async function clientIp() {
  const h = await headers();
  return (h.get("x-forwarded-for") || "").split(",")[0].trim() || h.get("x-real-ip") || "local";
}
const safeNext = (s: FormDataEntryValue | null) => (typeof s === "string" && s.startsWith("/") && !s.startsWith("//") ? s : "/");
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;

/** Нэвтрэх холбоос илгээгээд "Имэйлээ шалгана уу" хуудас руу шилжинэ. */
async function sendLink(email: string, redirectTo: string): Promise<never> {
  try {
    await signIn("nodemailer", { email, redirectTo, redirect: false });
  } catch (e) {
    console.error("[auth] холбоос илгээж чадсангүй:", e instanceof Error ? e.message : e);
    redirect("/login?e=default");
  }
  redirect("/login/check");
}

export async function loginEmail(fd: FormData) {
  const email = String(fd.get("email") || "").trim().toLowerCase();
  const next = safeNext(fd.get("next"));
  if (!isEmail(email)) redirect(`/login?e=email&next=${encodeURIComponent(next)}`);
  const ip = await clientIp();
  if (!rateLimit(`login:ip:${ip}`, 10) || !rateLimit(`login:${email}`, 5)) redirect("/login?e=rate");
  if (!(await verifyCaptcha(fd, ip))) redirect(`/login?e=captcha&next=${encodeURIComponent(next)}`);
  await sendLink(email, next);
}

export async function loginGoogle(fd: FormData) {
  await signIn("google", { redirectTo: safeNext(fd.get("next")) });
}

export async function logout() {
  (await cookies()).delete("view_as");
  await signOut({ redirectTo: "/login" });
}

/** P1.4 Бүртгүүлэх: нэр, утас, имэйл + зөвшөөрөл → хүлээгдэж буй гишүүнчлэл → имэйлээр баталгаажуулах холбоос. */
export async function register(fd: FormData) {
  const viewer = await getViewer();
  const given = capFirst(String(fd.get("given_name") || ""));
  const father = capFirst(String(fd.get("father_name") || ""));
  const clan = capWords(String(fd.get("clan_name") || ""));
  const phone = normPhone(String(fd.get("phone") || ""));
  const email = (viewer?.email || String(fd.get("email") || "")).trim().toLowerCase();
  const back: (e: string) => never = (e) => redirect(`/register?e=${e}`);
  if (!fd.get("consent")) back("consent");
  if (!given || given.length > 80 || father.length > 80) back("name");
  if (!phone.value) back("phone");
  if (!isEmail(email)) back("email");
  const ip = await clientIp();
  if (!rateLimit(`reg:ip:${ip}`, 5) || !rateLimit(`reg:${email}`, 5)) back("rate");
  if (!(await verifyCaptcha(fd, ip))) back("captcha");

  const [exists] = await sys("SELECT 1 FROM person_private WHERE lower(email) = $1", [email]);
  if (!exists) {
    const personId = await sysTx({ userId: viewer?.userId ?? null }, async (q) => {
      const [u] = await q<{ id: string }>("SELECT id FROM urguu WHERE state = 'active' ORDER BY created_at LIMIT 1");
      const [st] = await q<{ id: string }>("SELECT id FROM status WHERE active ORDER BY sort LIMIT 1");
      const [role] = await q<{ id: string }>("SELECT id FROM role WHERE urguu_id = $1 AND NOT is_system ORDER BY sort DESC LIMIT 1", [u.id]);
      const [p] = await q<{ id: string }>(
        "INSERT INTO person (clan_name, father_name, given_name, status_id, created_urguu_id) VALUES ($1,$2,$3,$4,$5) RETURNING id",
        [clan || null, father || null, given, st?.id ?? null, u.id],
      );
      await q("INSERT INTO person_private (person_id, phone, email, email_verified) VALUES ($1,$2,$3,$4)", [p.id, phone.value, email, !!viewer]);
      await q("INSERT INTO membership (person_id, urguu_id, role_id, state) VALUES ($1,$2,$3,'pending')", [p.id, u.id, role?.id ?? null]);
      await q("INSERT INTO consent (person_id, version) VALUES ($1,$2)", [p.id, CONSENT_VERSION]);
      return p.id;
    });
    void personId;
  }
  // Нэвтэрсэн (жишээ нь Google-ээр) бол шууд; үгүй бол имэйлээр баталгаажуулах холбоос илгээнэ.
  // Хүн ба хэрэглэгчийг холбох, админд мэдэгдэх ажил эхний нэвтрэлтэд (lib/viewer.ts linkUser) хийгдэнэ.
  if (viewer) redirect("/pending");
  await sendLink(email, "/pending");
}

export async function setViewAs(fd: FormData) {
  const v = await getViewer();
  const role = String(fd.get("role") || "");
  const jar = await cookies();
  if (!v?.canViewAs || !role || role === v.realRole?.id) jar.delete("view_as");
  else jar.set("view_as", role, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect(safeNext(fd.get("next")) === "/" ? "/map" : safeNext(fd.get("next")));
}

/** P1.5 Урилга хүлээн авах: нэвтэрсэн имэйл урилгын имэйлтэй таарвал батлалгүй шууд гишүүн болно. */
export async function acceptInvite(fd: FormData) {
  const token = String(fd.get("token") || "");
  const v = await getViewer();
  if (!v) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256").update(token).digest("hex");
  const ok = await sysTx({ userId: v.userId, personId: v.personId }, async (q) => {
    const [inv] = await q<{ id: string; urguu_id: string; role_id: string; email: string }>(
      "SELECT id, urguu_id, role_id, email FROM invite WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE",
      [hash],
    );
    if (!inv || inv.email.toLowerCase() !== v.email.toLowerCase()) return false;
    let personId = v.personId;
    if (!personId) {
      const [st] = await q<{ id: string }>("SELECT id FROM status WHERE active ORDER BY sort LIMIT 1");
      const nm = (v.userName || v.email.split("@")[0]).trim().split(/\s+/);
      const given = nm.pop()!;
      const [p] = await q<{ id: string }>(
        "INSERT INTO person (father_name, given_name, status_id, created_urguu_id) VALUES ($1,$2,$3,$4) RETURNING id",
        [nm.join(" ") || null, given, st?.id ?? null, inv.urguu_id],
      );
      personId = p.id;
      await q("INSERT INTO person_private (person_id, email, email_verified) VALUES ($1,$2,true)", [personId, v.email.toLowerCase()]);
      await q("UPDATE users SET person_id = $1 WHERE id = $2", [personId, v.userId]);
    }
    await q(
      `INSERT INTO membership (person_id, urguu_id, role_id, state, decided_at) VALUES ($1,$2,$3,'approved',now())
       ON CONFLICT (person_id, urguu_id) DO UPDATE SET role_id = EXCLUDED.role_id, state = 'approved', decided_at = now()`,
      [personId, inv.urguu_id, inv.role_id],
    );
    await q("UPDATE invite SET used_at = now() WHERE id = $1", [inv.id]);
    return true;
  });
  redirect(ok ? "/" : `/invite/${token}?e=1`);
}


/* ---------- P2.3 SMS кодоор нэвтрэх ---------- */

/** Утасны дугаар руу нэг удаагийн код илгээнэ. Дугаар бүртгэлтэй эсэхийг хариугаар ялгахгүй (тоочихоос сэргийлнэ). */
export async function loginSmsRequest(fd: FormData) {
  const next = safeNext(fd.get("next"));
  if (smsMode() === "off") redirect("/login");
  const phone = normPhone(String(fd.get("phone") || ""));
  if (!phone.value || !phone.ok) redirect(`/login?e=phone&next=${encodeURIComponent(next)}`);
  const ip = await clientIp();
  if (!rateLimit(`sms:ip:${ip}`, 5) || !rateLimit(`sms:${phone.value}`, 3)) redirect("/login?e=rate");
  if (!(await verifyCaptcha(fd, ip))) redirect(`/login?e=captcha&next=${encodeURIComponent(next)}`);
  // Зөвхөн баталгаажсан утастай, нэвтрэх хэрэглэгчтэй хүнд код явна.
  const [u] = await sys<{ person_id: string }>(
    "SELECT pp.person_id FROM person_private pp JOIN users u ON u.person_id = pp.person_id JOIN person p ON p.id = pp.person_id WHERE pp.phone = $1 AND pp.phone_verified AND p.merged_into_id IS NULL",
    [phone.value],
  );
  if (u) await issueOtp(phone.value, "login", u.person_id);
  redirect(`/login/sms?phone=${encodeURIComponent(phone.value)}&next=${encodeURIComponent(next)}`);
}

export async function loginSmsVerify(fd: FormData) {
  const next = safeNext(fd.get("next"));
  const phone = normPhone(String(fd.get("phone") || "")).value;
  const code = String(fd.get("code") || "").replace(/\s/g, "");
  const back = (e: string): never => redirect(`/login/sms?phone=${encodeURIComponent(phone)}&next=${encodeURIComponent(next)}&e=${e}`);
  if (!rateLimit(`smsv:ip:${await clientIp()}`, 15) || !rateLimit(`smsv:${phone}`, 8)) back("rate");
  const r = await checkOtp(phone, "login", code);
  if (!r.ok || !r.personId) back("code");
  const [u] = await sys<{ id: number }>(
    "SELECT u.id FROM users u JOIN person_private pp ON pp.person_id = u.person_id WHERE u.person_id = $1 AND pp.phone = $2 AND pp.phone_verified",
    [r.personId, phone],
  );
  if (!u) back("code");
  await createSession(u.id);
  redirect(next);
}

/* ---------- P2.3 Утас баталгаажуулах (нэвтэрсэн хэрэглэгч өөрийн утсыг) ---------- */

export async function requestPhoneVerify() {
  const v = await getViewer();
  if (!v?.personId) redirect("/login");
  if (smsMode() === "off") redirect("/me");
  const [pp] = await sys<{ phone: string | null; phone_verified: boolean }>("SELECT phone, phone_verified FROM person_private WHERE person_id = $1", [v.personId]);
  if (!pp?.phone) redirect("/me?pv=nophone#account");
  if (pp.phone_verified) redirect("/me#account");
  if (!normPhone(pp.phone).ok) redirect("/me?pv=format#account");
  if (!rateLimit(`pv:${v.personId}`, 3) || !rateLimit(`pv:ip:${await clientIp()}`, 6)) redirect("/me?pv=rate#account");
  const r = await issueOtp(pp.phone, "verify", v.personId);
  redirect(`/me?pv=${r === "sent" ? "sent" : r}#account`);
}

export async function confirmPhoneVerify(fd: FormData) {
  const v = await getViewer();
  if (!v?.personId) redirect("/login");
  const [pp] = await sys<{ phone: string | null }>("SELECT phone FROM person_private WHERE person_id = $1", [v.personId]);
  if (!pp?.phone) redirect("/me#account");
  if (!rateLimit(`pvc:${v.personId}`, 10)) redirect("/me?pv=rate#account");
  const r = await checkOtp(pp.phone, "verify", String(fd.get("code") || "").replace(/\s/g, ""));
  if (!r.ok || r.personId !== v.personId) redirect("/me?pv=code#account");
  try {
    await sysTx({ userId: v.userId, personId: v.personId }, (q) => q("UPDATE person_private SET phone_verified = true WHERE person_id = $1 AND phone = $2", [v.personId, pp.phone]));
  } catch (e: any) {
    if (e?.code === "23505") redirect("/me?pv=taken#account");
    throw e;
  }
  redirect("/me?pv=ok#account");
}
