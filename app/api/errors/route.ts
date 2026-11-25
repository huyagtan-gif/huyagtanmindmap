import { logError } from "@/lib/errors";
import { rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

// P2.9: хөтөч дээр гарсан (серверт харагдахгүй) алдааг хүлээн авна. Нэвтрээгүй хуудсанд ч ажиллах ёстой тул
// эрх шаардахгүй; оронд нь зөвхөн өөрийн сайтаас, бага хэмжээтэй, IP бүрээс цөөн тоогоор авна.
export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) return new Response(null, { status: 403 });
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
  if (!rateLimit(`cerr:${ip}`, 10, 10 * 60_000)) return new Response(null, { status: 429 });
  const raw = await req.text();
  if (raw.length > 8000) return new Response(null, { status: 413 });
  let b: { message?: unknown; stack?: unknown; path?: unknown };
  try {
    b = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 400 });
  }
  if (typeof b.message !== "string" || !b.message.trim()) return new Response(null, { status: 400 });
  await logError({
    source: "client", message: b.message, stack: typeof b.stack === "string" ? b.stack : null,
    // Замаас query-г хасна; id, тоонуудыг logError цэвэрлэнэ.
    route: typeof b.path === "string" ? b.path.split("?")[0].slice(0, 200) : null,
  });
  return new Response(null, { status: 204 });
}
