import { callbackSigValid, verifyPayment } from "@/lib/payments";
import { rateLimit } from "@/lib/ratelimit";

// P4.3: QPay-ийн callback. Биед нь итгэхгүй: зөвхөн манай гарын үсэгтэй төлбөрийн id-аар QPay-аас payment/check-ээр шалгуулна.
async function handle(req: Request) {
  const u = new URL(req.url);
  const id = u.searchParams.get("p") || "";
  const sig = u.searchParams.get("s") || "";
  if (!/^[0-9a-f-]{36}$/i.test(id) || !callbackSigValid(id, sig)) return new Response("bad request", { status: 400 });
  if (!rateLimit(`qpaycb:${id}`, 20, 60_000)) return new Response("slow down", { status: 429 });
  try {
    await verifyPayment(id);
  } catch (e) {
    console.error("[qpay] callback:", e instanceof Error ? e.message : e);
    // Алдаа гарсан ч 15 минутын тулгалт дахин шалгана.
  }
  return new Response("SUCCESS", { headers: { "Content-Type": "text/plain" } });
}
export const GET = handle;
export const POST = handle;
