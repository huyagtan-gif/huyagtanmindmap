import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { sys } from "./db";
import { sendSms } from "./sms";

// P2.3: SMS нэг удаагийн код. 6 орон, 5 минут хүчинтэй, 5 хүртэл оролдлого, hash-аар хадгална.
export type OtpPurpose = "verify" | "login" | "public";
const TTL_MIN = 5;
const MAX_TRIES = 5;
const MAX_PER_PHONE = 5; // 15 минутад нэг дугаарт илгээх дээд тоо (N6)

const hash = (code: string, phone: string) => createHash("sha256").update(`${code}:${phone}:${process.env.AUTH_SECRET || ""}`).digest("hex");

/** Код үүсгэж SMS-ээр илгээнэ. */
export async function issueOtp(phone: string, purpose: OtpPurpose, personId: string | null): Promise<"sent" | "rate" | "fail"> {
  const [c] = await sys<{ n: number }>("SELECT count(*)::int AS n FROM phone_otp WHERE phone = $1 AND created_at > now() - interval '15 minutes'", [phone]);
  if (c.n >= MAX_PER_PHONE) return "rate";
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  // Өмнөх ашиглагдаагүй кодууд хүчингүй болно.
  await sys("UPDATE phone_otp SET used_at = now() WHERE phone = $1 AND purpose = $2 AND used_at IS NULL", [phone, purpose]);
  await sys("INSERT INTO phone_otp (phone, purpose, person_id, code_hash, expires_at) VALUES ($1,$2,$3,$4, now() + make_interval(mins => $5))", [phone, purpose, personId, hash(code, phone), TTL_MIN]);
  const ok = await sendSms(phone, `Хуягтан: таны баталгаажуулах код ${code}. ${TTL_MIN} минут хүчинтэй. Хэнд ч бүү хэлээрэй.`, `otp_${purpose}`, { transient: true });
  return ok ? "sent" : "fail";
}

/** Кодыг шалгана. Зөв бол кодыг ашигласан гэж тэмдэглээд холбогдох person_id-г буцаана. */
export async function checkOtp(phone: string, purpose: OtpPurpose, code: string): Promise<{ ok: boolean; personId: string | null }> {
  if (!/^\d{6}$/.test(code)) return { ok: false, personId: null };
  const [r] = await sys<{ id: string; code_hash: string; attempts: number; person_id: string | null }>(
    `UPDATE phone_otp SET attempts = attempts + 1
     WHERE id = (SELECT id FROM phone_otp WHERE phone = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now() ORDER BY id DESC LIMIT 1)
     RETURNING id, code_hash, attempts, person_id`,
    [phone, purpose],
  );
  if (!r || r.attempts > MAX_TRIES) return { ok: false, personId: null };
  const a = Buffer.from(r.code_hash, "hex"), b = Buffer.from(hash(code, phone), "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, personId: null };
  await sys("UPDATE phone_otp SET used_at = now() WHERE id = $1", [r.id]);
  return { ok: true, personId: r.person_id };
}

/** Хуучин кодуудыг цэвэрлэнэ (ажилчин дуудна). */
export const purgeOtps = () => sys("DELETE FROM phone_otp WHERE created_at < now() - interval '1 day'");
