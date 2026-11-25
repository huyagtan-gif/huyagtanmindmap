import Link from "next/link";
import { confirmPhoneVerify, requestJoin, requestPhoneVerify } from "@/app/actions/auth";
import { cancelDeletion, requestDeletion } from "@/app/actions/privacy";
import { ConfirmButton } from "@/components/AutoSubmit";
import { PersonForm } from "@/components/PersonForm";
import { sys } from "@/lib/db";
import { smsMode } from "@/lib/sms";
import { requireMember } from "@/lib/viewer";

export const metadata = { title: "Миний мэдээлэл" };

const ERR: Record<string, string> = {
  name: "Өөрийн нэрээ оруулна уу.",
  email: "Энэ имэйл хаяг өөр хүн дээр бүртгэлтэй байна.",
  save: "Хадгалж чадсангүй. Дахин оролдоно уу.",
};

const PV: Record<string, [string, string]> = {
  sent: ["info", "Таны утас руу 6 оронтой код илгээлээ. 5 минут хүчинтэй."],
  ok: ["ok", "Утас баталгаажлаа. Одоо SMS кодоор нэвтэрч болно."],
  code: ["bad", "Код буруу эсвэл хугацаа нь дууссан байна."],
  rate: ["bad", "Хэт олон оролдлого хийлээ. 15 минутын дараа дахин оролдоно уу."],
  fail: ["bad", "SMS илгээж чадсангүй. Түр хүлээгээд дахин оролдоно уу."],
  taken: ["bad", "Энэ дугаар өөр хүн дээр баталгаажсан байна. Өргөөний админд хандана уу."],
  nophone: ["bad", "Эхлээд формдоо утасны дугаараа оруулж хадгална уу."],
  format: ["bad", "Утасны дугаарын хэлбэр буруу байна. Формдоо засаж хадгална уу."],
};

export default async function Me({ searchParams }: { searchParams: Promise<{ e?: string; saved?: string; pv?: string; j?: string; d?: string }> }) {
  const v = await requireMember();
  const sp = await searchParams;
  // Өөрийн мөр: системийн холболтоор зөвхөн өөрийн person_id-аар уншина.
  const [priv] = await sys<{ phone: string | null; phone_verified: boolean }>("SELECT phone, phone_verified FROM person_private WHERE person_id = $1", [v.personId]);
  const sms = smsMode() !== "off";
  // P2.4: миний өргөөнүүд ба элсэх боломжтой бусад идэвхтэй өргөө (нэрс нь нууц биш).
  const myUrguus = await sys<{ id: string; name: string; state: string; role_name: string | null }>(
    `SELECT u.id, u.name, m.state, r.name AS role_name FROM membership m JOIN urguu u ON u.id = m.urguu_id LEFT JOIN role r ON r.id = m.role_id
     WHERE m.person_id = $1 AND u.state = 'active' ORDER BY m.created_at`, [v.personId]);
  const joinable = await sys<{ id: string; name: string }>(
    "SELECT id, name FROM urguu u WHERE state = 'active' AND NOT EXISTS (SELECT 1 FROM membership m WHERE m.urguu_id = u.id AND m.person_id = $1 AND m.state <> 'rejected') ORDER BY created_at", [v.personId]);
  const [delReq] = await sys<{ created_at: Date }>("SELECT created_at FROM data_request WHERE person_id = $1 AND state = 'pending'", [v.personId]);
  const D: Record<string, [string, string]> = {
    sent: ["ok", "Хүсэлт илгээгдлээ. Өргөөний админ шийдвэрлэсний дараа имэйлээр мэдэгдэнэ."],
    cancelled: ["info", "Хүсэлт цуцлагдлаа."],
    confirm: ["bad", "Үргэлжлүүлэхийн тулд чагтыг тэмдэглэнэ үү."],
    rate: ["bad", "Хэт олон хүсэлт илгээлээ. Дараа дахин оролдоно уу."],
    super: ["bad", "Платформын супер админы бүртгэлийг энэ замаар устгах боломжгүй."],
  };
  const MS: Record<string, [string, string]> = { approved: ["ok", "Батлагдсан"], pending: ["warn", "Хүлээгдэж буй"], rejected: ["bad", "Татгалзсан"], closed: ["", "Хаагдсан"] };
  const pv = sp.pv ? PV[sp.pv] : null;
  const p = v.perms;
  const admin = [
    (p.has("member.approve") || p.has("invite.send") || p.has("data.request")) && ["/admin/approvals", "Бүртгэл батлах"],
    p.has("ongod.edit") && ["/admin/ongod", "Онгодын мод"],
    p.has("settings.manage") && ["/admin/settings", "Тохиргоо"],
    (p.has("import.run") || p.has("person.merge")) && ["/admin/import", "Импорт, нэгтгэл"],
    p.has("audit.view") && ["/admin/audit", "Өөрчлөлтийн түүх"],
    v.isPlatformAdmin && !v.viewAs && ["/admin/system", "Систем"],
  ].filter(Boolean) as [string, string][];
  return (
    <>
      <div className="pagehead">
        <div className="col g4"><div className="crumb">{v.urguu.name}</div><h1>Миний мэдээлэл</h1></div>
        <Link className="btn" href={`/people/${v.personId}`}>Профайлаа харах</Link>
      </div>
      {admin.length ? (
        <div className="card p0 show-m">
          {admin.map(([href, name]) => <Link key={href} className="list-item" href={href} style={{ color: "inherit", fontWeight: 600 }}>{name}</Link>)}
        </div>
      ) : null}
      {sp.saved ? <div className="banner ok" role="status">Хадгалагдлаа. Mind map шинэчлэгдсэн.</div> : null}
      {sp.e ? <div className="banner bad" role="alert">{ERR[sp.e] || ERR.save}</div> : null}
      {!v.formCompleted && !sp.saved ? <div className="banner info">Тавтай морил! Бүртгэлийн формоо бөглөөд «Хадгалах» дарна уу. Дараа нь хэдийд ч засаж болно.</div> : null}
      <PersonForm viewer={v} personId={v.personId} returnTo="/me" />
      <div className="card col g12" id="account">
        <h2>Нэвтрэлт</h2>
        {pv ? <div className={`banner ${pv[0]}`} role="status">{pv[1]}</div> : null}
        <div className="row wrap between">
          <div className="col">
            <span className="small muted">Утас</span>
            <span className="row" style={{ gap: 8 }}>
              <b className="num">{priv?.phone || "—"}</b>
              {priv?.phone ? <span className={`chip ${priv.phone_verified ? "ok" : "warn"}`} style={{ height: 22 }}>{priv.phone_verified ? "Баталгаажсан" : "Баталгаажаагүй"}</span> : null}
            </span>
          </div>
          {sms && priv?.phone && !priv.phone_verified ? (
            <form action={requestPhoneVerify}><button className="btn sm">{sp.pv === "sent" || sp.pv === "code" ? "Код дахин авах" : "SMS-ээр баталгаажуулах"}</button></form>
          ) : null}
        </div>
        {sms && priv?.phone && !priv.phone_verified && (sp.pv === "sent" || sp.pv === "code") ? (
          <form action={confirmPhoneVerify} className="row wrap" style={{ alignItems: "flex-end" }}>
            <label className="field" style={{ width: 160 }}><span className="tiny muted">SMS код</span>
              <input className="inp num" name="code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} placeholder="000000" />
            </label>
            <button className="btn pri">Баталгаажуулах</button>
          </form>
        ) : null}
        <span className="small muted">
          {sms ? "Утсаа баталгаажуулбал имэйлийн холбоосоос гадна SMS кодоор нэвтрэх боломжтой болно." : "SMS-ээр баталгаажуулах боломж одоогоор идэвхжээгүй байна."}
        </span>
      </div>
      {myUrguus.length > 1 || joinable.length ? (
        <div className="card col g12" id="urguu">
          <h2>Миний өргөөнүүд</h2>
          {sp.j ? <div className={`banner ${sp.j === "sent" ? "ok" : "bad"}`} role="status">{sp.j === "sent" ? "Хүсэлт илгээгдлээ. Тэр өргөөний админ баталсны дараа өргөө сэлгэх цэсэнд гарна." : sp.j === "rate" ? "Хэт олон хүсэлт илгээлээ. Дараа дахин оролдоно уу." : "Хүсэлт илгээх боломжгүй байна."}</div> : null}
          <div className="col">
            {myUrguus.map((u) => (
              <div key={u.id} className="row between" style={{ minHeight: 40 }}>
                <b>{u.name}</b>
                <span className="row" style={{ gap: 8 }}>{u.state === "approved" && u.role_name ? <span className="small muted">{u.role_name}</span> : null}<span className={`chip ${MS[u.state]?.[0] || ""}`} style={{ height: 22 }}>{MS[u.state]?.[1] || u.state}</span></span>
              </div>
            ))}
          </div>
          {joinable.length ? (
            <form action={requestJoin} className="row wrap" style={{ alignItems: "flex-end" }}>
              <label className="field" style={{ flex: "1 1 220px" }}><span className="tiny muted">Өөр өргөөнд элсэх хүсэлт</span>
                <select className="inp sm" name="urguu_id">{joinable.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
              </label>
              <button className="btn sm">Хүсэлт илгээх</button>
            </form>
          ) : null}
        </div>
      ) : null}
      <div className="card col g12" id="data">
        <h2>Миний өгөгдөл</h2>
        {sp.d && D[sp.d] ? <div className={`banner ${D[sp.d][0]}`} role="status">{D[sp.d][1]}</div> : null}
        <div className="row wrap between">
          <span className="small muted" style={{ flex: "1 1 260px" }}>Системд хадгалагдсан өөрийн бүх мэдээллийн хуулбарыг файлаар татаж авна.</span>
          <a className="btn sm" href="/me/export">Өгөгдлөө татах (JSON)</a>
        </div>
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }} className="col g12">
          {delReq ? (
            <div className="row wrap between">
              <span className="small">Бүртгэлээ устгуулах хүсэлт <b>хүлээгдэж байна</b>. Өргөөний админ шийдвэрлэнэ.</span>
              <form action={cancelDeletion}><button className="btn sm">Хүсэлтээ цуцлах</button></form>
            </div>
          ) : (
            <details>
              <summary className="small" style={{ cursor: "pointer", fontWeight: 600 }}>Бүртгэл, өгөгдлөө устгуулах</summary>
              <form action={requestDeletion} className="col g12" style={{ marginTop: 12 }}>
                <span className="small muted">Админ баталсны дараа таны бүртгэл, холбоо барих мэдээлэл, онгод, харилцаа, формын хариулт зэрэг бүх өгөгдөл бүрмөсөн устна. Буцаах боломжгүй.</span>
                <label className="field"><span className="tiny muted">Тайлбар (заавал биш)</span><textarea className="inp" name="note" rows={2} maxLength={1000} /></label>
                <label className="row small" style={{ gap: 8 }}><input type="checkbox" name="confirm" required style={{ width: 18, height: 18 }} />Миний бүх өгөгдлийг устгахыг хүсэж байна.</label>
                <div><ConfirmButton className="btn sm danger" message="Устгах хүсэлт илгээх үү?">Устгах хүсэлт илгээх</ConfirmButton></div>
              </form>
            </details>
          )}
        </div>
      </div>
    </>
  );
}
