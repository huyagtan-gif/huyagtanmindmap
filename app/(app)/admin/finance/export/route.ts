import { donorName } from "@/components/DonationCard";
import { finRange } from "@/lib/finance";
import { PAYMENT_STATE, type Payment } from "@/lib/payments";
import { fmtRange } from "@/lib/time";
import { asViewer, getViewer } from "@/lib/viewer";
import { buildXlsx } from "@/lib/xlsx";

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // CSV injection-оос сэргийлнэ
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** P4.7: санхүүгийн гүйлгээний экспорт (CSV / Excel). «Санхүүгийн тайлан харах» эрхтэй. */
export async function GET(req: Request) {
  const v = await getViewer();
  if (!v || v.membershipState !== "approved" || !v.urguu || !v.perms.has("finance.view")) return new Response("Forbidden", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const r = finRange(sp.get("from") || undefined, sp.get("to") || undefined);
  const rows = await asViewer(v, (q) => q<Payment & { given_name: string | null; father_name: string | null; what: string | null }>(
    `SELECT pm.*, p.given_name, p.father_name, coalesce(t.name, e.name) AS what FROM payment pm
     LEFT JOIN person p ON p.id = pm.payer_person_id LEFT JOIN training t ON t.id = pm.training_id LEFT JOIN event e ON e.id = pm.event_id
     WHERE pm.urguu_id = app_urguu() AND pm.state IN ('paid','refunded') AND coalesce(pm.paid_at, pm.created_at) >= $1 AND coalesce(pm.paid_at, pm.created_at) < $2
     ORDER BY pm.paid_at`, [r.from, r.to]));
  const header = ["Огноо", "Төрөл", "Зориулалт", "Төлөгч", "Дүн", "Төлөв", "Арга", "Нэхэмжлэх", "QPay гүйлгээ", "Буцаасан огноо", "Тэмдэглэл"];
  const data = rows.map((p) => [
    p.paid_at ? fmtRange(p.paid_at) : "", p.kind === "training" ? "Сургалт" : "Хандив", p.what || "",
    p.kind === "donation" ? donorName(p) : p.given_name ? donorName({ ...p, anonymous: false }) : p.payer_name || "",
    p.amount, PAYMENT_STATE[p.state]?.[1] || p.state, p.method === "manual" ? "Гараар" : "QPay", p.sender_invoice_no, p.qpay_payment_id || "",
    p.refunded_at ? fmtRange(p.refunded_at) : "", p.refund_note || p.note || "",
  ]);
  const name = `huyagtan-sanhuu-${r.fromYmd}_${r.toYmd}`;
  if (sp.get("format") === "xlsx")
    return new Response(new Uint8Array(buildXlsx("Санхүү", header, data)), {
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}.xlsx"`, "Cache-Control": "no-store" },
    });
  const csv = [header.map(cell).join(","), ...data.map((row) => row.map(cell).join(","))].join("\r\n");
  return new Response("﻿" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"`, "Cache-Control": "no-store" } });
}
