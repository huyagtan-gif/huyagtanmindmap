import type { Instrumentation } from "next";

// Next.js-ийн эхлэх цэг: серверийн процесс асахад дэвсгэр ажилчныг эхлүүлнэ (P2.7).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startWorker } = await import("./lib/worker");
  startWorker();
}

// P2.9: хуудас, server action, API-д гарсан барьж аваагүй алдааг бүртгэнэ.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const e = err as Error & { digest?: string };
  if (e?.digest?.startsWith("NEXT_")) return; // redirect / notFound бол алдаа биш
  const { logError } = await import("./lib/errors");
  // Жинхэнэ замын оронд route-ийн загварыг (жишээ /people/[id]) хадгална: хувийн id орохгүй.
  await logError({ source: "server", message: e?.message || String(err), stack: e?.stack, digest: e?.digest,
    route: `${request.method} ${context.routePath || "?"} (${context.routeType})` });
};
