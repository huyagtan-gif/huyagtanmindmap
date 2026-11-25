import { sys } from "./db";
import { SITE_URL, escHtml } from "./mail";
import { notifyPerson } from "./notify";
import { fmtDay, fmtRange } from "./time";

/**
 * P3.9: сануулга. Эхлэхээс 24 цагийн өмнө (ажилчин 10 минут тутам шалгана) үйлийн оролцогчид ба сургалтын хичээлийн
 * бүртгэлтэй оролцогчдод нэг удаа мэдэгдэнэ: имэйлтэй бол имэйл, үгүй бол (гарц тохируулсан үед) SMS, мөн push.
 * reminded_at-ыг эхлээд тэмдэглэдэг тул ажилчин давхар ажилласан ч нэг л удаа илгээгдэнэ.
 */
export async function sendReminders(): Promise<number> {
  let n = 0;
  const evs = await sys<{ id: string; urguu_id: string; name: string; starts_at: Date; ends_at: Date | null; place: string | null }>(
    `UPDATE event SET reminded_at = now() WHERE state = 'planned' AND reminded_at IS NULL AND starts_at > now() AND starts_at <= now() + interval '24 hours'
     RETURNING id, urguu_id, name, starts_at, ends_at, place`);
  for (const e of evs) {
    const when = `${fmtDay(e.starts_at)} ${fmtRange(e.starts_at, e.ends_at).slice(11)}`;
    const parts = await sys<{ person_id: string }>("SELECT person_id FROM event_participant WHERE event_id = $1 AND rsvp IN ('yes','maybe','invited')", [e.id]);
    for (const p of parts) {
      await notifyPerson(p.person_id, {
        template: "event_reminder", urguuId: e.urguu_id, subject: `Хуягтан: «${e.name}» маргааш`, title: "Үйл ажиллагааны сануулга",
        body: `<b>${escHtml(e.name)}</b> ${escHtml(when)}-д болно.${e.place ? ` Байршил: ${escHtml(e.place)}.` : ""}`,
        cta: { label: "Дэлгэрэнгүй", url: `${SITE_URL}/events/${e.id}` }, sms: `Хуягтан: «${e.name}» ${when}.${e.place ? ` ${e.place}.` : ""}`,
      });
      n++;
    }
  }
  const ss = await sys<{ id: string; training_id: string; title: string | null; starts_at: Date; ends_at: Date | null; place: string | null; name: string; urguu_id: string; scope: string; public_code: string }>(
    `UPDATE training_session s SET reminded_at = now() FROM training t
     WHERE t.id = s.training_id AND t.state IN ('open','closed') AND s.reminded_at IS NULL AND s.starts_at > now() AND s.starts_at <= now() + interval '24 hours'
     RETURNING s.id, s.training_id, s.title, s.starts_at, s.ends_at, coalesce(s.place, t.place) AS place, t.name, t.urguu_id, t.scope, t.public_code`);
  for (const s of ss) {
    const when = `${fmtDay(s.starts_at)} ${fmtRange(s.starts_at, s.ends_at).slice(11)}`;
    const parts = await sys<{ person_id: string; has_user: boolean }>(
      `SELECT tp.person_id, EXISTS (SELECT 1 FROM users u WHERE u.person_id = tp.person_id) AS has_user FROM training_participant tp WHERE tp.training_id = $1 AND tp.state = 'yes'`, [s.training_id]);
    for (const p of parts) {
      // Зочин нэвтэрдэггүй: гишүүний хуудас биш, нийтийн хуудас руу (байвал) заана.
      const url = p.has_user ? `${SITE_URL}/trainings/${s.training_id}` : s.scope === "public" ? `${SITE_URL}/t/${s.public_code}` : null;
      await notifyPerson(p.person_id, {
        template: "training_reminder", urguuId: s.urguu_id, subject: `Хуягтан: «${s.name}» сургалтын хичээл маргааш`, title: "Сургалтын сануулга",
        body: `<b>${escHtml(s.name)}</b>${s.title ? ` (${escHtml(s.title)})` : ""} хичээл ${escHtml(when)}-д болно.${s.place ? ` Байршил: ${escHtml(s.place)}.` : ""}`,
        cta: url ? { label: "Дэлгэрэнгүй", url } : undefined, sms: `Хуягтан: «${s.name}» хичээл ${when}.${s.place ? ` ${s.place}.` : ""}`,
      });
      n++;
    }
  }
  return n;
}
