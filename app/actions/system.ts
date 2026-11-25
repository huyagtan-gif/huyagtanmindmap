"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { processOutbox, requeue } from "@/lib/outbox";
import { requirePlatformAdmin } from "@/lib/viewer";

const done = (path: string, msg?: string): never => {
  revalidatePath("/", "layout");
  redirect(msg ? `${path}${path.includes("?") ? "&" : "?"}m=${encodeURIComponent(msg)}` : path);
};

/** P2.7: амжилтгүй болсон мэдэгдлийг дахин дараалалд оруулж, шууд оролдоно. */
export async function retryOutbox(fd: FormData) {
  await requirePlatformAdmin();
  const id = String(fd.get("id") || "");
  if (/^\d+$/.test(id)) await requeue(id);
  const r = await processOutbox(20);
  done("/admin/system?tab=outbox", `Дахин оролдлоо: ${r.sent} илгээгдсэн, ${r.failed} амжилтгүй`);
}
