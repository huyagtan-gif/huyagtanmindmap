import { processOutbox } from "./outbox";
import { purgeOtps } from "./otp";
import { logError, purgeErrors } from "./errors";
import { sendReminders } from "./reminders";
import { dailyReconciliation, reconcilePending } from "./payments";

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
      if (n % 10 === 0) await sendReminders(); // P3.9
      if (n % 15 === 0) await reconcilePending(); // P4.3: 15 минут тутам
      // P4.3: өдөр бүр Улаанбаатарын 02:00-оос хойш өмнөх өдрийн тулгалт (нэг удаа)
      if (n % 30 === 0 && new Date(Date.now() + 8 * 3600_000).getUTCHours() >= 2) await dailyReconciliation();
      if (n++ % 60 === 0) {
        await purgeOtps();
        await purgeErrors();
      }
    } catch (e) {
      console.error("[worker]", e instanceof Error ? e.message : e);
      void logError({ source: "worker", message: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : null });
    } finally {
      busy = false;
    }
  };
  setInterval(tick, 60_000).unref();
  setTimeout(tick, 5_000).unref();
}
