import { createHash } from "node:crypto";
import { sys } from "./db";
import { rateLimit } from "./ratelimit";

// P2.9: алдааны хяналт. Алдааг error_log хүснэгтэд давхардуулалгүй бичиж, шинэ алдаа гарвал супер админд имэйлээр мэдэгдэнэ.
export type ErrSource = "server" | "worker" | "client";
export type ErrInput = { source: ErrSource; message: string; stack?: string | null; route?: string | null; digest?: string | null };

/** Алдааны текстэд хувийн мэдээлэл (имэйл, утас, id) үлдээхгүй. */
export const scrub = (s: string) =>
  s
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "<имэйл>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\+?\d{8,}/g, "<тоо>");

const clip = (s: string | null | undefined, n: number) => (s ? scrub(String(s)).slice(0, n) : null);

/** Ижил алдааг нэг мөрөнд нэгтгэх түлхүүр: эх сурвалж + текст + stack-ийн эхний мөр. */
export function fingerprint(source: string, message: string, stack?: string | null) {
  const frame = (stack || "").split("\n").map((l) => l.trim()).find((l) => l.startsWith("at ")) || "";
  return createHash("sha256").update(`${source}\n${message}\n${frame}`).digest("hex").slice(0, 32);
}

/** Хэзээ ч алдаа шидэхгүй: хяналт өөрөө апп-ыг унагаах ёсгүй. */
export async function logError(e: ErrInput): Promise<void> {
  try {
    // Алдааны шуурга санг дүүргэхээс сэргийлнэ.
    if (!rateLimit("errlog", 120, 60_000)) return;
    const message = clip(e.message, 500) || "Тодорхойгүй алдаа";
    const stack = clip(e.stack, 4000);
    const [row] = await sys<{ id: string; alert: boolean }>(
      `INSERT INTO error_log (fingerprint, source, message, stack, route, digest, build) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (fingerprint) DO UPDATE SET count = error_log.count + 1, last_at = now(),
         route = coalesce(EXCLUDED.route, error_log.route), digest = coalesce(EXCLUDED.digest, error_log.digest), build = EXCLUDED.build
       RETURNING id, (alerted_at IS NULL OR alerted_at < now() - interval '24 hours') AS alert`,
      [fingerprint(e.source, message, stack), e.source, message, stack, clip(e.route, 200), e.digest ? String(e.digest).replace(/[^\w-]/g, "").slice(0, 64) : null, process.env.NEXT_PUBLIC_BUILD_SHA?.slice(0, 12) || null]);
    // Хөтчөөс ирсэн мэдээллийг нэвтрээгүй хүн ч илгээж чаддаг тул имэйл мэдэгдэл явуулахгүй.
    if (!row?.alert || e.source === "client" || process.env.ERROR_ALERTS === "off") return;
    if (!rateLimit("erralert", 5, 60 * 60_000)) return;
    await sys("UPDATE error_log SET alerted_at = now() WHERE id = $1", [row.id]);
    const to = new Set((await sys<{ email: string }>("SELECT email FROM users WHERE is_platform_admin AND email IS NOT NULL")).map((r) => r.email));
    if (!to.size) return;
    const { sendMail, SITE_URL, escHtml } = await import("./mail");
    const env = process.env.APP_ENV === "staging" ? " (staging)" : "";
    for (const email of to)
      await sendMail({ to: email, template: "error_alert", subject: `Хуягтан${env}: системд алдаа гарлаа`, title: "Системд алдаа гарлаа",
        body: `<b>${escHtml(message)}</b><br>${e.route ? `Хуудас: ${escHtml(clip(e.route, 200) || "")}<br>` : ""}Ижил алдаа давтагдвал 24 цагийн дотор дахин мэдэгдэхгүй.`,
        cta: { label: "Алдааны жагсаалт", url: `${SITE_URL}/admin/system?tab=errors` } });
  } catch (err) {
    console.error("[errors] алдааг бүртгэж чадсангүй:", err instanceof Error ? err.message : err);
  }
}

/** 30 хоногоос хуучин алдааг цэвэрлэнэ (дэвсгэр ажилчин дуудна). */
export const purgeErrors = () => sys("DELETE FROM error_log WHERE last_at < now() - interval '30 days'");
