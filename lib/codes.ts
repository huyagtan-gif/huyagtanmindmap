import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

const ABC = "abcdefghjkmnpqrstuvwxyz23456789";
/** Нийтийн хуудасны богино код (таахад хэцүү, уншихад амар). */
export function publicCode(len = 10): string {
  let s = "";
  for (let i = 0; i < len; i++) s += ABC[randomInt(ABC.length)];
  return s;
}
/** Нэг удаа үзүүлэх нууц токен ба түүний hash (DB-д зөвхөн hash хадгална). */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(24).toString("base64url");
  return { token, hash: hashToken(token) };
}
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const secret = () => process.env.AUTH_SECRET || "dev-secret";
/** Богино хугацааны гарын үсэгтэй утга (cookie-д хадгалах түр өгөгдөл): base64url(JSON).HMAC */
export function sealJson(data: unknown, ttlSec: number): string {
  const body = Buffer.from(JSON.stringify({ d: data, e: Math.floor(Date.now() / 1000) + ttlSec })).toString("base64url");
  return `${body}.${createHmac("sha256", secret()).update(body).digest("base64url")}`;
}
export function openJson<T>(sealed: string | undefined | null): T | null {
  if (!sealed || sealed.length > 4000) return null;
  const [body, sig] = sealed.split(".");
  if (!body || !sig) return null;
  const want = createHmac("sha256", secret()).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const j = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { d: T; e: number };
    return j.e > Date.now() / 1000 ? j.d : null;
  } catch {
    return null;
  }
}
