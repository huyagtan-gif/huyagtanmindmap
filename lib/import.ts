import { createHash } from "node:crypto";
import type { Q } from "./db";
import { parseCsv } from "./csv";
import { capFirst, capWords, normOngod, normPerson, normPhone, parseUsDate, similar } from "./norm";
import { findOrCreateNamed, syncOwnAlias } from "./people-write";

// Google Sheet "Form Responses 1"-ийн баганын дараалал (A–Y), шаардлага §11.1.
export const COLS = [
  "timestamp", "clan", "father", "given", "phone", "facebook", "nickname", "ongod", "era", "title", "ulaach", "met", "huyag",
  "huyagType", "introducer", "supporter", "today", "knowledge", "fieldTraining", "sutra", "info", "comment", "suggestion", "deedes", "email",
] as const;
export type ImportRow = Record<(typeof COLS)[number], string>;

/** CSV-ийг мөрүүд болгоно. Эхний мөр гарчиг бол алгасна. */
export function rowsFromCsv(text: string): ImportRow[] {
  const raw = parseCsv(text);
  if (raw.length && !/^\d{1,2}\/\d{1,2}\/\d{4}/.test((raw[0][0] || "").trim())) raw.shift();
  return raw
    .filter((r) => (r[3] || "").trim())
    .map((r) => Object.fromEntries(COLS.map((c, i) => [c, (r[i] || "").trim()])) as ImportRow);
}

const NONE = new Set(["", "-", "—", "байхгүй", "үгүй", "алга"]);
export const isNone = (s: string) => NONE.has(s.trim().toLowerCase());
/** "A, B" → ["A","B"]; хоосон/"-" утгыг хасна. */
export const splitNames = (s: string) => s.split(/[,;\n]+/).map((x) => x.trim()).filter((x) => !isNone(x));

export function mapEra(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes("хүннү")) return "Хүннү";
  if (s.includes("юань")) return "Их Юань";
  if (s.includes("их монгол")) return "Их Монгол";
  if (s.includes("бага")) return "Бага хаад";
  if (s.includes("эртний")) return "Эртний";
  return "Тодорхой бус";
}

export function parseTimestamp(raw: string): string | null {
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const p = (x: string | undefined) => (x || "0").padStart(2, "0");
  // Google Form-ын цаг Улаанбаатарын цагаар (+08:00)
  return `${m[3]}-${p(m[1])}-${p(m[2])}T${p(m[4])}:${p(m[5])}:${p(m[6])}+08:00`;
}

export type ImportResult = { batchId: string | null; duplicate: boolean; rows: number; created: number; updated: number; skipped: number; issues: number };

/**
 * P1.8: Google Sheet-ийн мөрүүдийг импортлоно. Идемпотент: ижил файл хоёр дахь удаа орохгүй (checksum),
 * мөр бүр имэйл/утас/нэрээр өмнөх бүртгэлтэй тулгагдаж давхардахгүй. Эргэлзээтэй зүйл бүр import_issue болно.
 * `q` нь өргөөний контексттой (app.urguu_id тохируулсан) транзакц байх ёстой.
 */
export async function runImport(q: Q, urguuId: string, actorPersonId: string | null, text: string, source: string): Promise<ImportResult> {
  const checksum = createHash("sha256").update(text).digest("hex");
  const [dup] = await q("SELECT id FROM import_batch WHERE checksum = $1 AND urguu_id = $2", [checksum, urguuId]);
  const rows = rowsFromCsv(text);
  const res: ImportResult = { batchId: null, duplicate: !!dup, rows: rows.length, created: 0, updated: 0, skipped: 0, issues: 0 };
  if (dup || !rows.length) return res;

  const [batch] = await q<{ id: string }>(
    "INSERT INTO import_batch (urguu_id, source, checksum, row_count, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id",
    [urguuId, source.slice(0, 200), checksum, rows.length, actorPersonId],
  );
  res.batchId = batch.id;
  const issue = async (personId: string | null, kind: string, message: string, data: unknown = {}) => {
    await q("INSERT INTO import_issue (batch_id, urguu_id, person_id, kind, message, data) VALUES ($1,$2,$3,$4,$5,$6)", [batch.id, urguuId, personId, kind, message, JSON.stringify(data)]);
    res.issues++;
  };

  const statuses = await q<{ id: string; name: string; sort: number }>("SELECT id, name, sort FROM status ORDER BY sort");
  const stByName = (n: string) => statuses.find((s) => s.name === n)?.id;
  const stHuyag = stByName("Хуягласан") ?? statuses[statuses.length - 1]?.id ?? null;
  const stTodloh = stByName("Тодлох") ?? stHuyag;
  const knowledge = await q<{ id: string; name: string }>("SELECT id, name FROM knowledge_level");
  const htypes = await q<{ id: string; name: string }>("SELECT id, name FROM huyag_type");
  const eras = await q<{ id: string; name: string }>("SELECT id, name FROM era");
  const deedesList = await q<{ id: string; name: string }>("SELECT id, name FROM deedes");
  const ongods = await q<{ id: string; name: string; title: string | null }>("SELECT id, name, title FROM ongod WHERE kind = 'ongod'");
  const relTypes = Object.fromEntries((await q<{ id: string; key: string }>("SELECT id, key FROM relation_type WHERE key IS NOT NULL")).map((r) => [r.key, r.id]));
  const [memberRole] = await q<{ id: string }>("SELECT id FROM role WHERE urguu_id = $1 AND NOT is_system ORDER BY sort DESC LIMIT 1", [urguuId]);
  const today = new Date().toISOString().slice(0, 10);
  const lcEq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

  const done: { id: string; row: ImportRow; label: string }[] = [];

  for (const r of rows) {
    const given = capFirst(r.given);
    const father = capFirst(r.father) || null;
    const label = (father ? father[0] + "." : "") + given;
    const email = r.email.replace(/\s+/g, "").toLowerCase() || null;
    const phone = normPhone(r.phone);

    // --- өмнөх бүртгэлтэй тулгах: имэйл → утас → нэр ---
    let personId: string | null = null;
    if (email) personId = (await q<{ person_id: string }>("SELECT person_id FROM person_private WHERE lower(email) = $1", [email]))[0]?.person_id ?? null;
    if (!personId && phone.value && phone.ok)
      personId = (await q<{ person_id: string }>("SELECT person_id FROM person_private WHERE phone = $1", [phone.value]))[0]?.person_id ?? null;
    if (!personId) {
      const want = normPerson(`${father || ""} ${given}`);
      const cands = await q<{ id: string; father_name: string | null; given_name: string }>("SELECT id, father_name, given_name FROM person WHERE merged_into_id IS NULL");
      const hits = cands.filter((c) => normPerson(`${c.father_name || ""} ${c.given_name}`) === want);
      if (hits.length === 1) personId = hits[0].id;
    }
    if (personId) {
      const [ex] = await q<{ is_registered: boolean; form_completed_at: Date | null; has_ongod: boolean }>(
        "SELECT is_registered, form_completed_at, EXISTS (SELECT 1 FROM person_ongod po WHERE po.person_id = p.id) AS has_ongod FROM person p WHERE id = $1", [personId]);
      if (ex && ex.is_registered && (ex.form_completed_at || ex.has_ongod)) {
        res.skipped++; // аль хэдийн бүртгэл нь бөглөгдсөн — дарж бичихгүй
        continue;
      }
    }

    // --- төлөв ---
    const hOn = parseUsDate(r.huyag);
    const mOn = parseUsDate(r.met);
    let statusId = stHuyag;
    if (!r.today) {
      statusId = hOn && hOn <= today ? stHuyag : stTodloh;
    }
    const kn = knowledge.find((k) => lcEq(k.name, r.knowledge))?.id ?? knowledge.find((k) => r.knowledge && k.name.toLowerCase().startsWith(r.knowledge.toLowerCase().slice(0, 12)))?.id ?? null;
    const yn = (s: string) => (lcEq(s, "Тийм") ? true : lcEq(s, "Үгүй") ? false : null);
    const ts = parseTimestamp(r.timestamp);
    const vals = [
      capWords(r.clan) || null, father, given, r.nickname || null, isNone(r.ulaach) ? null : r.ulaach, statusId, kn,
      yn(r.fieldTraining), yn(r.sutra), r.info || null, r.comment || null, r.suggestion || null, r.today || null,
    ];
    if (personId) {
      await q(
        `UPDATE person SET clan_name=$2, father_name=$3, given_name=$4, ongod_nickname=$5, ulaach_name=$6, status_id=$7, knowledge_level_id=$8,
           field_training=$9, sutra=$10, info_source=$11, comment=$12, suggestion=$13, huyag_today=$14, is_registered=true,
           form_completed_at=coalesce($15::timestamptz, now()) WHERE id=$1`,
        [personId, ...vals, ts],
      );
      res.updated++;
    } else {
      const [p] = await q<{ id: string }>(
        `INSERT INTO person (clan_name, father_name, given_name, ongod_nickname, ulaach_name, status_id, knowledge_level_id, field_training, sutra,
           info_source, comment, suggestion, huyag_today, is_registered, created_urguu_id, form_completed_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,$14,coalesce($15::timestamptz, now()),coalesce($15::timestamptz, now())) RETURNING id`,
        [...vals, urguuId, ts],
      );
      personId = p.id;
      res.created++;
    }
    await syncOwnAlias(q, personId, father, given);
    if (r.today === "" ) await issue(personId, "status_guess", `${label}: «Өнөөдөр хуяглаж байна уу» хоосон тул төлөвийг огнооноос таамаглав. Шалгана уу.`);

    // --- хувийн мэдээлэл ---
    await q(
      `INSERT INTO person_private (person_id, phone, email, facebook) VALUES ($1,$2,$3,$4)
       ON CONFLICT (person_id) DO UPDATE SET phone = coalesce(EXCLUDED.phone, person_private.phone), email = coalesce(person_private.email, EXCLUDED.email), facebook = coalesce(EXCLUDED.facebook, person_private.facebook)`,
      [personId, phone.value || null, email, r.facebook || null],
    );
    if (!phone.ok) await issue(personId, "phone_format", `${label}: утасны дугаар стандарт бус (8 оронтой биш). Улсын кодыг гараар засна уу.`, { field: "phone" });
    if (r.facebook && !/^https?:\/\//i.test(r.facebook)) await issue(personId, "facebook_not_url", `${label}: фэйсбүүк хаяг холбоос биш, бичвэрээр хадгаллаа.`, { field: "facebook" });

    await q(
      `INSERT INTO membership (person_id, urguu_id, role_id, state, decided_by, decided_at) VALUES ($1,$2,$3,'approved',$4,now())
       ON CONFLICT (person_id, urguu_id) DO NOTHING`,
      [personId, urguuId, memberRole?.id ?? null, actorPersonId],
    );

    // --- дээдэс ---
    let note: string | null = null;
    for (const dn of r.deedes ? [r.deedes] : []) {
      const d = deedesList.find((x) => normOngod(x.name) === normOngod(dn));
      if (d) await q("INSERT INTO person_deedes (person_id, deedes_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [personId, d.id]);
      else note = dn; // жагсаалтад таарахгүй бичвэр (жишээ: "Эхээс төрөхдөө хуяглагдсан") → тэмдэглэл
    }

    // --- хуяг, огнооны шалгалт (§11.4) ---
    const ht = htypes.find((t) => r.huyagType && (lcEq(t.name, r.huyagType) || t.name.toLowerCase().startsWith(r.huyagType.toLowerCase().split(" ")[0])))?.id ?? null;
    if (lcEq(r.supporter, "Ганцаараа байсан")) note = [note, "Түшсэн: ганцаараа байсан"].filter(Boolean).join(". ");
    await q(
      `INSERT INTO huyag (person_id, met_teacher_on, huyag_on, huyag_type_id, note) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (person_id) DO UPDATE SET met_teacher_on = EXCLUDED.met_teacher_on, huyag_on = EXCLUDED.huyag_on, huyag_type_id = EXCLUDED.huyag_type_id, note = EXCLUDED.note`,
      [personId, mOn, hOn, ht, note],
    );
    if ((r.met && !mOn) || (r.huyag && !hOn)) await issue(personId, "date_warning", `${label}: огноог уншиж чадсангүй («${r.met}» / «${r.huyag}»).`);
    if (mOn && hOn && hOn < mOn) await issue(personId, "date_warning", `${label}: хуяглуулсан огноо (${hOn}) багштай золгосон огнооноос (${mOn}) өмнө байна.`);
    if (hOn && hOn > today) await issue(personId, "date_warning", `${label}: хуяглуулсан огноо (${hOn}) ирээдүйд байна.`);
    if (mOn && mOn > today) await issue(personId, "date_warning", `${label}: багштай золгосон огноо (${mOn}) ирээдүйд байна.`);

    // --- онгод: модтой тулгах (§11.2) ---
    if (r.ongod) {
      const key = normOngod(r.ongod);
      const hits = ongods.filter((o) => normOngod(o.name) === key);
      let ongodId: string;
      if (hits.length === 1) {
        ongodId = hits[0].id;
        if (r.title && !hits[0].title) {
          await q("UPDATE ongod SET title = $2 WHERE id = $1", [ongodId, r.title]);
          hits[0].title = r.title;
        }
      } else {
        const eraId = eras.find((e) => e.name === mapEra(r.era))?.id ?? null;
        const [o] = await q<{ id: string }>(
          "INSERT INTO ongod (urguu_id, name, era_id, title, kind, needs_review, sort) VALUES ($1,$2,$3,$4,'ongod',true,9999) RETURNING id",
          [urguuId, r.ongod, eraId, r.title || null],
        );
        ongodId = o.id;
        ongods.push({ id: o.id, name: r.ongod, title: r.title || null });
        await issue(personId, "ongod_unmatched", `${label}: «${r.ongod}» онгод модонд ${hits.length ? "олон таарлаа" : "олдсонгүй"}. Модноос сонгох эсвэл шинэ зангилаа болгон үлдээнэ үү.`, { ongod_id: o.id, raw: r.ongod });
      }
      await q("INSERT INTO person_ongod (person_id, ongod_id, is_primary, sort) VALUES ($1,$2,true,0) ON CONFLICT DO NOTHING", [personId, ongodId]);
    }
    done.push({ id: personId, row: r, label });
  }

  // --- хүн хоорондын холбоо: бүх хүн үүссэний дараа (§11.3) ---
  const createdNamed = new Set<string>();
  const link = async (from: string, to: string, key: string) =>
    q("INSERT INTO relation (from_person_id, to_person_id, type_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [from, to, relTypes[key]]);
  for (const d of done) {
    for (const [col, key] of [["introducer", "introducer"], ["supporter", "supporter"]] as const) {
      for (const nm of splitNames(d.row[col])) {
        if (lcEq(nm, "Ганцаараа байсан")) continue;
        const f = await findOrCreateNamed(q, urguuId, nm);
        if (!f) continue;
        if (f.id === d.id) {
          await issue(d.id, "self_reference", `${d.label}: «${col === "introducer" ? "Танилцуулсан" : "Түшсэн"}» хүнээр өөрийгөө («${nm}») заасан байна. Холбоос үүсгээгүй.`);
          continue;
        }
        if (f.created) createdNamed.add(f.id);
        await link(d.id, f.id, key);
      }
    }
  }
  for (const d of done)
    for (const nm of splitNames(d.row.info)) {
      const f = await findOrCreateNamed(q, urguuId, nm, { createIfMissing: false });
      if (f && f.id !== d.id) await link(d.id, f.id, "informant");
    }

  // --- нэр нэгтгэх санал: шинээр үүссэн "бүртгэлгүй" хүмүүсийг бусадтай харьцуулна ---
  if (createdNamed.size) {
    const all = await q<{ id: string; father_name: string | null; given_name: string; is_registered: boolean }>(
      "SELECT id, father_name, given_name, is_registered FROM person WHERE merged_into_id IS NULL");
    const nm = (p: { father_name: string | null; given_name: string }) => (p.father_name ? p.father_name[0] + "." : "") + p.given_name;
    const seen = new Set<string>();
    for (const a of all.filter((x) => createdNamed.has(x.id))) {
      const na = normPerson(a.given_name);
      for (const b of all) {
        if (a.id === b.id) continue;
        const nb = normPerson(b.given_name);
        if (!similar(na, nb)) continue;
        // into: бүртгэлтэй нь, эсвэл урт нэртэй нь
        const [from, into] = b.is_registered || (!createdNamed.has(b.id) ? true : nb.length >= na.length) ? [a, b] : [b, a];
        const k = [from.id, into.id].sort().join(":");
        if (seen.has(k)) continue;
        seen.add(k);
        await issue(from.id, "person_merge_suggest", `«${nm(from)}» ба «${nm(into)}» нэг хүн байж магадгүй. Нэгтгэх үү?`, { from_id: from.id, into_id: into.id });
      }
    }
  }
  await q("UPDATE import_batch SET created_count = $2 WHERE id = $1", [batch.id, res.created]);
  return res;
}
