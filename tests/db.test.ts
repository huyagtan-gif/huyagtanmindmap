import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Өгөгдлийн сантай интеграцийн тест. TEST_DATABASE_URL (ХООСОН сан) өгөгдсөн үед л ажиллана:
//   TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/huyagtan_test npm test
// Зөвхөн зохиомол өгөгдөл ашиглана.
const URL = process.env.TEST_DATABASE_URL;
const d = URL ? describe : describe.skip;

d("өгөгдлийн сан: миграци, RLS, audit, импорт", () => {
  let db: typeof import("@/lib/db");
  let A: string, B: string, admin: string, personB: string, ongodB: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    execFileSync("node", ["scripts/migrate.mjs"], { env: { ...process.env, DATABASE_URL: URL }, stdio: "pipe" });
    db = await import("@/lib/db");
    [{ id: A }] = await db.sys("SELECT id FROM urguu ORDER BY created_at LIMIT 1");
    [{ id: B }] = await db.sys("INSERT INTO urguu (name) VALUES ('Хоёр дахь өргөө') RETURNING id");
    [{ id: admin }] = await db.sys("INSERT INTO person (given_name, created_urguu_id) VALUES ('Админ', $1) RETURNING id", [A]);
    await db.sys("INSERT INTO membership (person_id, urguu_id, role_id, state) SELECT $1, $2, id, 'approved' FROM role WHERE urguu_id = $2 AND is_system", [admin, A]);
    [{ id: personB }] = await db.sys("INSERT INTO person (given_name, created_urguu_id) VALUES ('Бусдын-хүн', $1) RETURNING id", [B]);
    await db.sys("INSERT INTO person_private (person_id, phone, email) VALUES ($1, '+97611110000', 'b-secret@example.com')", [personB]);
    [{ id: ongodB }] = await db.sys("INSERT INTO ongod (urguu_id, name) VALUES ($1, 'Бусдын-онгод') RETURNING id", [B]);
  });
  afterAll(async () => { await db?.pool.end(); });

  it("миграци цэвэр сан дээр ажиллаж, seed орсон (P1.2)", async () => {
    const [c] = await db.sys("SELECT (SELECT count(*) FROM status)::int AS st, (SELECT count(*) FROM role)::int AS roles, (SELECT count(*) FROM ongod WHERE urguu_id = $1)::int AS ongod, (SELECT count(*) FROM era)::int AS era", [A]);
    expect(c).toMatchObject({ st: 4, roles: 4, era: 6 });
    expect(c.ongod).toBeGreaterThan(30);
  });

  it("RLS: нэг өргөөний хүсэлт өөр өргөөний мөрийг харахгүй, бичихгүй (A2)", async () => {
    await db.withCtx({ personId: admin, urguuId: A }, async (q) => {
      expect(await q("SELECT 1 FROM ongod WHERE id = $1", [ongodB])).toHaveLength(0);
      expect(await q("SELECT 1 FROM person WHERE id = $1", [personB])).toHaveLength(0);
      expect(await q("SELECT 1 FROM person_private WHERE person_id = $1", [personB])).toHaveLength(0);
      expect((await q("SELECT count(*)::int AS n FROM ongod"))[0].n).toBeGreaterThan(30);
      expect(await q("SELECT 1 FROM urguu")).toHaveLength(1);
      expect(await q("UPDATE ongod SET name = 'x' WHERE id = $1 RETURNING id", [ongodB])).toHaveLength(0);
    });
    await expect(db.withCtx({ personId: admin, urguuId: A }, (q) => q("INSERT INTO ongod (urguu_id, name) VALUES ($1, 'халдлага')", [B]))).rejects.toThrow(/row-level security/);
    // контекстгүй бол юу ч харагдахгүй
    await db.withCtx({}, async (q) => {
      expect(await q("SELECT 1 FROM ongod")).toHaveLength(0);
      expect(await q("SELECT 1 FROM person")).toHaveLength(0);
      expect(await q("SELECT 1 FROM person_private")).toHaveLength(0);
    });
  });

  it("апп-ын role нэвтрэлтийн хүснэгт уншихгүй, audit_log-ийг засахгүй", async () => {
    for (const sql of ["SELECT * FROM users", "SELECT * FROM sessions", "SELECT * FROM verification_token", "DELETE FROM audit_log", "UPDATE audit_log SET entity = 'x'", "DELETE FROM status_history"])
      await expect(db.withCtx({ personId: admin, urguuId: A }, (q) => q(sql))).rejects.toThrow(/permission denied/);
  });

  it("audit trigger ба төлвийн түүх (A4, P1.10)", async () => {
    const sts = await db.sys("SELECT id FROM status ORDER BY sort");
    const pid = await db.withCtx({ userId: 7, personId: admin, urguuId: A }, async (q) => {
      const [p] = await q("INSERT INTO person (given_name, status_id, created_urguu_id) VALUES ('Туршилт', $1, $2) RETURNING id", [sts[0].id, A]);
      await q("UPDATE person SET status_id = $2 WHERE id = $1", [p.id, sts[1].id]);
      return p.id;
    });
    const log = await db.sys("SELECT action, actor_person_id, actor_user_id, urguu_id, before, after FROM audit_log WHERE entity = 'person' AND entity_id = $1 ORDER BY id", [pid]);
    expect(log.map((l) => l.action)).toEqual(["insert", "update"]);
    expect(log[1]).toMatchObject({ actor_person_id: admin, actor_user_id: 7, urguu_id: A });
    expect(log[1].before.status_id).toBe(sts[0].id);
    expect(log[1].after.status_id).toBe(sts[1].id);
    const hist = await db.sys("SELECT old_status_id, new_status_id, changed_by FROM status_history WHERE person_id = $1 ORDER BY id", [pid]);
    expect(hist).toHaveLength(2);
    expect(hist[1]).toMatchObject({ old_status_id: sts[0].id, new_status_id: sts[1].id, changed_by: admin });
  });

  it("импорт: идемпотент, анхааруулга үүсгэнэ, гишүүний хариуд нууц талбар байхгүй (P1.8, P1.11)", async () => {
    const { runImport } = await import("@/lib/import");
    const { loadPeople } = await import("@/lib/data");
    const row = (o: Record<number, string>) => Array.from({ length: 25 }, (_, i) => `"${(o[i] || "").replace(/"/g, '""')}"`).join(",");
    const csv = [
      Array.from({ length: 25 }, (_, i) => `col${i}`).join(","),
      row({ 0: "11/18/2026 10:00:00", 1: "нэг овог", 2: "Дорж", 3: "Анхаа", 4: "99110001", 5: "https://facebook.com/x1", 7: "Хубилай Сэцэн Хаан Дээдэс", 8: "Их Юань гүрний үе", 9: "Хаан",
        11: "1/2/2024", 12: "3/4/2024", 13: "Биет хуяг", 14: "Б.Болд найз", 15: "Bold", 16: "Өмнө нь хуягласан", 17: "Олон жилийн туршлага мэдлэг, туршлагатай", 18: "Тийм", 19: "Үгүй", 20: "Болд багш, Подкастууд", 23: "Хөхүдэй Мөргүн Дээдэс", 24: " Anhaa@Example.com " }),
      row({ 0: "11/18/2026 11:00:00", 2: "Бат", 3: "Болд", 4: "08011112222", 5: "bold.fb", 7: "Огт байхгүй онгод", 8: "Хүннү гүрний үе", 11: "5/5/2026", 12: "1/1/1990", 14: "Б.Болд", 15: "Ганцаараа байсан", 16: "Өмнө нь хуягласан", 23: "Эхээс төрөхдөө хуяглагдсан", 24: "bold@example.com" }),
    ].join("\n");
    const ctx = { personId: admin, urguuId: A };
    const r1 = await db.withCtx(ctx, (q) => runImport(q, A, admin, csv, "test.csv"));
    expect(r1).toMatchObject({ rows: 2, created: 2, duplicate: false });
    const r2 = await db.withCtx(ctx, (q) => runImport(q, A, admin, csv, "test.csv"));
    expect(r2.duplicate).toBe(true);
    const r3 = await db.withCtx(ctx, (q) => runImport(q, A, admin, csv + "\n", "again.csv"));
    expect(r3).toMatchObject({ created: 0, skipped: 2 });

    const kinds = (await db.sys("SELECT kind FROM import_issue WHERE batch_id = $1", [r1.batchId])).map((x) => x.kind).sort();
    expect(kinds).toEqual(["date_warning", "facebook_not_url", "ongod_unmatched", "phone_format", "self_reference"]);

    const ppl = await db.sys("SELECT p.id, p.given_name, p.is_registered, pp.email, pp.phone, h.note FROM person p LEFT JOIN person_private pp ON pp.person_id = p.id LEFT JOIN huyag h ON h.person_id = p.id WHERE p.given_name IN ('Анхаа','Болд') ORDER BY p.given_name");
    // "Б.Болд найз", "Bold", "Болд багш" бүгд бүртгэлтэй Болд руу тулгагдана: давхар хүн үүсэхгүй.
    expect(ppl).toHaveLength(2);
    expect(ppl[0]).toMatchObject({ given_name: "Анхаа", email: "anhaa@example.com", phone: "+97699110001" });
    expect(ppl[1].note).toContain("Эхээс төрөхдөө хуяглагдсан");
    const rel = await db.sys("SELECT t.key FROM relation r JOIN relation_type t ON t.id = r.type_id WHERE r.from_person_id = $1 AND r.to_person_id = $2 ORDER BY t.key", [ppl[0].id, ppl[1].id]);
    expect(rel.map((x) => x.key)).toEqual(["informant", "introducer", "supporter"]);
    expect(await db.sys("SELECT 1 FROM person_ongod po JOIN ongod o ON o.id = po.ongod_id WHERE po.person_id = $1 AND o.name = 'Хубилай сэцэн хаан'", [ppl[0].id])).toHaveLength(1);

    // Гишүүний эрхээр ачаалсан жагсаалтыг бүхэлд нь JSON болгоход нууц утга нэг ч байхгүй.
    const member = { personId: "00000000-0000-0000-0000-000000000000", fields: new Set(["ulaach", "knowledge", "huyag_dates"]) };
    const list = await db.withCtx(ctx, (q) => loadPeople(q, member));
    const json = JSON.stringify(list);
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(json).not.toMatch(/example\.com|\+976|facebook\.com|bold\.fb|0801111/i);
    const adminList = await db.withCtx(ctx, (q) => loadPeople(q, { personId: admin, fields: new Set(["phone", "email", "facebook"]) }));
    expect(JSON.stringify(adminList)).toContain("anhaa@example.com");
  });

  /* ---------- Phase 2 ---------- */

  it("realtime: NOTIFY-д зөвхөн {entity, id, urguu_id} явна, өгөгдөл явахгүй (P2.1, A3)", async () => {
    const pg = await import("pg");
    const c = new pg.default.Client({ connectionString: URL });
    await c.connect();
    const got: any[] = [];
    c.on("notification", (m) => got.push(JSON.parse(m.payload || "{}")));
    await c.query("LISTEN huyagtan");
    const pid = await db.withCtx({ personId: admin, urguuId: A }, async (q) => {
      const [p] = await q("INSERT INTO person (given_name, created_urguu_id) VALUES ('Дохио-тест', $1) RETURNING id", [A]);
      await q("INSERT INTO person_private (person_id, phone, email) VALUES ($1, '+97688887777', 'signal-secret@example.com')", [p.id]);
      return p.id;
    });
    await db.sys("UPDATE ongod SET note = 'x' WHERE id = $1", [ongodB]);
    await new Promise((r) => setTimeout(r, 300));
    await c.end();
    const mine = got.filter((g) => g.id === pid);
    expect(mine.map((g) => g.entity).sort()).toEqual(["person", "person_private"]);
    for (const g of got) expect(Object.keys(g).sort()).toEqual(["entity", "id", "urguu_id"]);
    expect(mine.every((g) => g.urguu_id === A)).toBe(true);
    expect(got.find((g) => g.id === ongodB)).toMatchObject({ entity: "ongod", urguu_id: B });
    expect(JSON.stringify(got)).not.toMatch(/Дохио-тест|8888|signal-secret/);
  });

  it("харагдацын эрх: зургаан харагдац түвшин бүрт seed болсон (P2.2)", async () => {
    const rows = await db.sys("SELECT r.name, count(*)::int AS n FROM role r JOIN role_view rv ON rv.role_id = r.id WHERE r.urguu_id = $1 GROUP BY r.name", [A]);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.n === 6)).toBe(true);
  });

  it("outbox: амжилтгүй илгээлт дараалалд үлдэж дахин оролдогдоно, апп-ын role уншихгүй (P2.7)", async () => {
    const { sendMail } = await import("@/lib/mail");
    const { processOutbox, MAX_ATTEMPTS, backoffMinutes } = await import("@/lib/outbox");
    expect([1, 2, 3, 4, 5].map(backoffMinutes)).toEqual([1, 5, 30, 120, 120]);
    const mail = { to: "queue-test@example.com", template: "membership_approved", subject: "Сэдэв", title: "Гарчиг", body: "Бие" };
    const errSpy = (await import("vitest")).vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = (await import("vitest")).vi.spyOn(console, "log").mockImplementation(() => {});
    process.env.EMAIL_SERVER = "smtp://127.0.0.1:1"; // холбогдохгүй хаяг
    expect(await sendMail(mail)).toBe(false);
    let [r] = await db.sys("SELECT id, state, attempts, last_error, payload, next_attempt_at > now() AS later FROM notification_outbox WHERE recipient = $1", [mail.to]);
    expect(r).toMatchObject({ state: "queued", attempts: 1, later: true });
    expect(r.last_error).toBeTruthy();
    expect(r.payload.body).toBe("Бие");
    // Хугацаа болоогүй мөрийг ажилчин авахгүй
    expect(await processOutbox()).toEqual({ sent: 0, failed: 0 });
    // Хугацаа болмогц дахин оролдоно; гарц сэргэсэн бол илгээгдэнэ, агуулга цэвэрлэгдэнэ
    delete process.env.EMAIL_SERVER;
    await db.sys("UPDATE notification_outbox SET next_attempt_at = now() - interval '1 second' WHERE id = $1", [r.id]);
    expect(await processOutbox()).toEqual({ sent: 1, failed: 0 });
    [r] = await db.sys("SELECT state, attempts, payload, sent_at FROM notification_outbox WHERE id = $1", [r.id]);
    expect(r).toMatchObject({ state: "sent", attempts: 2, payload: { subject: "Сэдэв" } });
    expect(r.sent_at).toBeTruthy();
    // Оролдлого дуусвал failed болно
    process.env.EMAIL_SERVER = "smtp://127.0.0.1:1";
    await sendMail({ ...mail, to: "dead-test@example.com" });
    await db.sys("UPDATE notification_outbox SET attempts = $1, next_attempt_at = now() WHERE recipient = 'dead-test@example.com'", [MAX_ATTEMPTS - 1]);
    await processOutbox();
    const [d] = await db.sys("SELECT state, attempts FROM notification_outbox WHERE recipient = 'dead-test@example.com'");
    expect(d).toMatchObject({ state: "failed", attempts: MAX_ATTEMPTS });
    // Нууц токентой (transient) имэйлийн агуулга хадгалагдахгүй
    delete process.env.EMAIL_SERVER;
    await sendMail({ ...mail, to: "link-test@example.com", template: "magic_link", cta: { label: "Нэвтрэх", url: "https://x.test/?token=SECRET-TOKEN" } }, { transient: true });
    const [t] = await db.sys("SELECT state, payload::text AS p FROM notification_outbox WHERE recipient = 'link-test@example.com'");
    expect(t.state).toBe("sent");
    expect(t.p).not.toContain("SECRET-TOKEN");
    errSpy.mockRestore();
    logSpy.mockRestore();
    await expect(db.withCtx({ personId: admin, urguuId: A }, (q) => q("SELECT * FROM notification_outbox"))).rejects.toThrow(/permission denied/);
  });

  it("SMS код: hash-аар хадгалагдана, нэг удаа, 5 оролдлого, хязгаартай (P2.3)", async () => {
    const { vi } = await import("vitest");
    const { issueOtp, checkOtp } = await import("@/lib/otp");
    process.env.SMS_DEV_LOG = "1";
    const phone = "+97690001111";
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((m: string) => void logs.push(String(m)));
    const code = async () => {
      expect(await issueOtp(phone, "login", admin)).toBe("sent");
      return logs[logs.length - 1].match(/код (\d{6})/)![1];
    };
    const c1 = await code();
    const stored = await db.sys("SELECT code_hash FROM phone_otp WHERE phone = $1", [phone]);
    expect(stored[0].code_hash).toHaveLength(64);
    expect(stored[0].code_hash).not.toContain(c1);
    expect(JSON.stringify(await db.sys("SELECT payload FROM notification_outbox WHERE recipient = $1", [phone]))).not.toContain(c1);
    const wrong = c1 === "000000" ? "111111" : "000000";
    expect((await checkOtp(phone, "login", wrong)).ok).toBe(false);
    expect((await checkOtp(phone, "verify", c1)).ok).toBe(false); // өөр зориулалтаар ашиглагдахгүй
    expect(await checkOtp(phone, "login", c1)).toEqual({ ok: true, personId: admin });
    expect((await checkOtp(phone, "login", c1)).ok).toBe(false); // нэг удаа
    // Шинэ код өмнөхийг хүчингүй болгоно; 5 буруу оролдлогын дараа зөв код ч хүчингүй
    const c2 = await code();
    const c3 = await code();
    expect((await checkOtp(phone, "login", c2)).ok).toBe(c2 === c3);
    const c4 = await code();
    const bad = c4 === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await checkOtp(phone, "login", bad)).ok).toBe(false);
    expect((await checkOtp(phone, "login", c4)).ok).toBe(false);
    // 15 минутад нэг дугаарт 5-аас илүү код явахгүй
    await issueOtp(phone, "login", admin);
    expect(await issueOtp(phone, "login", admin)).toBe("rate");
    spy.mockRestore();
    await expect(db.withCtx({ personId: admin, urguuId: A }, (q) => q("SELECT * FROM phone_otp"))).rejects.toThrow(/permission denied/);
  });

  it("утас солигдвол баталгаажуулалт хүчингүй болно; баталгаажсан утас давхардахгүй (P2.3)", async () => {
    const [p1] = await db.sys("INSERT INTO person (given_name, created_urguu_id) VALUES ('Утас-1', $1) RETURNING id", [A]);
    const [p2] = await db.sys("INSERT INTO person (given_name, created_urguu_id) VALUES ('Утас-2', $1) RETURNING id", [A]);
    await db.sys("INSERT INTO person_private (person_id, phone, phone_verified) VALUES ($1, '+97690002222', true), ($2, '+97690002222', false)", [p1.id, p2.id]);
    await expect(db.sys("UPDATE person_private SET phone_verified = true WHERE person_id = $1", [p2.id])).rejects.toThrow(/person_private_phone_verified_uq/);
    await db.sys("UPDATE person_private SET phone = '+97690003333' WHERE person_id = $1", [p1.id]);
    const [r] = await db.sys("SELECT phone_verified FROM person_private WHERE person_id = $1", [p1.id]);
    expect(r.phone_verified).toBe(false);
  });
});
