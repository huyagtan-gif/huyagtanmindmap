import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { sys } from "./db";

// Phase 5: Web Push (VAPID, RFC 8292). Мэдэгдлийн агуулга push үйлчилгээгээр (Google, Mozilla, Apple) ДАМЖИХГҮЙ:
// хоосон push илгээж, service worker нэвтэрсэн хэрэглэгчийн хүлээгдэж буй мессежийг /api/push/pending-ээс татна.
//   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY: `node scripts/vapid.mjs`-ээр үүсгэнэ. Тохируулаагүй бол push унтраалттай.
//   VAPID_SUBJECT: холбоо барих хаяг (анхдагч: сайтын URL).
export type PushMsg = { title: string; body: string; url: string | null };

/** Зөвхөн эдгээр push үйлчилгээ рүү илгээнэ (SSRF-ээс сэргийлнэ). */
const PUSH_HOSTS = [/\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /^push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/, /\.push\.apple\.com$/];
export function validEndpoint(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "https:" && s.length < 1000 && PUSH_HOSTS.some((r) => r.test(u.hostname));
  } catch {
    return false;
  }
}

export const vapidPublicKey = () => (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY ? process.env.VAPID_PUBLIC_KEY : null);

function privateKey() {
  const pub = Buffer.from(process.env.VAPID_PUBLIC_KEY || "", "base64url");
  const d = process.env.VAPID_PRIVATE_KEY || "";
  if (pub.length !== 65 || pub[0] !== 4 || Buffer.from(d, "base64url").length !== 32) throw new Error("VAPID түлхүүрийн хэлбэр буруу");
  return createPrivateKey({ key: { kty: "EC", crv: "P-256", d, x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") }, format: "jwk" });
}

/** VAPID JWT (ES256). aud = push үйлчилгээний origin. */
export function vapidJwt(aud: string, now = Date.now()): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const sub = process.env.VAPID_SUBJECT || (process.env.AUTH_URL || "https://huyagtan.mn").replace(/\/$/, "");
  const data = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub })}`;
  const sig = sign("sha256", Buffer.from(data), { key: privateKey(), dsaEncoding: "ieee-p1363" });
  return `${data}.${sig.toString("base64url")}`;
}
/** Тест: JWT-ийн гарын үсгийг нийтийн түлхүүрээр шалгах түлхүүр. */
export const vapidVerifyKey = () => createPublicKey(privateKey());

/** Хүнд push мэдэгдэл: мессежийг хадгалж, бүх төхөөрөмж рүү нь хоосон push илгээнэ. */
export async function pushTo(personId: string, m: PushMsg): Promise<void> {
  if (!vapidPublicKey()) return;
  const subs = await sys<{ id: string; endpoint: string }>("SELECT id, endpoint FROM push_subscription WHERE person_id = $1", [personId]);
  if (!subs.length) return;
  const url = m.url && (m.url.startsWith("/") ? m.url : m.url.startsWith(process.env.AUTH_URL || "\u0000") ? new URL(m.url).pathname + new URL(m.url).search : null);
  await sys("INSERT INTO push_message (person_id, title, body, url) VALUES ($1,$2,$3,$4)", [personId, m.title.slice(0, 120), m.body.slice(0, 400), url]);
  for (const s of subs) {
    if (!validEndpoint(s.endpoint)) continue;
    try {
      const res = await fetch(s.endpoint, {
        method: "POST",
        headers: { TTL: "86400", Urgency: "normal", Authorization: `vapid t=${vapidJwt(new URL(s.endpoint).origin)}, k=${process.env.VAPID_PUBLIC_KEY}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 404 || res.status === 410) await sys("DELETE FROM push_subscription WHERE id = $1", [s.id]);
      else if (res.ok) await sys("UPDATE push_subscription SET last_ok_at = now(), failures = 0 WHERE id = $1", [s.id]);
      else await sys("UPDATE push_subscription SET failures = failures + 1 WHERE id = $1", [s.id]);
    } catch {
      await sys("UPDATE push_subscription SET failures = failures + 1 WHERE id = $1", [s.id]);
    }
  }
  await sys("DELETE FROM push_subscription WHERE person_id = $1 AND failures >= 10", [personId]);
}

/** Service worker-т: хүлээгдэж буй мессежүүд (сүүлийн 3 хоног), авмагц хүргэгдсэн гэж тэмдэглэнэ. */
export const takePending = (personId: string) =>
  sys<{ id: string; title: string; body: string; url: string | null }>(
    `UPDATE push_message SET delivered_at = now() WHERE id IN (
       SELECT id FROM push_message WHERE person_id = $1 AND delivered_at IS NULL AND created_at > now() - interval '3 days' ORDER BY id LIMIT 5)
     RETURNING id, title, body, url`, [personId]);

export const purgePush = () => sys("DELETE FROM push_message WHERE created_at < now() - interval '7 days'");
