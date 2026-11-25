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

  it("харагдацын эрх: долоон харагдац (P2.2 + P3.8 «Үйлээр») түвшин бүрт seed болсон", async () => {
    const rows = await db.sys("SELECT r.name, count(*)::int AS n FROM role r JOIN role_view rv ON rv.role_id = r.id WHERE r.urguu_id = $1 GROUP BY r.name", [A]);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.n === 7)).toBe(true);
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

  it("шинэ өргөө: тохиргоо ба онгодын мод загвараас хуулагдана (P2.4)", async () => {
    const { createUrguu } = await import("@/lib/urguu");
    const C = await db.sysTx({ personId: admin }, (q) => createUrguu(q, { name: "Гурав дахь өргөө", description: null, templateId: A, ongodFromId: A }));
    const cnt = (u: string) => db.sys(
      `SELECT (SELECT count(*)::int FROM role WHERE urguu_id = $1) AS roles, (SELECT count(*)::int FROM role WHERE urguu_id = $1 AND is_system) AS sysroles,
              (SELECT count(*)::int FROM permission WHERE urguu_id = $1) AS perms, (SELECT count(*)::int FROM role_view WHERE urguu_id = $1) AS views,
              (SELECT count(*)::int FROM field_permission WHERE urguu_id = $1) AS fields, (SELECT count(*)::int FROM urguu_deedes WHERE urguu_id = $1) AS deedes,
              (SELECT count(*)::int FROM ongod WHERE urguu_id = $1 AND NOT needs_review) AS ongods,
              (SELECT count(*)::int FROM ongod WHERE urguu_id = $1 AND NOT needs_review AND parent_id IS NULL) AS roots`, [u]);
    const [a] = await cnt(A), [c] = await cnt(C);
    expect(c).toEqual(a);
    expect(c.sysroles).toBe(1);
    // Хуулбар мод зөвхөн шинэ өргөөний зангилаа руу заана (эх өргөөний зангилаатай холбогдохгүй)
    expect(await db.sys("SELECT 1 FROM ongod c JOIN ongod p ON p.id = c.parent_id WHERE c.urguu_id = $1 AND p.urguu_id <> $1", [C])).toHaveLength(0);
    // Хүмүүс хуулагдахгүй
    expect(await db.sys("SELECT 1 FROM membership WHERE urguu_id = $1", [C])).toHaveLength(0);
  });

  it("өргөө хоорондын эрх ба «Дэлхийн үрс»: давхардалгүй, нууц талбаргүй (P2.5)", async () => {
    const { loadWorld } = await import("@/lib/urguu");
    const [{ id: C }] = await db.sys("SELECT id FROM urguu WHERE name = 'Гурав дахь өргөө'");
    const member = async (name: string, us: string[], phone: string) => {
      const [p] = await db.sys("INSERT INTO person (given_name, created_urguu_id) VALUES ($1, $2) RETURNING id", [name, us[0]]);
      await db.sys("INSERT INTO person_private (person_id, phone, email) VALUES ($1, $2, $3)", [p.id, phone, `${phone.slice(-4)}@world.example.com`]);
      for (const u of us) await db.sys("INSERT INTO membership (person_id, urguu_id, role_id, state) SELECT $1, $2, id, 'approved' FROM role WHERE urguu_id = $2 AND NOT is_system ORDER BY sort DESC LIMIT 1", [p.id, u]);
      return p.id as string;
    };
    const both = await member("Хоёр-өргөөний-хүн", [A, C], "+97670001111");
    const onlyC = await member("Гурав-дахийн-хүн", [C], "+97670002222");
    const viewer: any = { userId: 1, personId: admin, isPlatformAdmin: false, viewAs: false, urguu: { id: A, name: "A" }, fields: new Set(["phone", "email"]) };

    // Эрх олгоогүй үед өөр өргөөний хүн харагдахгүй
    let w = await loadWorld(viewer);
    expect(w.urguus.map((u) => u.id)).toEqual([A]);
    expect(w.people.some((p) => p.id === onlyC)).toBe(false);

    // Зөвхөн эзэмшигч өргөө эрх олгоно: A нь C-ийн нэрийн өмнөөс олгож чадахгүй
    await expect(db.withCtx({ personId: admin, urguuId: A }, (q) => q("INSERT INTO cross_urguu_grant (owner_urguu_id, grantee_urguu_id) VALUES ($1, $2)", [C, A]))).rejects.toThrow(/row-level security/);
    await db.withCtx({ personId: admin, urguuId: C }, (q) => q("INSERT INTO cross_urguu_grant (owner_urguu_id, grantee_urguu_id) VALUES ($1, $2)", [C, A]));
    // Эрх авсан тал уншина, гэхдээ устгаж чадахгүй; гуравдагч өргөө харахгүй
    await db.withCtx({ personId: admin, urguuId: A }, async (q) => {
      expect(await q("SELECT 1 FROM cross_urguu_grant")).toHaveLength(1);
      expect(await q("DELETE FROM cross_urguu_grant RETURNING id")).toHaveLength(0);
    });
    expect(await db.withCtx({ personId: admin, urguuId: B }, (q) => q("SELECT 1 FROM cross_urguu_grant"))).toHaveLength(0);

    w = await loadWorld(viewer);
    expect(w.urguus.map((u) => u.id)).toEqual([A, C]);
    const pb = w.people.filter((p) => p.id === both);
    expect(pb).toHaveLength(1); // хүн давхардахгүй
    expect(pb[0].urguus).toHaveLength(2);
    expect(w.people.find((p) => p.id === onlyC)).toMatchObject({ own: false });
    const json = JSON.stringify(w);
    expect(json).not.toMatch(/\+9767000|world\.example\.com/); // утас, имэйл огт байхгүй (өөрийн өргөөнийх ч энэ харагдацад орохгүй)
    // B өргөө эрх олгоогүй → харагдахгүй
    expect(w.urguus.some((u) => u.id === B)).toBe(false);
    // Хаагдсан өргөө харагдахгүй
    await db.sys("UPDATE urguu SET state = 'closed' WHERE id = $1", [C]);
    expect((await loadWorld(viewer)).urguus.map((u) => u.id)).toEqual([A]);
    await db.sys("UPDATE urguu SET state = 'active' WHERE id = $1", [C]);
  });

  it("өөрийн өгөгдөл татах ба бүрмөсөн устгах: ул мөр үлдэхгүй, бусдын өгөгдөл хэвээр (P2.8)", async () => {
    const { erasePerson, exportOwnData } = await import("@/lib/privacy");
    const [other] = await db.sys("INSERT INTO person (given_name, created_urguu_id) VALUES ('Үлдэх-хүн', $1) RETURNING id", [A]);
    // Устгагдах хүн: гишүүн, холбоо барих мэдээлэл, харилцаа (хоёр чиглэлд), нэрийн хувилбар, нэвтрэх хэрэглэгч, сешн
    const pid = await db.withCtx({ userId: 9, personId: admin, urguuId: A }, async (q) => {
      const [p] = await q("INSERT INTO person (father_name, given_name, comment, created_urguu_id) VALUES ('Устах', 'Мартагдах-хүн', 'нууц сэтгэгдэл', $1) RETURNING id", [A]);
      await q("INSERT INTO person_private (person_id, phone, email) VALUES ($1, '+97660006000', 'erase-me@example.com')", [p.id]);
      await q("INSERT INTO membership (person_id, urguu_id, role_id, state) SELECT $1, $2, id, 'approved' FROM role WHERE urguu_id = $2 AND NOT is_system LIMIT 1", [p.id, A]);
      await q("INSERT INTO person_alias (person_id, alias, norm) VALUES ($1, 'Мартагдах', 'martagdah')", [p.id]);
      const [t] = await q("SELECT id FROM relation_type WHERE key = 'teacher'");
      await q("INSERT INTO relation (from_person_id, to_person_id, type_id) VALUES ($1, $2, $3), ($2, $1, $3)", [p.id, other.id, t.id]);
      await q("UPDATE person SET comment = 'шинэчилсэн нууц' WHERE id = $1", [p.id]);
      return p.id as string;
    });
    const [u] = await db.sys("INSERT INTO users (email, person_id) VALUES ('erase-me@example.com', $1) RETURNING id", [pid]);
    await db.sys(`INSERT INTO sessions ("userId", expires, "sessionToken") VALUES ($1, now() + interval '1 day', 'erase-token')`, [u.id]);
    await db.sys("INSERT INTO notification_outbox (recipient, template, state) VALUES ('erase-me@example.com', 'magic_link', 'sent')");
    // Устгагдах хүн бусдын хүсэлтийг шийдвэрлэсэн байсан ч устгалд саад болохгүй
    await db.sys("UPDATE membership SET decided_by = $1 WHERE person_id = $2", [pid, admin]);
    const [req] = await db.sys("INSERT INTO data_request (person_id, urguu_id, note) VALUES ($1, $2, 'устгана уу') RETURNING id", [pid, A]);
    await expect(db.sys("INSERT INTO data_request (person_id, urguu_id) VALUES ($1, $2)", [pid, A])).rejects.toThrow(/data_request_one_pending/);

    const mine = await exportOwnData(pid);
    expect(mine.person).toMatchObject({ given_name: "Мартагдах-хүн", comment: "шинэчилсэн нууц" });
    expect(mine.contact).toMatchObject({ phone: "+97660006000", email: "erase-me@example.com" });
    expect(mine.relations_from_me).toHaveLength(1);
    expect(mine.relations_to_me).toHaveLength(1);
    expect(mine.memberships).toHaveLength(1);
    expect(JSON.stringify(mine)).not.toMatch(/b-secret|world\.example/); // бусдын мэдээлэл орохгүй

    expect((await db.sys("SELECT count(*)::int AS n FROM audit_log WHERE entity_id = $1 OR before::text LIKE '%erase-me%' OR after::text LIKE '%erase-me%'", [pid]))[0].n).toBeGreaterThan(0);
    const r = await db.sysTx({ userId: 9, personId: admin, urguuId: A }, async (q) => {
      const out = await erasePerson(q, pid);
      await q("UPDATE data_request SET state = 'approved', decided_by = $2, decided_at = now(), note = NULL WHERE id = $1", [req.id, admin]);
      return out;
    });
    expect(r.email).toBe("erase-me@example.com");

    for (const [sql, args] of [
      ["SELECT 1 FROM person WHERE id = $1", [pid]], ["SELECT 1 FROM person_private WHERE person_id = $1", [pid]], ["SELECT 1 FROM membership WHERE person_id = $1", [pid]],
      ["SELECT 1 FROM relation WHERE from_person_id = $1 OR to_person_id = $1", [pid]], ["SELECT 1 FROM person_alias WHERE person_id = $1", [pid]],
      ["SELECT 1 FROM users WHERE id = $1", [u.id]], ["SELECT 1 FROM sessions WHERE \"sessionToken\" = 'erase-token'", []],
      ["SELECT 1 FROM notification_outbox WHERE recipient = 'erase-me@example.com'", []],
    ] as [string, unknown[]][]) expect(await db.sys(sql, args), sql).toHaveLength(0);
    // Өөрчлөлтийн түүхэнд энэ хүний нэр, утас, имэйл, сэтгэгдэл, id-ийн ул мөр үлдээгүй
    const [leak] = await db.sys(
      `SELECT count(*)::int AS n FROM audit_log WHERE entity_id = $1 OR coalesce(before::text, '') || coalesce(after::text, '') ~ $2`,
      [pid, `erase-me|60006000|Мартагдах|нууц сэтгэгдэл|шинэчилсэн нууц|${pid}`]);
    expect(leak.n).toBe(0);
    expect(await db.sys("SELECT 1 FROM audit_log WHERE entity = 'person' AND action = 'erase' AND actor_person_id = $1", [admin])).toHaveLength(1);
    // Хүсэлтийн бүртгэл үлдэнэ (хэн, хэзээ баталсан), гэхдээ хүнтэй холбоогүй, тайлбаргүй
    expect((await db.sys("SELECT person_id, state, note, decided_by FROM data_request WHERE id = $1", [req.id]))[0]).toEqual({ person_id: null, state: "approved", note: null, decided_by: admin });
    // Бусад хүн, тэдний гишүүнчлэл хэвээр; зөвхөн устсан хүн рүү заасан холбоос цэвэрлэгдсэн
    expect(await db.sys("SELECT 1 FROM person WHERE id = $1", [other.id])).toHaveLength(1);
    expect((await db.sys("SELECT state, decided_by FROM membership WHERE person_id = $1 AND urguu_id = $2", [admin, A]))[0]).toEqual({ state: "approved", decided_by: null });
  });

  it("устгах хүсэлт: өөр өргөөний админ харахгүй, апп-ын role устгаж чадахгүй (P2.8)", async () => {
    const [p] = await db.sys("INSERT INTO person (given_name, created_urguu_id) VALUES ('Хүсэлт-гаргагч', $1) RETURNING id", [A]);
    await db.sys("INSERT INTO data_request (person_id, urguu_id) VALUES ($1, $2)", [p.id, A]);
    expect(await db.withCtx({ personId: admin, urguuId: A }, (q) => q("SELECT 1 FROM data_request WHERE person_id = $1", [p.id]))).toHaveLength(1);
    expect(await db.withCtx({ personId: admin, urguuId: B }, (q) => q("SELECT 1 FROM data_request WHERE person_id = $1", [p.id]))).toHaveLength(0);
    await expect(db.withCtx({ personId: admin, urguuId: A }, (q) => q("DELETE FROM data_request"))).rejects.toThrow(/permission denied/);
  });

  it("алдааны бүртгэл: давхардахгүй, хувийн мэдээлэлгүй, шинэ алдаанд нэг л удаа мэдэгдэнэ (P2.9)", async () => {
    const { logError, scrub } = await import("@/lib/errors");
    expect(scrub("user a.b@example.com утас +97699112233 id 3f2b6c1e-1111-4222-8333-444455556666")).toBe("user <имэйл> утас <тоо> id <id>");
    await db.sys("INSERT INTO users (email, is_platform_admin) VALUES ('ops-alert@example.com', true)");
    const err = new Error("duplicate key for leak@example.com (99112233)");
    await logError({ source: "server", message: err.message, stack: err.stack, route: "GET /people/[id] (render)", digest: "1311915923" });
    await logError({ source: "server", message: err.message, stack: err.stack, route: "GET /people/[id] (render)" });
    const rows = await db.sys("SELECT source, message, stack, route, digest, count, alerted_at IS NOT NULL AS alerted FROM error_log");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "server", message: "duplicate key for <имэйл> (<тоо>)", route: "GET /people/[id] (render)", digest: "1311915923", count: 2, alerted: true });
    expect(rows[0].stack).not.toMatch(/leak@example|99112233/);
    // Ижил алдаа хоёр удаа гарсан ч мэдэгдэл нэг л удаа дараалалд орно
    expect(await db.sys("SELECT 1 FROM notification_outbox WHERE recipient = 'ops-alert@example.com' AND template = 'error_alert'")).toHaveLength(1);
    // Хөтчөөс ирсэн (нэвтрээгүй хүн ч илгээж чадах) алдаа бүртгэгдэнэ, гэхдээ имэйл явуулахгүй
    await logError({ source: "client", message: "ResizeObserver loop", route: "/map" });
    expect((await db.sys("SELECT count(*)::int AS n FROM error_log"))[0].n).toBe(2);
    expect(await db.sys("SELECT 1 FROM notification_outbox WHERE recipient = 'ops-alert@example.com'")).toHaveLength(1);
    await expect(db.withCtx({ personId: admin, urguuId: A }, (q) => q("SELECT * FROM error_log"))).rejects.toThrow(/permission denied/);
  });

  /* ---------------- Phase 3 ---------------- */
  const mkTraining = async (urguu: string, o: { capacity?: number | null; fee?: number; scope?: string; is_field?: boolean } = {}) =>
    (await db.sys("INSERT INTO training (urguu_id, name, capacity, fee, scope, is_field, public_code) VALUES ($1, 'Туршилтын сургалт', $2, $3, $4, $5, substr(md5(random()::text), 1, 10)) RETURNING id",
      [urguu, o.capacity ?? null, o.fee ?? 0, o.scope ?? "members", o.is_field ?? false]))[0].id as string;
  const mkPeople = async (n: number, urguu = A) =>
    (await db.sys("INSERT INTO person (given_name, created_urguu_id) SELECT 'Оролцогч-' || g, $2 FROM generate_series(1, $1) g RETURNING id", [n, urguu])).map((r) => r.id as string);

  it("сургалт: хязгаар дүүрвэл хүлээлгэд, суудал суларвал дарааллаар дэвшинэ (P3.3)", async () => {
    const { joinTraining, leaveTraining } = await import("@/lib/training");
    const tid = await mkTraining(A, { capacity: 2, fee: 50000 });
    const [p1, p2, p3, p4] = await mkPeople(4);
    const r = await db.withCtx({ personId: admin, urguuId: A }, async (q) => [
      await joinTraining(q, { trainingId: tid, personId: p1, source: "self" }),
      await joinTraining(q, { trainingId: tid, personId: p2, source: "self" }),
      await joinTraining(q, { trainingId: tid, personId: p3, source: "self" }),
      await joinTraining(q, { trainingId: tid, personId: p4, source: "self" }),
      await joinTraining(q, { trainingId: tid, personId: p1, source: "self" }),
    ]);
    expect(r.map((x) => x.state)).toEqual(["yes", "yes", "waitlist", "waitlist", "yes"]);
    expect(r[4].changed).toBe(false);
    expect((await db.sys("SELECT pay_state FROM training_participant WHERE training_id = $1 AND person_id = $2", [tid, p1]))[0].pay_state).toBe("pending");
    const promoted = await db.withCtx({ personId: admin, urguuId: A }, (q) => leaveTraining(q, tid, p2, "no"));
    expect(promoted).toEqual([p3]);
    const st = Object.fromEntries((await db.sys("SELECT person_id, state FROM training_participant WHERE training_id = $1", [tid])).map((x) => [x.person_id, x.state]));
    expect(st).toMatchObject({ [p1]: "yes", [p2]: "no", [p3]: "yes", [p4]: "waitlist" });
    // Админ эсвэл QR (хязгааргүй) хүлээлгийн хүнийг шууд оруулна
    const x = await db.withCtx({ personId: admin, urguuId: A }, (q) => joinTraining(q, { trainingId: tid, personId: p4, source: "admin", ignoreCapacity: true }));
    expect(x).toMatchObject({ state: "yes", changed: true });
  });

  it("сургалт: RLS: хамтрагч өргөө уншина, зөвхөн тэргүүлэх өргөө бичнэ, бусад өргөө юу ч харахгүй (P3.2)", async () => {
    const [{ id: C }] = await db.sys("INSERT INTO urguu (name) VALUES ('Гурав дахь өргөө') RETURNING id");
    const tid = await mkTraining(A);
    const [pa] = await mkPeople(1, A);
    await db.sys("INSERT INTO person_private (person_id, phone, email) VALUES ($1, '+97622220000', 'pa-secret@example.com')", [pa]);
    await db.sys("INSERT INTO training_urguu (training_id, urguu_id, is_lead, share_pct) VALUES ($1, $2, true, 70), ($1, $3, false, 30)", [tid, A, B]);
    await db.sys("INSERT INTO training_participant (training_id, person_id, state) VALUES ($1, $2, 'yes')", [tid, pa]);
    await db.withCtx({ personId: admin, urguuId: B }, async (q) => {
      expect(await q("SELECT 1 FROM training WHERE id = $1", [tid])).toHaveLength(1);
      expect(await q("SELECT 1 FROM training_participant WHERE training_id = $1", [tid])).toHaveLength(1);
      // Нэрийг л харна: хувийн мэдээлэл, хүний бүтэн мөр өргөө дамжихгүй
      expect(await q("SELECT given_name FROM training_people($1)", [tid])).toEqual([{ given_name: "Оролцогч-1" }]);
      expect(await q("SELECT 1 FROM person WHERE id = $1", [pa])).toHaveLength(0);
      expect(await q("SELECT 1 FROM person_private WHERE person_id = $1", [pa])).toHaveLength(0);
      expect(await q("UPDATE training SET name = 'x' WHERE id = $1 RETURNING id", [tid])).toHaveLength(0);
      expect(await q("UPDATE training_participant SET state = 'no' WHERE training_id = $1 RETURNING id", [tid])).toHaveLength(0);
    });
    await db.withCtx({ personId: admin, urguuId: C }, async (q) => {
      expect(await q("SELECT 1 FROM training WHERE id = $1", [tid])).toHaveLength(0);
      expect(await q("SELECT * FROM training_people($1)", [tid])).toHaveLength(0);
    });
    // Оролцогч өөрөө аль ч өргөөний контекстоос өөрийн мөрөө харна
    expect(await db.withCtx({ personId: pa, urguuId: C }, (q) => q("SELECT state FROM training_participant WHERE person_id = $1", [pa]))).toEqual([{ state: "yes" }]);
  });

  it("үйл: өргөөгөөр тусгаарлагдана, шинэ өргөөнд төрөл ба үүрэг хуулагдана (P3.1)", async () => {
    const [{ id: e }] = await db.sys("INSERT INTO event (urguu_id, name, starts_at) VALUES ($1, 'Тахилга', now() + interval '1 day') RETURNING id", [A]);
    expect(await db.withCtx({ personId: admin, urguuId: A }, (q) => q("SELECT 1 FROM event WHERE id = $1", [e]))).toHaveLength(1);
    expect(await db.withCtx({ personId: admin, urguuId: B }, (q) => q("SELECT 1 FROM event WHERE id = $1", [e]))).toHaveLength(0);
    const types = await db.sys("SELECT count(*)::int AS n FROM event_type WHERE urguu_id = $1", [A]);
    expect(types[0].n).toBe(4);
    const { createUrguu } = await import("@/lib/urguu");
    const nu = await db.sysTx({}, (q) => createUrguu(q, { name: "Шинэ өргөө-3", description: null, templateId: A, ongodFromId: null }));
    const c = await db.sys("SELECT (SELECT count(*) FROM event_type WHERE urguu_id = $1)::int AS t, (SELECT count(*) FROM event_role WHERE urguu_id = $1)::int AS r", [nu]);
    expect(c[0]).toEqual({ t: 4, r: 4 });
  });

  it("QR ирцийн токен 15 минут тутам эргэнэ, өмнөх цонх л хүчинтэй (P3.5)", async () => {
    const { attToken, attTokenValid } = await import("@/lib/training");
    const sid = "3f2b6c1e-1111-4222-8333-444455556666", t0 = 1_800_000_000_000;
    const tok = attToken(sid, t0);
    expect(tok).toMatch(/^[\w-]{16}$/);
    expect(attTokenValid(sid, tok, t0)).toBe(true);
    expect(attTokenValid(sid, tok, t0 + 15 * 60_000)).toBe(true);
    expect(attTokenValid(sid, tok, t0 + 30 * 60_000)).toBe(false);
    expect(attTokenValid("3f2b6c1e-1111-4222-8333-444455556667", tok, t0)).toBe(false);
    expect(attTokenValid(sid, "x".repeat(16), t0)).toBe(false);
  });

  it("нийтийн бүртгэл ба QR: зочин давхардахгүй, баталгаажаагүй утсаар гишүүнд наалдахгүй, ирц нэг л удаа (P3.4, P3.5)", async () => {
    const { registerPublic, participantByToken, checkIn, resolveGuest } = await import("@/lib/public");
    const tid = await mkTraining(A, { scope: "public", capacity: 1 });
    const t = (await db.sys("SELECT id, urguu_id, name, state, scope, reg_mode, fee, capacity, public_code FROM training WHERE id = $1", [tid]))[0];
    const [member] = await mkPeople(1);
    await db.sys("UPDATE person SET given_name = 'Гишүүнбат' WHERE id = $1", [member]);
    await db.sys("INSERT INTO person_private (person_id, phone, phone_verified) VALUES ($1, '+97633330000', true)", [member]);
    // Гишүүний дугаарыг өөр нэрээр, баталгаажуулалтгүй бичвэл шинэ зочин үүснэ (гишүүний бүртгэлд орохгүй)
    const g1 = await db.sysTx({ urguuId: A }, (q) => registerPublic(q, t, { father: null, given: "Өөр хүн", phone: "+97633330000", email: null, phoneVerified: false }));
    expect(g1.personId).not.toBe(member);
    expect(g1.state).toBe("yes");
    expect((await db.sys("SELECT is_registered FROM person WHERE id = $1", [g1.personId]))[0].is_registered).toBe(false);
    // SMS-ээр баталгаажуулсан бол дугаарын эзэн (гишүүн) рүү холбогдоно; суудал дүүрсэн тул хүлээлгэд
    const g2 = await db.sysTx({ urguuId: A }, (q) => registerPublic(q, t, { father: null, given: "Гишүүнбат", phone: "+97633330000", email: null, phoneVerified: true }));
    expect(g2).toMatchObject({ personId: member, state: "waitlist" });
    // Ижил зочин дахин бүртгүүлбэл шинэ хүн үүсэхгүй
    const again = await db.sysTx({ urguuId: A }, (q) => resolveGuest(q, A, { father: null, given: "Өөр хүн", phone: "+97633330000", email: null, phoneVerified: false }));
    expect(again).toEqual({ personId: g1.personId, created: false });
    // Токеноор зөвхөн өөрийн мөр, hash-аар хадгалагдсан
    const p = await db.sysTx({}, (q) => participantByToken(q, t.public_code, g1.token));
    expect(p?.person_id).toBe(g1.personId);
    expect(await db.sys("SELECT 1 FROM training_participant WHERE access_hash = $1", [g1.token])).toHaveLength(0);
    expect(await db.sysTx({}, (q) => participantByToken(q, "wrongcode1", g1.token))).toBeNull();
    // QR ирц: давхар уншуулахад нэг мөр, хүлээлгийн хүн биеэр ирвэл оролцогч болно
    const [{ id: sid }] = await db.sys("INSERT INTO training_session (training_id, starts_at, qr_open) VALUES ($1, now(), true) RETURNING id", [tid]);
    expect(await db.sysTx({ urguuId: A }, (q) => checkIn(q, { trainingId: tid, sessionId: sid, personId: member, allowNew: false }))).toBe("ok");
    expect(await db.sysTx({ urguuId: A }, (q) => checkIn(q, { trainingId: tid, sessionId: sid, personId: member, allowNew: false }))).toBe("already");
    expect((await db.sys("SELECT state FROM training_participant WHERE training_id = $1 AND person_id = $2", [tid, member]))[0].state).toBe("yes");
    const [stranger] = await mkPeople(1);
    expect(await db.sysTx({ urguuId: A }, (q) => checkIn(q, { trainingId: tid, sessionId: sid, personId: stranger, allowNew: false }))).toBe("not_listed");
    expect((await db.sys("SELECT count(*)::int AS n FROM training_attendance WHERE session_id = $1", [sid]))[0].n).toBe(1);
  });

  it("хээрийн сургалт дүүргэвэл «Хээрийн сургалтад суусан» автоматаар тэмдэглэгдэнэ (P3.6)", async () => {
    const { syncFieldTraining } = await import("@/lib/training");
    const tid = await mkTraining(A, { is_field: true });
    const [a, b] = await mkPeople(2);
    await db.sys("INSERT INTO training_participant (training_id, person_id, state, completion) VALUES ($1, $2, 'yes', 'completed'), ($1, $3, 'yes', 'incomplete')", [tid, a, b]);
    await db.withCtx({ personId: admin, urguuId: A }, (q) => syncFieldTraining(q, [a, b]));
    const r = Object.fromEntries((await db.sys("SELECT id, field_training FROM person WHERE id = ANY($1::uuid[])", [[a, b]])).map((x) => [x.id, x.field_training]));
    expect(r).toEqual({ [a]: true, [b]: null });
  });

  it("сануулга: 24 цагийн дотор эхлэх үйл, хичээлд нэг л удаа очно (P3.9)", async () => {
    const { sendReminders } = await import("@/lib/reminders");
    await db.sys("UPDATE event SET reminded_at = now() WHERE reminded_at IS NULL");
    await db.sys("UPDATE training_session SET reminded_at = now() WHERE reminded_at IS NULL");
    const [p] = await mkPeople(1);
    await db.sys("INSERT INTO person_private (person_id, email) VALUES ($1, 'remind-me@example.com')", [p]);
    const [{ id: e }] = await db.sys("INSERT INTO event (urguu_id, name, starts_at) VALUES ($1, 'Маргаашийн үйл', now() + interval '20 hours') RETURNING id", [A]);
    await db.sys("INSERT INTO event (urguu_id, name, starts_at) VALUES ($1, 'Хойтон', now() + interval '3 days')", [A]);
    await db.sys("INSERT INTO event_participant (event_id, urguu_id, person_id, rsvp) VALUES ($1, $2, $3, 'yes')", [e, A, p]);
    const tid = await mkTraining(A);
    await db.sys("UPDATE training SET state = 'open' WHERE id = $1", [tid]);
    await db.sys("INSERT INTO training_session (training_id, starts_at) VALUES ($1, now() + interval '2 hours')", [tid]);
    await db.sys("INSERT INTO training_participant (training_id, person_id, state) VALUES ($1, $2, 'yes')", [tid, p]);
    expect(await sendReminders()).toBe(2);
    expect(await sendReminders()).toBe(0);
    const t = (await db.sys("SELECT template FROM notification_outbox WHERE recipient = 'remind-me@example.com' ORDER BY id")).map((x) => x.template);
    expect(t).toEqual(["event_reminder", "training_reminder"]);
  });
});
