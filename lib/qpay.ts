import { randomBytes } from "node:crypto";
import { sys } from "./db";
import { decrypt } from "./secret";

// P4.2 / P4.3: QPay merchant API v2 клиент.
//   POST /v2/auth/token (Basic) → access_token (10 мин), POST /v2/invoice, POST /v2/payment/check, DELETE /v2/invoice/{id}
// QPAY_MOCK=1 үед жинхэнэ QPay руу хандахгүй, санах ойд дуурайна (хөгжүүлэлт, staging, e2e тест). Production-д ажиллахгүй.

export type QpayConfig = { urguuId: string; baseUrl: string; username: string; password: string; invoiceCode: string };
export type Invoice = { invoiceId: string; qrText: string; shortUrl: string | null; urls: { name: string; description: string; logo: string; link: string }[] };
export type CheckResult = { paidAmount: number; rows: { payment_id: string; payment_status: string; payment_amount: number }[] };

export const qpayMock = () => process.env.QPAY_MOCK === "1" && (process.env.NODE_ENV !== "production" || process.env.APP_ENV === "staging" || process.env.APP_ENV === "local" || !!process.env.VITEST);

/** Өргөөний идэвхтэй QPay тохиргоо (нууц үгийг тайлсан). Mock горимд тохиргоо шаардахгүй. */
export async function loadConfig(urguuId: string): Promise<QpayConfig | null> {
  if (qpayMock()) return { urguuId, baseUrl: "mock", username: "mock", password: "mock", invoiceCode: "MOCK_INVOICE" };
  const [c] = await sys<{ base_url: string; username: string | null; password_enc: string | null; invoice_code: string | null; enabled: boolean }>(
    "SELECT base_url, username, password_enc, invoice_code, enabled FROM urguu_payment_config WHERE urguu_id = $1", [urguuId]);
  if (!c?.enabled || !c.username || !c.password_enc || !c.invoice_code) return null;
  return { urguuId, baseUrl: c.base_url.replace(/\/$/, ""), username: c.username, password: decrypt(c.password_enc), invoiceCode: c.invoice_code };
}
export const paymentsEnabled = async (urguuId: string) => (await loadConfig(urguuId).catch(() => null)) !== null;

/* ---------- mock ---------- */
type MockInv = { amount: number; paid: number };
const g = globalThis as unknown as { __qpayMock?: Map<string, MockInv>; __qpayTok?: Map<string, { token: string; exp: number }> };
const mock = (g.__qpayMock ??= new Map());
/** Mock: нэхэмжлэхийг төлсөн болгоно (/api/qpay/mock хуудас, тест). */
export function mockPay(invoiceId: string, amount?: number): boolean {
  const m = mock.get(invoiceId);
  if (!qpayMock() || !m) return false;
  m.paid = amount ?? m.amount;
  return true;
}

/* ---------- жинхэнэ API ---------- */
const tokens = (g.__qpayTok ??= new Map());
async function call<T>(c: QpayConfig, method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const tok = await token(c);
  const res = await fetch(`${c.baseUrl}${path}`, {
    method, headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401 && retry) {
    tokens.delete(c.urguuId);
    return call(c, method, path, body, false);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`QPay ${method} ${path}: ${res.status} ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : {}) as T;
}
async function token(c: QpayConfig): Promise<string> {
  const t = tokens.get(c.urguuId);
  if (t && t.exp > Date.now() + 30_000) return t.token;
  const res = await fetch(`${c.baseUrl}/v2/auth/token`, {
    method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${c.username}:${c.password}`).toString("base64")}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`QPay нэвтрэлт амжилтгүй: ${res.status}`);
  const j = (await res.json()) as { access_token: string; expires_in?: number };
  tokens.set(c.urguuId, { token: j.access_token, exp: Date.now() + (j.expires_in ?? 600) * 1000 });
  return j.access_token;
}

/** Холболт шалгах (тохиргооны хуудас): токен авч чадах эсэх. */
export async function testConnection(c: QpayConfig): Promise<void> {
  if (c.baseUrl === "mock") return;
  tokens.delete(c.urguuId);
  await token(c);
}

export async function createInvoice(c: QpayConfig, o: { senderInvoiceNo: string; amount: number; description: string; callbackUrl: string }): Promise<Invoice> {
  if (c.baseUrl === "mock") {
    const id = "mock-" + randomBytes(8).toString("hex");
    mock.set(id, { amount: o.amount, paid: 0 });
    return { invoiceId: id, qrText: `MOCKQR:${id}:${o.amount}`, shortUrl: null, urls: [{ name: "Mock bank", description: "Туршилтын төлбөр (mock)", logo: "", link: `/api/qpay/mock?invoice=${id}` }] };
  }
  const r = await call<{ invoice_id: string; qr_text: string; qPay_shortUrl?: string; urls?: Invoice["urls"] }>(c, "POST", "/v2/invoice", {
    invoice_code: c.invoiceCode, sender_invoice_no: o.senderInvoiceNo, invoice_receiver_code: "terminal",
    invoice_description: o.description.slice(0, 255), amount: o.amount, callback_url: o.callbackUrl,
  });
  return { invoiceId: r.invoice_id, qrText: r.qr_text, shortUrl: r.qPay_shortUrl ?? null, urls: (r.urls || []).slice(0, 40) };
}

/** P4.3: нэхэмжлэхийн төлөлтийг QPay-аас шууд асууна (callback-д итгэхгүй). */
export async function checkInvoice(c: QpayConfig, invoiceId: string): Promise<CheckResult> {
  if (c.baseUrl === "mock") {
    const m = mock.get(invoiceId);
    return m?.paid ? { paidAmount: m.paid, rows: [{ payment_id: "mockpay-" + invoiceId.slice(5), payment_status: "PAID", payment_amount: m.paid }] } : { paidAmount: 0, rows: [] };
  }
  const r = await call<{ count: number; paid_amount?: number | string; rows?: { payment_id: string | number; payment_status: string; payment_amount: string | number }[] }>(
    c, "POST", "/v2/payment/check", { object_type: "INVOICE", object_id: invoiceId, offset: { page_number: 1, page_limit: 100 } });
  const rows = (r.rows || []).map((x) => ({ payment_id: String(x.payment_id), payment_status: String(x.payment_status), payment_amount: Number(x.payment_amount) || 0 }));
  const paid = rows.filter((x) => x.payment_status === "PAID").reduce((s, x) => s + x.payment_amount, 0);
  return { paidAmount: paid, rows };
}

export async function cancelInvoice(c: QpayConfig, invoiceId: string): Promise<void> {
  if (c.baseUrl === "mock") {
    mock.delete(invoiceId);
    return;
  }
  await call(c, "DELETE", `/v2/invoice/${encodeURIComponent(invoiceId)}`);
}
