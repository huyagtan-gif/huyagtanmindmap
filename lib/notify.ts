import { sys } from "./db";
import { SITE_URL, escHtml, sendMail, type MailContent } from "./mail";
import { sendSms, smsMode } from "./sms";

export type Notice = MailContent & { template: string; urguuId?: string | null; /** Имэйлгүй хүнд илгээх богино SMS (заавал биш) */ sms?: string };

/**
 * Хүнд мэдэгдэл илгээнэ: имэйлтэй бол имэйлээр, үгүй бол (SMS гарц тохируулсан, sms текст өгсөн үед) SMS-ээр.
 * Хүлээн авагчийн хаягийг зөвхөн энд, системийн холболтоор уншина: дуудагч тал руу буцаахгүй.
 */
export async function notifyPerson(personId: string, n: Notice): Promise<"email" | "sms" | "none"> {
  try {
    const [pp] = await sys<{ email: string | null; phone: string | null }>(
      "SELECT pp.email, pp.phone FROM person_private pp JOIN person p ON p.id = pp.person_id WHERE pp.person_id = $1 AND p.merged_into_id IS NULL", [personId]);
    void (await import("./push")).pushTo(personId, { title: n.title, body: n.body.replace(/<[^>]+>/g, ""), url: n.cta?.url || null }).catch(() => {});
    if (pp?.email) {
      await sendMail({ to: pp.email, subject: n.subject, title: n.title, body: n.body, cta: n.cta, template: n.template, urguuId: n.urguuId });
      return "email";
    }
    if (pp?.phone && n.sms && smsMode() !== "off") {
      await sendSms(pp.phone, n.sms.slice(0, 300), n.template, { urguuId: n.urguuId });
      return "sms";
    }
  } catch (e) {
    console.error("[notify]", e instanceof Error ? e.message : e);
  }
  return "none";
}

/** Хүлээлгээс дэвшсэн хүмүүст мэдэгдэнэ (P3.3). */
export async function notifyPromoted(t: { id: string; name: string; urguu_id: string; fee: number }, personIds: string[]) {
  for (const pid of personIds)
    await notifyPerson(pid, {
      template: "training_promoted", urguuId: t.urguu_id, subject: "Хуягтан: суудал суллагдлаа", title: "Суудал суллагдлаа",
      body: `<b>${escHtml(t.name)}</b> сургалтад суудал суллагдаж, та хүлээлгийн жагсаалтаас оролцогч боллоо.${t.fee > 0 ? " Төлбөрөө төлж бүртгэлээ баталгаажуулна уу." : ""}`,
      cta: { label: "Сургалтыг харах", url: `${SITE_URL}/trainings/${t.id}` }, sms: `Хуягтан: «${t.name}» сургалтад суудал суллагдлаа. Та оролцогч боллоо.`,
    });
}
