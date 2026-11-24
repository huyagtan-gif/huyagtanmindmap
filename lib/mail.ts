import nodemailer from "nodemailer";
import { sys } from "./db";

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

export type Mail = { to: string; subject: string; title: string; body: string; cta?: { label: string; url: string }; template: string };

/** Имэйл илгээж, notification_outbox-д бүртгэнэ. EMAIL_SERVER тохируулаагүй бол (хөгжүүлэлт) консолд хэвлэнэ. */
export async function sendMail(m: Mail): Promise<boolean> {
  const t = getTransport();
  const text = `${m.title}\n\n${m.body.replace(/<[^>]+>/g, "")}${m.cta ? `\n\n${m.cta.label}: ${m.cta.url}` : ""}`;
  let ok = true;
  let err: string | null = null;
  try {
    if (t) await t.sendMail({ from: FROM, to: m.to, subject: m.subject, text, html: layout(m.title, m.body, m.cta) });
    else console.log(`[mail:dev] to=${m.to} subject="${m.subject}"${m.cta ? ` link=${m.cta.url}` : ""}`);
  } catch (e) {
    ok = false;
    err = e instanceof Error ? e.message : String(e);
    console.error("[mail] илгээж чадсангүй:", err);
  }
  // Нэвтрэх холбоос (токен) outbox-д хадгалагдахгүй.
  await sys(
    "INSERT INTO notification_outbox (channel, recipient, template, payload, state, attempts, last_error, sent_at) VALUES ('email',$1,$2,$3,$4,1,$5,$6)",
    [m.to, m.template, JSON.stringify({ subject: m.subject }), ok ? "sent" : "failed", err, ok ? new Date() : null],
  ).catch(() => {});
  return ok;
}

export { esc as escHtml };
