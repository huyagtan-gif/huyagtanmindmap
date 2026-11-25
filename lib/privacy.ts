import type { Q } from "./db";
import { sys } from "./db";

/** P2.8: хүний өөрийн бүх өгөгдөл (татаж авах хуулбар). Зөвхөн өөрийн person_id-аар дуудна. */
export async function exportOwnData(personId: string) {
  const one = async <T,>(sql: string) => (await sys<any>(sql, [personId]))[0] as T | undefined;
  const all = <T,>(sql: string) => sys<any>(sql, [personId]) as Promise<T[]>;
  const nm = "coalesce(left(o.father_name, 1) || '.', '') || o.given_name";
  return {
    exported_at: new Date().toISOString(),
    person: await one(
      `SELECT p.clan_name, p.father_name, p.given_name, p.ongod_nickname, p.ulaach_name, s.name AS status, k.name AS knowledge_level,
              p.field_training, p.sutra, p.info_source, p.comment, p.suggestion, p.huyag_today, p.form_completed_at, p.created_at, p.updated_at
       FROM person p LEFT JOIN status s ON s.id = p.status_id LEFT JOIN knowledge_level k ON k.id = p.knowledge_level_id WHERE p.id = $1`),
    contact: await one("SELECT phone, email, facebook, phone_verified, email_verified FROM person_private WHERE person_id = $1"),
    aliases: (await all<{ alias: string }>("SELECT alias FROM person_alias WHERE person_id = $1 ORDER BY alias")).map((a) => a.alias),
    memberships: await all("SELECT u.name AS urguu, r.name AS role, m.state, m.created_at, m.decided_at FROM membership m JOIN urguu u ON u.id = m.urguu_id LEFT JOIN role r ON r.id = m.role_id WHERE m.person_id = $1 ORDER BY m.created_at"),
    ongods: await all("SELECT u.name AS urguu, o.name, o.title, po.is_primary FROM person_ongod po JOIN ongod o ON o.id = po.ongod_id JOIN urguu u ON u.id = o.urguu_id WHERE po.person_id = $1 ORDER BY po.is_primary DESC, po.sort"),
    deedes: (await all<{ name: string }>("SELECT d.name FROM person_deedes pd JOIN deedes d ON d.id = pd.deedes_id WHERE pd.person_id = $1 ORDER BY d.name")).map((d) => d.name),
    huyag: await one("SELECT h.met_teacher_on, h.huyag_on, t.name AS huyag_type, h.note FROM huyag h LEFT JOIN huyag_type t ON t.id = h.huyag_type_id WHERE h.person_id = $1"),
    relations_from_me: await all(`SELECT t.name AS type, ${nm} AS person, r.note FROM relation r JOIN relation_type t ON t.id = r.type_id JOIN person o ON o.id = r.to_person_id WHERE r.from_person_id = $1 ORDER BY t.sort`),
    relations_to_me: await all(`SELECT t.name AS type, ${nm} AS person FROM relation r JOIN relation_type t ON t.id = r.type_id JOIN person o ON o.id = r.from_person_id WHERE r.to_person_id = $1 ORDER BY t.sort`),
    form_answers: await all("SELECT q.text AS question, a.value AS answer FROM form_answer a JOIN form_question q ON q.id = a.question_id WHERE a.person_id = $1 ORDER BY q.sort"),
    status_history: await all("SELECT os.name AS from_status, ns.name AS to_status, h.at FROM status_history h LEFT JOIN status os ON os.id = h.old_status_id LEFT JOIN status ns ON ns.id = h.new_status_id WHERE h.person_id = $1 ORDER BY h.at"),
    events: await all("SELECT e.name, e.starts_at, r.name AS role, ep.rsvp, ep.attended FROM event_participant ep JOIN event e ON e.id = ep.event_id LEFT JOIN event_role r ON r.id = ep.role_id WHERE ep.person_id = $1 ORDER BY e.starts_at"),
    trainings: await all(
      `SELECT t.name, tp.state, tp.source, tp.completion, tp.certificate_no, tp.pay_state, tp.created_at,
              (SELECT count(*)::int FROM training_attendance ta WHERE ta.training_id = t.id AND ta.person_id = tp.person_id) AS sessions_attended
       FROM training_participant tp JOIN training t ON t.id = tp.training_id WHERE tp.person_id = $1 ORDER BY tp.created_at`),
    training_surveys: await all("SELECT t.name, s.rating, s.comment, s.created_at FROM training_survey s JOIN training t ON t.id = s.training_id WHERE s.person_id = $1 ORDER BY s.created_at"),
    payments: await all("SELECT kind, amount, state, method, anonymous, message, sender_invoice_no, paid_at, refunded_at, created_at FROM payment WHERE payer_person_id = $1 ORDER BY created_at"),
    consents: await all("SELECT version, at FROM consent WHERE person_id = $1 ORDER BY at"),
    data_requests: await all("SELECT kind, state, note, created_at, decided_at FROM data_request WHERE person_id = $1 ORDER BY created_at"),
  };
}

/**
 * P2.8: хүний бүх өгөгдлийг платформоос бүрмөсөн устгана (системийн транзакц дотор дуудна).
 * Хүн, холбоо барих мэдээлэл, гишүүнчлэл, онгод/дээдсийн холбоос, харилцаа, формын хариулт, төлвийн түүх, нэвтрэх хэрэглэгч,
 * сешн, урилга, код, мэдэгдлийн бүртгэл, мөн өөрчлөлтийн түүх (audit_log) дахь энэ хүний хуулбарууд устна.
 * Буцаах утга: устгагдсан хүний имэйл (баталгаажуулах захидалд) эсвэл null.
 */
export async function erasePerson(q: Q, personId: string): Promise<{ email: string | null }> {
  // Энэ хүн рүү нэгтгэгдсэн (уусгасан) бүртгэлүүд ч мөн адил энэ хүнийх.
  const ids = [personId, ...(await q<{ id: string }>("SELECT id FROM person WHERE merged_into_id = $1", [personId])).map((r) => r.id)];
  const priv = await q<{ phone: string | null; email: string | null }>("SELECT phone, email FROM person_private WHERE person_id = ANY($1::uuid[])", [ids]);
  const emails = [...new Set(priv.map((p) => p.email?.toLowerCase()).filter(Boolean))] as string[];
  const phones = [...new Set(priv.map((p) => p.phone).filter(Boolean))] as string[];
  // Санхүүгийн бүртгэл (дүн, огноо) нягтлан бодох зорилгоор үлдэнэ, харин хүнтэй холбох мэдээлэл арилна.
  await q("UPDATE payment SET payer_name = NULL, message = NULL, anonymous = true WHERE payer_person_id = ANY($1::uuid[])", [ids]);
  const users = await q<{ email: string | null }>("DELETE FROM users WHERE person_id = ANY($1::uuid[]) RETURNING email", [ids]); // sessions, accounts дагаж устна
  for (const u of users) if (u.email && !emails.includes(u.email.toLowerCase())) emails.push(u.email.toLowerCase());
  await q("DELETE FROM verification_token WHERE lower(identifier) = ANY($1)", [emails]);
  await q("DELETE FROM invite WHERE lower(email) = ANY($1)", [emails]);
  await q("DELETE FROM phone_otp WHERE person_id = ANY($1::uuid[]) OR phone = ANY($2)", [ids, phones]);
  await q("DELETE FROM notification_outbox WHERE lower(recipient) = ANY($1) OR recipient = ANY($2)", [emails, phones]);
  await q("DELETE FROM person WHERE id = ANY($1::uuid[])", [ids]);
  // Дээрх устгалууд audit trigger-ээр "өмнөх утга"-тайгаа бүртгэгдсэн. Тэдгээрийг болон өмнөх бүх хуулбарыг арилгана.
  const t = ids as unknown as string[];
  await q(
    `DELETE FROM audit_log WHERE entity_id = ANY($1)
       OR coalesce(before, after)->>'person_id' = ANY($1) OR coalesce(before, after)->>'from_person_id' = ANY($1) OR coalesce(before, after)->>'to_person_id' = ANY($1)
       OR (entity = 'invite' AND lower(coalesce(before, after)->>'email') = ANY($2))
       OR (entity = 'payment' AND (before->>'payer_person_id' = ANY($1) OR after->>'payer_person_id' = ANY($1)))`,
    [t, emails],
  );
  await q("UPDATE audit_log SET actor_person_id = NULL WHERE actor_person_id = ANY($1::uuid[])", [ids]);
  // Бусад мөрийн хуулбарт үлдсэн энэ хүний id (баталсан / үүсгэсэн хүн гэх мэт)-г null болгоно.
  for (const id of ids)
    await q(
      `UPDATE audit_log SET before = replace(before::text, $2, 'null')::jsonb, after = replace(after::text, $2, 'null')::jsonb
       WHERE before::text LIKE $1 OR after::text LIKE $1`,
      [`%${id}%`, `"${id}"`],
    );
  await q("INSERT INTO audit_log (actor_user_id, actor_person_id, urguu_id, entity, action) VALUES (nullif(current_setting('app.user_id', true), '')::int, app_person(), app_urguu(), 'person', 'erase')");
  return { email: emails[0] ?? null };
}
