// Next.js-ийн эхлэх цэг: серверийн процесс асахад дэвсгэр ажилчныг эхлүүлнэ (P2.7).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startWorker } = await import("./lib/worker");
  startWorker();
}
