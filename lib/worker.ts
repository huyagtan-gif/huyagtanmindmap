import { processOutbox } from "./outbox";
import { purgeOtps } from "./otp";

// Дэвсгэр ажилчин: нэг процесс, минут тутам. Outbox-ын хугацаа болсон мэдэгдлийг илгээнэ, хуучин кодыг цэвэрлэнэ.
const g = globalThis as unknown as { __worker?: boolean };

export function startWorker() {
  if (g.__worker || !process.env.DATABASE_URL || process.env.NEXT_PHASE === "phase-production-build" || process.env.VITEST) return;
  g.__worker = true;
  let busy = false;
  let n = 0;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await processOutbox();
      if (n++ % 60 === 0) await purgeOtps();
    } catch (e) {
      console.error("[worker]", e instanceof Error ? e.message : e);
    } finally {
      busy = false;
    }
  };
  setInterval(tick, 60_000).unref();
  setTimeout(tick, 5_000).unref();
}
