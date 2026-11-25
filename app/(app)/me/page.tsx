import Link from "next/link";
import { confirmPhoneVerify, requestPhoneVerify } from "@/app/actions/auth";
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

export default async function Me({ searchParams }: { searchParams: Promise<{ e?: string; saved?: string; pv?: string }> }) {
  const v = await requireMember();
  const sp = await searchParams;
  // Өөрийн мөр: системийн холболтоор зөвхөн өөрийн person_id-аар уншина.
  const [priv] = await sys<{ phone: string | null; phone_verified: boolean }>("SELECT phone, phone_verified FROM person_private WHERE person_id = $1", [v.personId]);
  const sms = smsMode() !== "off";
  const pv = sp.pv ? PV[sp.pv] : null;
  const p = v.perms;
  const admin = [
    (p.has("member.approve") || p.has("invite.send")) && ["/admin/approvals", "Бүртгэл батлах"],
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
    </>
  );
}
