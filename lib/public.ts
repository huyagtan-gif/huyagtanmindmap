import { hashToken, newToken } from "./codes";
import type { Q } from "./db";
import { capFirst, normPerson } from "./norm";
import { joinTraining, syncFieldTraining, type JoinResult } from "./training";

// Phase 3: нэвтрэлтгүй (нийтийн) урсгалуудын цөм логик: зочны бүртгэл (P3.4), QR ирц (P3.5).
// Бүгд системийн транзакц (sysTx) дотор дуудагдана: дуудагч тал эрх, captcha, rate limit-ийг шалгасан байна.

export const CONSENT_VERSION = "2026-11";
export type GuestInput = { father: string | null; given: string; phone: string; email: string | null; phoneVerified: boolean };
export type PublicTraining = { id: string; urguu_id: string; name: string; state: string; scope: string; reg_mode: string; fee: number; capacity: number | null; public_code: string };

/**
 * Зочныг хүн болгон олно эсвэл үүсгэнэ (D30: зочин = person(is_registered=false)).
 * Утас баталгаажсан бол тэр дугаарын эзэн (гишүүн ч байж болно) руу холбоно: давхардал үүсэхгүй.
 * Баталгаажаагүй бол зөвхөн ижил нэртэй өмнөх ЗОЧИНТОЙ нэгтгэнэ: бусдын дугаарыг бичээд гишүүний нэр дээр бүртгүүлэхээс сэргийлнэ.
 */
export async function resolveGuest(q: Q, leadUrguuId: string, g: GuestInput): Promise<{ personId: string; created: boolean }> {
  const holders = await q<{ person_id: string; phone_verified: boolean; is_registered: boolean; given_name: string }>(
    `SELECT pp.person_id, pp.phone_verified, p.is_registered, p.given_name FROM person_private pp JOIN person p ON p.id = pp.person_id
     WHERE pp.phone = $1 AND p.merged_into_id IS NULL ORDER BY pp.phone_verified DESC, p.created_at`, [g.phone]);
  const same = (h: { given_name: string }) => normPerson(h.given_name) === normPerson(g.given);
  const hit = g.phoneVerified
    ? holders.find((h) => h.phone_verified) || (holders.length === 1 ? holders[0] : holders.find(same))
    : holders.find((h) => !h.is_registered && same(h));
  if (hit) {
    if (g.phoneVerified && !hit.phone_verified) await q("UPDATE person_private SET phone_verified = true WHERE person_id = $1", [hit.person_id]);
    return { personId: hit.person_id, created: false };
  }
  const [p] = await q<{ id: string }>(
    "INSERT INTO person (father_name, given_name, is_registered, created_urguu_id) VALUES ($1,$2,false,$3) RETURNING id",
    [g.father ? capFirst(g.father) : null, capFirst(g.given), leadUrguuId]);
  // Имэйл аль хэдийн өөр хүнд бүртгэлтэй бол (давхардахгүй индекс) зочны мөрөнд хадгалахгүй.
  const taken = g.email ? (await q("SELECT 1 FROM person_private WHERE lower(email) = lower($1)", [g.email])).length > 0 : true;
  await q("INSERT INTO person_private (person_id, phone, email, phone_verified) VALUES ($1,$2,$3,$4)", [p.id, g.phone, taken ? null : g.email, g.phoneVerified]);
  const full = [g.father, g.given].filter(Boolean).join(" ");
  for (const a of new Set([g.given, full])) {
    const n = normPerson(a);
    if (n) await q("INSERT INTO person_alias (person_id, alias, norm) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [p.id, a, n]);
  }
  await q("INSERT INTO consent (person_id, version) VALUES ($1,$2)", [p.id, CONSENT_VERSION]);
  return { personId: p.id, created: true };
}

/** P3.4: нийтийн хуудаснаас бүртгүүлнэ. Зочны «миний бүртгэл» холбоосын токеныг буцаана (DB-д зөвхөн hash). */
export async function registerPublic(q: Q, t: PublicTraining, g: GuestInput): Promise<JoinResult & { personId: string; token: string }> {
  const { personId } = await resolveGuest(q, t.urguu_id, g);
  const r = await joinTraining(q, { trainingId: t.id, personId, source: "public" });
  const { token, hash } = newToken();
  await q("UPDATE training_participant SET access_hash = $2 WHERE id = $1", [r.participantId, hash]);
  return { ...r, personId, token };
}

export type GuestPart = { id: string; training_id: string; person_id: string; state: string; pay_state: string; completion: string | null; certificate_code: string | null; father_name: string | null; given_name: string };
/** Зочны холбоосын токеноор оролцооны мөрийг олно. */
export async function participantByToken(q: Q, code: string, token: string): Promise<GuestPart | null> {
  if (!/^[\w-]{20,64}$/.test(token)) return null;
  const [r] = await q<GuestPart>(
    `SELECT tp.id, tp.training_id, tp.person_id, tp.state, tp.pay_state, tp.completion, tp.certificate_code, p.father_name, p.given_name
     FROM training_participant tp JOIN training t ON t.id = tp.training_id JOIN person p ON p.id = tp.person_id
     WHERE tp.access_hash = $1 AND t.public_code = $2`, [hashToken(token), code]);
  return r || null;
}

/** P3.5: ирц тэмдэглэнэ (давхар уншуулахад нэг л мөр). Шинээр тэмдэглэсэн бол true. */
export async function markAttendance(q: Q, o: { trainingId: string; sessionId: string; personId: string; method: "qr" | "manual"; markedBy?: string | null }): Promise<boolean> {
  const r = await q(
    `INSERT INTO training_attendance (session_id, training_id, person_id, method, marked_by)
     SELECT s.id, s.training_id, $3, $4, $5 FROM training_session s WHERE s.id = $2 AND s.training_id = $1
     ON CONFLICT (session_id, person_id) DO NOTHING RETURNING 1`, [o.trainingId, o.sessionId, o.personId, o.method, o.markedBy ?? null]);
  return r.length > 0;
}

/**
 * P3.5: QR уншуулсан хүнийг ирцэд оруулна. Жагсаалтад байхгүй бол (биеэр ирсэн тул) хязгаар харгалзахгүй оролцогч болгоно.
 * allowNew=false үед жагсаалтад байхгүй хүнийг оруулахгүй: "not_listed".
 */
export async function checkIn(q: Q, o: { trainingId: string; sessionId: string; personId: string; allowNew: boolean }): Promise<"ok" | "already" | "not_listed"> {
  const [ex] = await q<{ state: string }>("SELECT state FROM training_participant WHERE training_id = $1 AND person_id = $2", [o.trainingId, o.personId]);
  if (!ex && !o.allowNew) return "not_listed";
  if (!ex || ex.state !== "yes") await joinTraining(q, { trainingId: o.trainingId, personId: o.personId, source: "qr", ignoreCapacity: true });
  const fresh = await markAttendance(q, { trainingId: o.trainingId, sessionId: o.sessionId, personId: o.personId, method: "qr" });
  return fresh ? "ok" : "already";
}

/** Утасны дугаараар энэ сургалтын оролцогчийг олно (зочны QR ирц). Олон хүн таарвал баталгаажсан дугаартайг нь. */
export async function participantByPhone(q: Q, trainingId: string, phone: string): Promise<{ person_id: string; given_name: string } | null> {
  const [r] = await q<{ person_id: string; given_name: string }>(
    `SELECT tp.person_id, p.given_name FROM training_participant tp JOIN person_private pp ON pp.person_id = tp.person_id JOIN person p ON p.id = tp.person_id
     WHERE tp.training_id = $1 AND pp.phone = $2 AND tp.state <> 'cancelled' ORDER BY pp.phone_verified DESC, tp.created_at LIMIT 1`, [trainingId, phone]);
  return r || null;
}

export { syncFieldTraining };
