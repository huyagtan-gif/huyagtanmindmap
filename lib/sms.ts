import { deliverNow, enqueue, record } from "./outbox";

// P2.3: SMS илгээлт. Гарц (Мобиком / Юнител / Скайтел / зуучлагч) хараахан сонгогдоогүй тул HTTP гарцыг .env-ээр тохируулна:
//   SMS_HTTP_URL      жишээ: https://sms.example.mn/send?from={from}&to={to}&text={text}
//   SMS_HTTP_METHOD   GET (анхдагч) | POST
//   SMS_HTTP_HEADERS  JSON, жишээ: {"x-api-key":"..."}
//   SMS_HTTP_BODY     POST-ын бие (JSON загвар), жишээ: {"to":"{to}","text":"{text}","from":"{from}"}
//   SMS_FROM          илгээгчийн дугаар / нэр
//   SMS_TO_FORMAT     local (анхдагч: 8 оронтой) | e164 (+976...)
// Тохируулаагүй үед: SMS_DEV_LOG=1 эсвэл хөгжүүлэлтийн горимд консолд хэвлэнэ; production-д SMS-ийн боломжууд нуугдана.
export type SmsMode = "http" | "log" | "off";
export function smsMode(): SmsMode {
  if (process.env.SMS_HTTP_URL) return "http";
  return process.env.SMS_DEV_LOG === "1" || process.env.NODE_ENV !== "production" ? "log" : "off";
}

const fill = (tpl: string, vars: Record<string, string>, enc: (s: string) => string) => tpl.replace(/\{(to|text|from)\}/g, (_, k) => enc(vars[k] ?? ""));
const jsonEsc = (s: string) => JSON.stringify(s).slice(1, -1);

/** SMS-ийг бодитоор илгээнэ (алдаа гарвал throw). */
export async function deliverSms(to: string, text: string): Promise<void> {
  const mode = smsMode();
  if (mode === "off") throw new Error("SMS гарц тохируулаагүй");
  if (mode === "log") {
    console.log(`[sms:dev] to=${to} text="${text}"`);
    return;
  }
  const local = process.env.SMS_TO_FORMAT !== "e164";
  const vars = { to: local ? to.replace(/^\+976/, "") : to, text, from: process.env.SMS_FROM || "" };
  const method = (process.env.SMS_HTTP_METHOD || "GET").toUpperCase();
  let headers: Record<string, string> = {};
  try {
    headers = JSON.parse(process.env.SMS_HTTP_HEADERS || "{}");
  } catch {
    throw new Error("SMS_HTTP_HEADERS буруу JSON");
  }
  const init: RequestInit = { method, headers, signal: AbortSignal.timeout(10_000) };
  if (method !== "GET" && process.env.SMS_HTTP_BODY) {
    init.body = fill(process.env.SMS_HTTP_BODY, vars, jsonEsc);
    headers["Content-Type"] ||= "application/json";
  }
  const res = await fetch(fill(process.env.SMS_HTTP_URL!, vars, encodeURIComponent), init);
  if (!res.ok) throw new Error(`SMS гарц ${res.status} хариу өглөө`);
}

/**
 * SMS илгээнэ. transient (нэг удаагийн код): шууд илгээнэ, текст outbox-д хадгалагдахгүй, дахин оролдохгүй.
 * Бусад мэдэгдэл дараалалд орж, амжилтгүй бол дахин оролдоно.
 */
export async function sendSms(to: string, text: string, template: string, opts: { transient?: boolean; urguuId?: string | null } = {}): Promise<boolean> {
  if (opts.transient) {
    let err: string | null = null;
    try {
      await deliverSms(to, text);
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
      console.error("[sms] илгээж чадсангүй:", err);
    }
    await record("sms", to, template, {}, err, opts.urguuId);
    return !err;
  }
  const id = await enqueue("sms", to, template, { text }, opts.urguuId);
  return id ? deliverNow(id) : false;
}
