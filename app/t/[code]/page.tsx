import { cookies } from "next/headers";
import Link from "next/link";
import { publicConfirm, publicRegister } from "@/app/actions/public";
import { PubFooter } from "@/components/AuthFrame";
import { Captcha } from "@/components/Captcha";
import { Icon } from "@/components/ui";
import { captchaSiteKey } from "@/lib/captcha";
import { openJson } from "@/lib/codes";
import { sys } from "@/lib/db";
import { getT, N, tMeta } from "@/lib/i18n";
import { displayName } from "@/lib/project";
import { fmtDay, fmtRange, money } from "@/lib/time";
import type { Training } from "@/lib/training";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";
export const generateMetadata = tMeta("Сургалтын бүртгэл");

const ERR: Record<string, string> = {
  consent: N("Үргэлжлүүлэхийн тулд хувийн мэдээлэл боловсруулахыг зөвшөөрнө үү."),
  name: N("Өөрийн нэрээ оруулна уу."),
  phone: N("Утасны дугаараа зөв оруулна уу (8 оронтой)."),
  email: N("Имэйл хаягаа зөв оруулна уу."),
  rate: N("Хэт олон оролдлого хийлээ. 15 минутын дараа дахин оролдоно уу."),
  captcha: N("Робот биш гэдгээ баталгаажуулна уу."),
  closed: N("Энэ сургалтын бүртгэл хаагдсан байна."),
  sms: N("SMS илгээж чадсангүй. Түр хүлээгээд дахин оролдоно уу."),
  otp: N("Код буруу эсвэл хугацаа нь дууссан байна."),
  expired: N("Хугацаа дууссан. Мэдээллээ дахин оруулна уу."),
};

/** P3.4: олон нийтэд нээлттэй сургалтын бүртгэлийн хуудас (нэвтрэлтгүй). */
export default async function PublicTraining({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ e?: string; step?: string }> }) {
  const { code } = await params;
  const sp = await searchParams;
  const tr = await getT();
  const [t] = /^[a-z0-9]{6,20}$/.test(code)
    ? await sys<Training & { urguu_name: string }>("SELECT t.*, u.name AS urguu_name FROM training t JOIN urguu u ON u.id = t.urguu_id WHERE t.public_code = $1 AND t.scope = 'public' AND t.state <> 'draft'", [code])
    : [];
  if (!t)
    return (
      <div className="pubwrap">
        <div className="card col g12"><h1>{tr("Сургалт олдсонгүй")}</h1><span className="muted">{tr("Холбоос буруу эсвэл сургалт нийтэд нээлттэй биш байна.")}</span><Link className="btn" href="/">{tr("Нүүр хуудас")}</Link></div>
      </div>
    );
  const [sessions, teachers, [cnt], v] = await Promise.all([
    sys<{ id: string; title: string | null; starts_at: Date; ends_at: Date | null; place: string | null }>("SELECT id, title, starts_at, ends_at, place FROM training_session WHERE training_id = $1 ORDER BY starts_at", [t.id]),
    sys<{ father_name: string | null; given_name: string }>("SELECT p.father_name, p.given_name FROM training_teacher tt JOIN person p ON p.id = tt.person_id WHERE tt.training_id = $1 ORDER BY p.given_name", [t.id]),
    sys<{ n: number }>("SELECT count(*)::int AS n FROM training_participant WHERE training_id = $1 AND state = 'yes'", [t.id]),
    getViewer(),
  ]);
  const pending = sp.step === "code" ? openJson<{ code: string; phone: string }>((await cookies()).get("pubreg")?.value) : null;
  const stepCode = !!pending && pending.code === code;
  const full = t.capacity !== null && cnt.n >= t.capacity;
  const open = t.state === "open";
  return (
    <div className="pubwrap">
      <div className="brand" style={{ padding: 0 }}><span className="logo" style={{ color: "#fff" }}><Icon n="map" s={18} /></span>{tr("Хуягтан")}<span className="small muted" style={{ fontWeight: 500, marginLeft: 8 }}>{t.urguu_name}</span></div>
      <div className="card col g12">
        <div className="col g4">
          <h1>{t.name}</h1>
          {t.topic ? <span className="muted">{t.topic}</span> : null}
        </div>
        {t.description ? <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{t.description}</p> : null}
        <dl className="kv">
          <dt>{tr("Хичээл")}</dt>
          <dd>{sessions.length ? sessions.map((s, i) => <div key={s.id}>{i + 1}. {fmtDay(s.starts_at, tr.lang)} · {fmtRange(s.starts_at, s.ends_at).slice(11)}{s.title ? ` · ${s.title}` : ""}</div>) : tr("Хуваарь удахгүй зарлагдана")}</dd>
          {t.place ? <><dt>{tr("Байршил")}</dt><dd>{t.place}</dd></> : null}
          {teachers.length ? <><dt>{tr("Багш")}</dt><dd>{teachers.map(displayName).join(", ")}</dd></> : null}
          <dt>{tr("Төлбөр")}</dt><dd><b>{t.fee ? money(t.fee) : tr("Үнэгүй")}</b></dd>
          {t.capacity ? <><dt>{tr("Суудал")}</dt><dd>{cnt.n} / {t.capacity}{full ? ` · ${tr("дүүрсэн")}` : ""}</dd></> : null}
        </dl>
      </div>
      <div className="card col g16">
        {sp.e ? <div className="banner bad" role="alert">{tr(ERR[sp.e] || "Алдаа гарлаа.")}</div> : null}
        {!open ? (
          <div className="col g4"><h2>{tr("Бүртгэл хаагдсан")}</h2><span className="muted">{tr(t.state === "cancelled" ? "Энэ сургалт цуцлагдсан." : t.state === "done" ? "Энэ сургалт дууссан." : "Одоогоор шинээр бүртгэхгүй байна.")}</span></div>
        ) : stepCode ? (
          <form action={publicConfirm} className="col g12">
            <input type="hidden" name="code" value={code} />
            <div className="col g4"><h2>{tr("Утсаа баталгаажуулна уу")}</h2><span className="small muted">{tr.rich("{phone} дугаарт SMS-ээр 6 оронтой код илгээлээ. Код 5 минут хүчинтэй.", { phone: <b className="num">{pending!.phone}</b> })}</span></div>
            <label className="field">{tr("Код")}
              <input className="inp num" name="otp" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} placeholder="000000" autoFocus style={{ fontSize: 22, letterSpacing: ".3em", textAlign: "center" }} />
            </label>
            <button className="btn pri lg">{tr("Бүртгэлээ баталгаажуулах")}</button>
            <Link className="small" href={`/t/${code}`}>{tr("Дугаараа засах")}</Link>
          </form>
        ) : (
          <form action={publicRegister} className="col g16">
            <input type="hidden" name="code" value={code} />
            <div className="col g4">
              <h2>{tr("Бүртгүүлэх")}</h2>
              <span className="small muted">{tr(full ? "Суудал дүүрсэн тул та хүлээлгийн жагсаалтад орно. Суудал суларвал автоматаар оруулж, мэдэгдэнэ." : "Доорх мэдээллийг бөглөж суудлаа баталгаажуулна уу.")}</span>
            </div>
            <div className="formgrid">
              <label className="field">{tr("Эцгийн нэр")}<input className="inp" name="father_name" maxLength={80} autoComplete="additional-name" /></label>
              <label className="field"><span>{tr("Өөрийн нэр")} <span className="req">*</span></span><input className="inp" name="given_name" required maxLength={80} autoComplete="given-name" /></label>
              <label className="field"><span>{tr("Утас")} <span className="req">*</span></span><input className="inp" name="phone" required inputMode="tel" autoComplete="tel" placeholder="9911 2233" maxLength={20} /></label>
              <label className="field">{tr("Имэйл")}<span className="hint">{tr("Заавал биш. Бүртгэлийн холбоос очно.")}</span><input className="inp" type="email" name="email" autoComplete="email" maxLength={254} /></label>
            </div>
            <label className="row small" style={{ gap: 10, alignItems: "flex-start" }}>
              <input type="checkbox" name="consent" required style={{ width: 18, height: 18, marginTop: 2, accentColor: "var(--pri)" }} />
              <span>{tr.rich("Миний нэр, утас, имэйлийг {link}-ын дагуу сургалтын бүртгэл, мэдэгдэлд ашиглахыг зөвшөөрч байна.", { link: <Link href="/privacy" target="_blank">{tr("Нууцлалын бодлого")}</Link> })}</span>
            </label>
            <Captcha siteKey={captchaSiteKey()} />
            <button className="btn pri lg">{tr(full ? "Хүлээлгийн жагсаалтад орох" : "Бүртгүүлэх")}</button>
          </form>
        )}
        {v?.personId ? <span className="small muted">{tr.rich("Та гишүүнээр нэвтэрсэн байна. {link} бүртгүүлбэл таны бүртгэлтэй холбогдоно.", { link: <Link href={`/trainings/${t.id}`}>{tr("Гишүүний хуудаснаас")}</Link> })}</span>
          : <span className="small muted">{tr.rich("Өргөөний гишүүн үү? {link} бүртгүүлнэ үү.", { link: <Link href={`/login?next=${encodeURIComponent(`/trainings/${t.id}`)}`}>{tr("Нэвтэрч")}</Link> })}</span>}
      </div>
      <PubFooter lang={tr.lang} privacy={tr("Нууцлалын бодлого")} />
    </div>
  );
}
