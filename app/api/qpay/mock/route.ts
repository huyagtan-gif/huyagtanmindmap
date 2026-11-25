import { sys } from "@/lib/db";
import { verifyPayment } from "@/lib/payments";
import { mockPay, qpayMock } from "@/lib/qpay";

// Зөвхөн QPAY_MOCK=1 (хөгжүүлэлт / staging): банкны аппын оронд «төлөх» товчтой туршилтын хуудас.
const page = (body: string) =>
  new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QPay mock</title>
<body style="font:16px system-ui;max-width:420px;margin:40px auto;padding:0 16px">${body}</body>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

export async function GET(req: Request) {
  if (!qpayMock()) return new Response("Not found", { status: 404 });
  const inv = new URL(req.url).searchParams.get("invoice") || "";
  const [p] = await sys<{ amount: number; state: string }>("SELECT amount, state FROM payment WHERE qpay_invoice_id = $1", [inv]);
  if (!p) return page("<h2>Нэхэмжлэх олдсонгүй</h2>");
  return page(`<h2>Туршилтын төлбөр (mock)</h2><p>Дүн: <b>${p.amount}₮</b> · төлөв: ${p.state}</p>
<form method="post"><input type="hidden" name="invoice" value="${inv.replace(/[^\w-]/g, "")}"><button style="font:inherit;padding:10px 18px">Төлөх</button></form>
<p style="color:#666">Энэ хуудас зөвхөн туршилтын орчинд ажиллана. Жинхэнэ мөнгө шилжихгүй.</p>`);
}

export async function POST(req: Request) {
  if (!qpayMock()) return new Response("Not found", { status: 404 });
  const fd = await req.formData();
  const inv = String(fd.get("invoice") || "");
  const [p] = await sys<{ id: string }>("SELECT id FROM payment WHERE qpay_invoice_id = $1", [inv]);
  if (!p || !mockPay(inv)) return page("<h2>Нэхэмжлэх олдсонгүй</h2>");
  // QPay шиг callback илгээсэн мэт шалгуулна
  await verifyPayment(p.id);
  return page("<h2>Төлөгдлөө ✓</h2><p>Апп руугаа буцаж «Төлбөрөө шалгах» дарна уу (эсвэл хуудсаа шинэчилнэ үү).</p>");
}
