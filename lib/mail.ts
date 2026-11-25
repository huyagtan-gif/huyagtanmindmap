import nodemailer from "nodemailer";
import { deliverNow, enqueue, record } from "./outbox";

const FROM = process.env.EMAIL_FROM || "Хуягтан <no-reply@huyagtan.mn>";
export const SITE_URL = (process.env.AUTH_URL || process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/$/, "");

let transport: nodemailer.Transporter | null = null;
function getTransport() {
  if (!process.env.EMAIL_SERVER) return null;
  return (transport ??= nodemailer.createTransport(process.env.EMAIL_SERVER));
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function layout(title: string, body: string, cta?: { label: string; url: string }) {
  return `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#121B2A">
  <h2 style="margin:0 0 12px">${esc(title)}</h2>
  <p style="line-height:1.55;color:#3B4657">${body}</p>
  ${cta ? `<p style="margin:24px 0"><a href="${cta.url}" style="background:#1E4FA0;color:#fff;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:600">${esc(cta.label)}</a></p>
  <p style="font-size:13px;color:#5A6576">Товч ажиллахгүй бол энэ холбоосыг хөтөч дээрээ хуулна уу:<br>${esc(cta.url)}</p>` : ""}
  <p style="font-size:12px;color:#8A94A3;margin-top:32px">Хуягтан · huyagtan.mn</p></div>`;
}

export type Mail = { to: string; subject: string; title: string; body: string; cta?: { label: string; url: string }; template: string; urguuId?: string | null };
export type MailContent = Pick<Mail, "subject" | "title" | "body" | "cta">;

/** Имэйлийг бодитоор илгээнэ (алдаа гарвал throw). EMAIL_SERVER тохируулаагүй бол (хөгжүүлэлт) консолд хэвлэнэ. */
export async function deliverMail(to: string, m: MailContent): Promise<void> {
  const t = getTransport();
  const text = `${m.title}\n\n${m.body.replace(/<[^>]+>/g, "")}${m.cta ? `\n\n${m.cta.label}: ${m.cta.url}` : ""}`;
  if (t) await t.sendMail({ from: FROM, to, subject: m.subject, text, html: layout(m.title, m.body, m.cta) });
  else console.log(`[mail:dev] to=${to} subject="${m.subject}"${m.cta ? ` link=${m.cta.url}` : ""}`);
}

/**
 * Имэйл илгээнэ. Буцаах утга: яг одоо илгээгдсэн эсэх.
 *  - transient (нэвтрэх холбоос, урилга зэрэг нууц токентой): шууд илгээнэ, агуулга outbox-д ХАДГАЛАГДАХГҮЙ, дахин оролдохгүй.
 *  - бусад: outbox-д дараалалд орж шууд нэг оролдоно; амжилтгүй бол ажилчин дахин оролдоно (P2.7).
 */
export async function sendMail(m: Mail, opts: { transient?: boolean } = {}): Promise<boolean> {
  if (opts.transient) {
    let err: string | null = null;
    try {
      await deliverMail(m.to, m);
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
      console.error("[mail] илгээж чадсангүй:", err);
    }
    await record("email", m.to, m.template, { subject: m.subject }, err, m.urguuId);
    return !err;
  }
  const id = await enqueue("email", m.to, m.template, { subject: m.subject, title: m.title, body: m.body, cta: m.cta }, m.urguuId);
  return id ? deliverNow(id) : false;
}

export { esc as escHtml };
