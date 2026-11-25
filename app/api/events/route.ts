import { subscribe } from "@/lib/realtime";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** P2.1: SSE дохионы суваг. Зөвхөн батлагдсан гишүүн, зөвхөн өөрийн өргөөний дохио. Өгөгдөл явахгүй (A3). */
export async function GET(req: Request) {
  const v = await getViewer();
  if (!v || v.membershipState !== "approved" || !v.urguu) return new Response("Unauthorized", { status: 401 });
  const urguuId = v.urguu.id;
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      let closed = false;
      const send = (s: string) => {
        if (closed) return;
        try {
          ctrl.enqueue(enc.encode(s));
        } catch {
          cleanup();
        }
      };
      // Олон мөр зэрэг өөрчлөгдөхөд (импорт, эрх хадгалах) нэг л дохио болгон нэгтгэнэ.
      let pending = new Set<string>();
      let flush: ReturnType<typeof setTimeout> | null = null;
      const unsub = subscribe(urguuId, (sig) => {
        pending.add(sig.entity);
        flush ??= setTimeout(() => {
          send(`data: ${JSON.stringify({ entities: [...pending] })}\n\n`);
          pending = new Set();
          flush = null;
        }, 300);
      });
      if (!unsub) {
        ctrl.close();
        return;
      }
      const hb = setInterval(() => send(": hb\n\n"), 25_000);
      // 30 минут тутамд хаана: хөтөч автоматаар дахин холбогдож, эрх дахин шалгагдана.
      const ttl = setTimeout(() => cleanup(), 30 * 60_000);
      cleanup = () => {
        if (closed) return;
        closed = true;
        unsub();
        clearInterval(hb);
        clearTimeout(ttl);
        if (flush) clearTimeout(flush);
        try {
          ctrl.close();
        } catch {}
      };
      req.signal.addEventListener("abort", () => cleanup());
      send("retry: 4000\n\n: connected\n\n");
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
